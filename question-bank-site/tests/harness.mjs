/**
 * Minimal test harness -- no test framework, no extra dependencies beyond jsdom.
 *
 * Loads the real built site (index.html) inside jsdom and drives it the way a
 * user would: clicking options, switching modes, letting the timer run out.
 * That means the tests exercise the shipped artifact, not a copy of the logic.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, '..');

/* ------------------------------------------------------------------ *
 * Tiny assertion library
 * ------------------------------------------------------------------ */
export class Failure extends Error {}

export function assert(cond, msg) {
  if (!cond) throw new Failure(msg || 'assertion failed');
}
export function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Failure(`${msg || 'not equal'}\n   expected: ${b}\n   actual:   ${a}`);
}
export function includes(haystack, needle, msg) {
  if (!String(haystack).includes(needle)) {
    throw new Failure(`${msg || 'missing substring'}\n   needle: ${needle}\n   in:     ${String(haystack).slice(0, 400)}`);
  }
}
export function excludes(haystack, needle, msg) {
  if (String(haystack).includes(needle)) {
    throw new Failure(`${msg || 'unexpected substring'}\n   needle: ${needle}`);
  }
}

/* ------------------------------------------------------------------ *
 * Site loader
 * ------------------------------------------------------------------ */
export const HTML = readFileSync(join(ROOT, 'index.html'), 'utf8');

/**
 * Boot the site in a fresh jsdom. Returns the window plus small helpers.
 * `seed` is written to localStorage before scripts run.
 */
export function boot({ seed = {}, storage = null } = {}) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(e));
  vc.on('error', (...a) => errors.push(new Error(a.join(' '))));

  // A DOM that the html can attach to; scripts are run manually so we can
  // control localStorage seeding and fake timers precisely.
  const dom = new JSDOM(HTML, {
    url: 'https://example.test/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  const { window } = dom;

  // Provide a deterministic localStorage we can inspect.
  const bag = new Map(Object.entries(storage || {}));
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k) => (bag.has(k) ? bag.get(k) : null),
      setItem: (k, v) => bag.set(k, String(v)),
      removeItem: (k) => bag.delete(k),
      clear: () => bag.clear(),
      key: (i) => [...bag.keys()][i] ?? null,
      get length() { return bag.size; },
    },
  });

  for (const [k, v] of Object.entries(seed)) {
    window.localStorage.setItem(k, JSON.stringify(v));
  }

  // Run the site script in the window context, plus a shim that exposes the
  // script's top-level bindings. `const`/`let` inside an eval do not leak out,
  // so the shim is built in the same eval scope on purpose -- the site code
  // itself is never modified.
  const script = extractScript(HTML);
  const shim = `
    ;window.__api = {
      get state(){ return state; },
      get DATA(){ return DATA; },
      esc, formatRemaining, finish, goHome, render, renderQuiz,
      startExamTimer, stopExamTimer, store, openCourse, startQuiz, dropSession,
      renderAnalytics, computeAnalytics, loadHistory, saveHistory,
      recordHistoryAttempt, openHistorySession, closeHistorySession,
      updateHistorySession, weakSections, hardestQuestions, unansweredQuestions,
      dayKey, recentDays, ITEMS, accuracyOf, loadMastery, updateMastery,
      dueCount, dueQuestions, masterySummary, masteryBars, nextDueIn, masteryPanel, daysUntil,
      searchCourse, normaliseArabic, matchQuestion, paintSearchResults,
      MASTERY_INTERVALS, MASTERY_MAX_LEVEL, MASTERY_MASTERED,
      renderHome, totalQ, todayProgress, masterySummary
    };`;
  window.eval(script + shim);

  return { dom, window, document: window.document, errors, storage: bag };
}

function extractScript(html) {
  const start = html.indexOf('<script>');
  const end = html.lastIndexOf('</script>');
  if (start < 0 || end <= start) throw new Error('could not locate the site script');
  return html.slice(start + 8, end);
}

/* ------------------------------------------------------------------ *
 * Evaluate code with the site's own top-level bindings in scope.
 *   ev(win, 'state.quiz[0]')            -> expression, returns a value
 *   ev(win, 'state.idx = 2; render()')  -> statements, returns undefined
 * The shim re-declares the site bindings as locals over window.__api, so tests
 * can use the real names without the site code exporting anything.
 * ------------------------------------------------------------------ */
const API_NAMES = ['state', 'DATA', 'esc', 'formatRemaining', 'finish', 'goHome',
  'render', 'renderQuiz', 'startExamTimer', 'stopExamTimer', 'store',
  'openCourse', 'startQuiz', 'dropSession', 'renderAnalytics', 'computeAnalytics',
  'loadHistory', 'saveHistory', 'recordHistoryAttempt', 'openHistorySession',
  'closeHistorySession', 'updateHistorySession', 'weakSections', 'hardestQuestions',
  'unansweredQuestions', 'dayKey', 'recentDays', 'ITEMS', 'accuracyOf',
  'loadMastery', 'updateMastery', 'dueCount', 'dueQuestions', 'masterySummary',
  'masteryBars', 'nextDueIn', 'masteryPanel', 'daysUntil', 'searchCourse', 'normaliseArabic', 'matchQuestion', 'paintSearchResults', 'MASTERY_INTERVALS', 'MASTERY_MAX_LEVEL', 'MASTERY_MASTERED',
  'renderHome', 'totalQ', 'todayProgress'];

export function ev(win, code) {
  if (!win.__api) throw new Failure('site api shim missing -- did the script throw?');
  const decls = `const {${API_NAMES.join(', ')}} = __api;`;
  const trimmed = String(code).trim();
  // Try to evaluate the snippet as a single expression first (so callers get a
  // value back); fall back to running it as a statement block.
  try {
    // eslint-disable-next-line no-new-func
    return new Function('__api', `${decls}\nreturn (${trimmed});`)(win.__api);
  } catch (e) {
    if (!(e instanceof SyntaxError)) throw e;
    // eslint-disable-next-line no-new-func
    return new Function('__api', `${decls}\n${trimmed}`)(win.__api);
  }
}

/* ------------------------------------------------------------------ *
 * Interaction helpers -- mirror what a user does
 * ------------------------------------------------------------------ */
export function cardByCourse(doc, courseId) {
  return doc.querySelector(`[data-course="${courseId}"]`);
}

export function clickCourse(doc, courseId) {
  const card = cardByCourse(doc, courseId);
  if (!card) throw new Failure(`course card not found: ${courseId}`);
  card.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
  return card;
}

export function optionButtons(doc) {
  return [...doc.querySelectorAll('.opt')];
}

export function clickOption(doc, index, optionIndex) {
  const buttons = doc.querySelectorAll('.opt');
  const target = [...buttons].filter((b) => b.dataset.q === String(index));
  const btn = target[optionIndex];
  if (!btn) throw new Failure(`option ${optionIndex} of question ${index} not found`);
  btn.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
  return btn;
}

/* Visible page text. Reads #app (and the header/footer), never document.body:
   body.textContent also includes the inline <script>, so assertions against it
   would silently match source code instead of rendered output. */
export function text(doc) {
  const parts = [...doc.querySelectorAll('header.top, #app, footer.foot')];
  const root = parts.length ? parts : [doc.body];
  return root.map((el) => el.textContent).join(' ').replace(/\s+/g, ' ').trim();
}

export function appHtml(doc) {
  return doc.querySelector('#app').innerHTML;
}

export function setMode(doc, mode) {
  const card = doc.querySelector(`.modecard[data-mode="${mode}"]`);
  if (!card) throw new Failure(`mode card not found: ${mode}`);
  card.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
}

export function startQuizByClick(doc) {
  const btn = doc.querySelector('#startBtn');
  if (!btn) throw new Failure('#startBtn not found');
  if (btn.disabled) throw new Failure('#startBtn is disabled');
  btn.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
}

/* ------------------------------------------------------------------ *
 * Runner
 * ------------------------------------------------------------------ */
const suites = [];
export function suite(name, fn) { suites.push({ name, fn }); }
export function test(name, fn) { suites.at(-1).tests.push({ name, fn }); }
export function describe(name, fn) {
  suites.push({ name, tests: [] });
  fn();
  suites.at(-1).tests = suites.at(-1).tests || [];
}

const registry = new Map();
export function group(name, fn) {
  const entry = { name, tests: [] };
  registry.set(name, entry);
  current = entry;
  fn();
  current = null;
}
let current = null;
export function it(name, fn) {
  if (!current) throw new Error('it() outside group()');
  current.tests.push({ name, fn });
}

export async function run() {
  let pass = 0, fail = 0;
  const failures = [];
  for (const entry of registry.values()) {
    console.log(`\n\x1b[1m${entry.name}\x1b[0m`);
    for (const t of entry.tests) {
      try {
        await t.fn();
        pass++;
        console.log(`  \x1b[32m✓\x1b[0m ${t.name}`);
      } catch (e) {
        fail++;
        failures.push([entry.name, t.name, e]);
        console.log(`  \x1b[31m✗\x1b[0m ${t.name}`);
        console.log(`      \x1b[31m${(e.message || e).toString().split('\n').join('\n      ')}\x1b[0m`);
      }
    }
  }
  console.log(`\n${'─'.repeat(60)}`);
  console.log(fail === 0
    ? `\x1b[32mPASS\x1b[0m — ${pass} tests`
    : `\x1b[31mFAIL\x1b[0m — ${pass} passed, ${fail} failed`);
  return fail === 0;
}
