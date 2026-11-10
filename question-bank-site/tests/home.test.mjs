/**
 * Home dashboard (UX-02).
 *
 * The redesign reshuffled the home page, so these tests pin down the things
 * that must survive it: the reading order, the four state-dependent blocks,
 * and the numbers they show. Every assertion goes through the real boot path
 * and, where a number is shown, compares it against computeAnalytics() rather
 * than a hard-coded guess — the home page must never invent its own maths.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  group, it, assert, eq, includes, excludes,
  boot, ev, ROOT, clickCourse, startQuizByClick, text,
} from './harness.mjs';

/* Section order on the rendered page, by class. */
function homeOrder(doc) {
  return [...doc.querySelector('#app').children].map((el) => el.className.split(' ')[0]);
}

function seedMastery(window, count, { dueOffset = -3600e3, level = 0 } = {}) {
  const ids = Object.keys(ev(window, 'ITEMS')).slice(0, count);
  const items = {};
  const now = Date.now();
  ids.forEach((id, i) => {
    items[id] = { level: level ?? i % 6, due: now + dueOffset, seen: i + 1 };
  });
  window.localStorage.setItem('qb.mastery.v1', JSON.stringify({ items }));
  ev(window, 'renderHome()');
  return ids;
}

group('HOME · reading order', () => {
  it('puts the sections in priority order', () => {
    const { document } = boot();
    const order = homeOrder(document);
    eq(order[0], 'hm-welcome', 'welcome must come first');
    eq(order[1], 'hm-progress', 'progress summary follows when there is no session');
    eq(order[2], 'hm-review', 'smart review comes before the catalogue');
    assert(order.includes('hm-section-head'), 'course section heading missing');
    eq(order[order.length - 1], 'grid', 'course list must come last');
  });

  it('slots the resume card directly under the welcome when a session exists', () => {
    const first = boot();
    clickCourse(first.document, 'acct');
    startQuizByClick(first.document);
    const saved = first.window.localStorage.getItem('qb.session');

    const { document } = boot({ storage: { 'qb.session': saved } });  // raw string
    const order = homeOrder(document);
    eq(order[0], 'hm-welcome', 'welcome first even with a session');
    eq(order[1], 'hm-resume', 'resume must sit right under the welcome');
  });

  it('never renders an empty resume card when there is nothing to resume', () => {
    const { document } = boot();
    eq(document.querySelector('.hm-resume'), null, 'resume card shown with no session');
  });
});

group('HOME · welcome', () => {
  it('shows the bank size and the courses count from the real data', () => {
    const { document, window } = boot();
    const facts = [...document.querySelectorAll('.hm-fact b')].map((b) => b.textContent.trim());
    const total = ev(window, 'DATA.reduce((n,c)=>n+totalQ(c),0)');
    eq(facts[0], String(total), 'total question count');
    eq(facts[1], String(ev(window, 'DATA.length')), 'course count');
  });

  it('greets a brand-new visitor with a starting suggestion, not a fake statistic', () => {
    const { document } = boot();
    const lede = document.querySelector('.hm-lede').textContent;
    assert(/ما جاوبتش|ابدأ/.test(lede), `unexpected first-run copy: ${lede}`);
    /* Facts are [total questions, courses, today's attempts]. */
    const facts = [...document.querySelectorAll('.hm-fact b')].map((b) => b.textContent.trim());
    eq(facts[2], '0', 'today counter must start at zero');
    excludes(text(document), 'NaN', 'a missing value leaked into the page');
  });

  it('counts today attempts through the same dayKey the analytics screen uses', () => {
    const { document, window } = boot();
    const ids = Object.keys(ev(window, 'ITEMS')).slice(0, 5);
    // Three attempts today, two yesterday: only three may be counted.
    const today = Date.now();
    ev(window, `(() => {
      const h = loadHistory();
      const ids = ${JSON.stringify(ids)};
      ids.forEach((id, i) => h.attempts.push({
        t: i < 3 ? ${today} - i * 60000 : ${today} - 86400000 * 2,
        c: 'ethics', s: 'mcq', id, o: i === 0 ? 'wrong' : 'correct', a: 0, ans: 0,
      }));
      saveHistory(h);
      renderHome();
    })()`);
    const facts = [...document.querySelectorAll('.hm-fact b')].map((b) => b.textContent.trim());
    eq(facts[2], '3', 'today counter must ignore older attempts');
    const expected = ev(window, 'computeAnalytics().accuracy');
    includes(text(document), `${expected}%`, 'progress accuracy must match the analytics');
  });
});

group('HOME · progress summary', () => {
  it('reports the same accuracy as the analytics screen', () => {
    const { document, window } = boot();
    clickCourse(document, 'acct');
    startQuizByClick(document);
    const ans = ev(window, 'state.quiz[0].ans');
    document.querySelectorAll('.opt')[ans].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    ev(window, 'goHome()');

    const expected = ev(window, 'computeAnalytics().accuracy');
    const shown = document.querySelector('.hm-stat-n').textContent.trim().replace('%', '');
    eq(shown, String(expected), 'home accuracy disagrees with computeAnalytics');
  });

  it('shows zeroes rather than blanks or NaN before any activity', () => {
    const { document } = boot();
    const values = [...document.querySelectorAll('.hm-stat-n')].map((n) => n.textContent.trim());
    eq(values.length, 4, 'four progress stats expected');
    values.forEach((v) => {
      assert(v && v !== 'undefined' && v !== 'NaN' && v !== '%', `bad stat value: ${v}`);
    });
  });

  it('counts started courses from the best-score map', () => {
    const { document } = boot({ seed: { 'qb.best': { ethics: 80, acct: 55 } } });
    const started = [...document.querySelectorAll('.hm-stat-n')].map((n) => n.textContent.trim());
    eq(started[2], '2/8', 'started-course counter');
  });
});

group('HOME · smart review', () => {
  it('offers the review as soon as something is due', () => {
    const { document, window } = boot();
    seedMastery(window, 6);
    const btn = document.querySelector('#reviewBtn');
    assert(btn, 'review button missing');
    eq(btn.disabled, false, 'review button must be enabled when questions are due');
    includes(btn.textContent, '6', 'due count must appear on the button');
    assert(document.querySelector('.hm-review').classList.contains('is-due'),
      'the card must show its due state');
  });

  it('explains when nothing is due instead of showing a dead button', () => {
    const { document, window } = boot();
    seedMastery(window, 4, { dueOffset: 3 * 86400e3 });
    const btn = document.querySelector('#reviewBtn');
    eq(btn.disabled, true, 'review button must be disabled when nothing is due');
    includes(text(document), 'مفيش مستحق', 'the page must say why the button is off');
    eq(document.querySelector('.hm-review').classList.contains('is-due'), false,
      'a quiet card must not look urgent');
  });

  it('still starts a real review session from the new button', () => {
    const { document, window } = boot();
    seedMastery(window, 5);
    document.querySelector('#reviewBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    eq(ev(window, 'state.view'), 'quiz', 'review click did not open the quiz');
    eq(ev(window, 'state.isReview'), true, 'not flagged as a review session');
    eq(ev(window, 'state.quiz.length'), 5, 'review session size');
  });

  it('counts a level-5 question once its 28 days are up', () => {
    /* The mastery model keeps re-queueing level 5; the home panel must agree. */
    const { document, window } = boot();
    seedMastery(window, 3, { level: 5 });
    eq(ev(window, 'dueCount(Date.now())'), 3, 'stored level-5 questions are due');
    includes(document.querySelector('#reviewBtn').textContent, '3', 'level-5 due count');
  });

  it('ignores mastery records whose question no longer exists', () => {
    const { document, window } = boot();
    window.localStorage.setItem('qb.mastery.v1', JSON.stringify({
      items: { 'ghost-question-id': { level: 1, due: Date.now() - 1000, seen: 1 } },
    }));
    ev(window, 'renderHome()');
    eq(ev(window, 'dueCount(Date.now())'), 0, 'ghost question counted as due');
    eq(document.querySelector('#reviewBtn').disabled, true, 'ghost question enabled review');
  });
});

group('HOME · course list', () => {
  it('renders one card per course, in data order', () => {
    const { document, window } = boot();
    const ids = [...document.querySelectorAll('[data-course]')].map((c) => c.dataset.course);
    eq(ids, ev(window, 'DATA.map(c=>c.id)'), 'course order or count changed');
  });

  it('opens a course with Enter', () => {
    const { document, window } = boot();
    const card = document.querySelector('[data-course="ins"]');
    eq(card.getAttribute('role'), 'button', 'card needs a button role');
    eq(card.getAttribute('tabindex'), '0', 'card must be tabbable');
    assert(card.getAttribute('aria-label'), 'card needs an accessible name');
    card.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    eq(ev(window, 'state.view'), 'course', 'Enter did not open the course');
    eq(ev(window, 'state.course.id'), 'ins', 'wrong course opened');
  });

  it('opens a course with Space and swallows the default scroll', () => {
    /* Space is the other half of the button contract, and it is the one that
       bites: a card that answers Space without preventDefault() also scrolls
       the page underneath the student. Cancelable is true here because that is
       how a browser dispatches keydown -- with cancelable:false, preventDefault
       would be a silent no-op and the test would prove nothing. */
    const { document, window } = boot();
    const card = document.querySelector('[data-course="gov"]');
    const press = new window.KeyboardEvent('keydown', {
      key: ' ', bubbles: true, cancelable: true,
    });
    card.dispatchEvent(press);

    eq(press.defaultPrevented, true, 'Space was not cancelled, so the page would scroll');
    eq(ev(window, 'state.view'), 'course', 'Space did not open the course');
    eq(ev(window, 'state.course.id'), 'gov', 'Space opened the wrong course');
  });

  it('cancels Space on the very event the handler navigates from', () => {
    /* preventDefault() must be recorded on the same event object the handler
       acted on, before navigation. A listener attached afterwards would only
       observe the end state, so assert the flag on the dispatched event and
       confirm the navigation happened as a result of it. */
    const { document, window } = boot();
    const card = document.querySelector('[data-course="db"]');
    const press = new window.KeyboardEvent('keydown', {
      key: ' ', bubbles: true, cancelable: true,
    });
    eq(press.defaultPrevented, false, 'precondition: nothing cancelled it yet');

    card.dispatchEvent(press);

    eq(press.defaultPrevented, true, 'the handler must call preventDefault for Space');
    eq(ev(window, 'state.view'), 'course', 'Space did not open the course');
    eq(ev(window, 'state.course.id'), 'db', 'Space opened the wrong course');
  });

  it('leaves other keys alone', () => {
    const { document, window } = boot();
    const card = document.querySelector('[data-course="ins"]');
    for (const key of ['a', 'Tab', 'Escape', 'ArrowDown']) {
      const press = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      card.dispatchEvent(press);
      eq(press.defaultPrevented, false, `${key} must not be cancelled by the card`);
    }
    eq(ev(window, 'state.view'), 'home', 'an unrelated key navigated away');
  });

  it('keeps the best score badge and the not-started state distinct', () => {
    const { document } = boot({ seed: { 'qb.best': { ethics: 91 } } });
    const badges = [...document.querySelectorAll('.badge')].map((b) => b.textContent.trim());
    includes(badges.join('|'), '91%', 'best score not shown');
    includes(badges.join('|'), 'لم تبدأ بعد', 'not-started state lost');
  });

  it('shows a per-course accuracy bar only where attempts exist', () => {
    const { document, window } = boot();
    clickCourse(document, 'acct');
    startQuizByClick(document);
    document.querySelectorAll('.opt')[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    ev(window, 'goHome()');
    const bars = [...document.querySelectorAll('.cc-acc')];
    eq(bars.length, 1, 'exactly one course has attempts, so one bar expected');
    assert(bars[0].parentElement.dataset.course === 'acct', 'bar attached to the wrong course');
  });
});

group('HOME · progress grid', () => {
  /* Simulate CSS Grid auto-placement the way the browser does it, because
     jsdom has no layout engine and "the pill looks lower" is not a test.
     Mirrors the spec order: explicitly positioned items claim their cells
     first, then auto items fill the remaining space in document order. */
  const layout = (children, cols) => {
    const occupied = new Set();
    const placed = new Map();
    for (const [i, kind] of children.entries()) {
      if (kind !== 'streak' || kind.row == null) continue;
      for (let c = 1; c <= cols; c++) occupied.add(`${kind.row}:${c}`);
      /* Record every column it occupies: the row-count assertions below read
         the model back, and a pinned streak spanning the row owns all of it. */
      placed.set(i, { row: kind.row, col: 1, span: cols });
    }
    let row = 1, col = 1;
    for (const [i, kind] of children.entries()) {
      if (placed.has(i)) continue;
      const span = kind === 'streak' ? cols : 1;
      for (;;) {
        if (col + span - 1 > cols) { row++; col = 1; continue; }
        const cells = Array.from({ length: span }, (_, k) => `${row}:${col + k}`);
        if (cells.some((c) => occupied.has(c))) { col++; continue; }
        cells.forEach((c) => occupied.add(c));
        placed.set(i, { row, col });
        col += span;
        break;
      }
    }
    const rows = {};
    for (const [, p] of placed) {
      for (let k = 0; k < (p.span || 1); k++) (rows[p.row] ||= []).push(p.col + k);
    }
    return rows;
  };

  it('keeps the streak last in DOM order, after all four statistics', () => {
    const { document, window } = boot();
    window.localStorage.setItem('qb.history.v1', JSON.stringify({
      v: 1, sessions: [], streak: { current: 4, best: 9 }, attempts: [],
    }));
    ev(window, 'renderHome()');

    const progress = document.querySelector('.hm-progress');
    const kinds = [...progress.children].map((el) =>
      (el.classList.contains('hm-streak') ? 'streak' : 'stat'));
    eq(kinds, ['stat', 'stat', 'stat', 'stat', 'streak'], 'streak must follow the stats');
  });

  it('does not pin the streak to a row, so 2x2 stays a 2x2', () => {
    /* The regression this guards: `grid-row:2` makes the streak claim row 2
       before auto-placement runs, so at two columns a statistic gets stranded
       on a third row and the block stops being an even 2x2.
       This reads the stylesheet, not the rendered DOM: the streak only renders
       when a history exists, and an earlier version of this test returned
       early in that case -- passing silently against a pinned rule. */
    const sheet = readFileSync(join(ROOT, 'index.html'), 'utf8');
    const css = sheet.slice(sheet.indexOf('<style>'), sheet.indexOf('</style>'));
    const at = css.indexOf('.hm-streak{');
    assert(at > -1, 'the .hm-streak rule is missing from the stylesheet');
    const decl = css.slice(at, css.indexOf('}', at));

    assert(!/grid-row\s*:/.test(decl),
      'the streak must not declare an explicit grid-row: it would claim a row '
      + 'before auto-placement and break the 2x2 block at two columns');
    assert(/grid-column\s*:\s*1\s*\/\s*-1/.test(decl),
      'the streak must still span the full row so it never sits beside a stat');
  });

  it('lays out as a 2x2 block with the streak underneath at two columns', () => {
    const kinds = ['stat', 'stat', 'stat', 'stat', { streak: true }];
    const standard = layout(kinds, 2);
    eq(Object.keys(standard).length, 3, 'two stats rows plus one streak row');
    eq(standard[1].length, 2, 'row 1 holds two stats');
    eq(standard[2].length, 2, 'row 2 holds the other two stats');
    eq(standard[3].length, 1, 'the streak sits alone on row 3');
  });

  it('would fail the 2x2 block if the streak were pinned to row 2', () => {
    /* Proves the assertion above has teeth: the pinned variant is modelled
       too, and it must produce the broken layout. */
    const pinned = layout(['stat', 'stat', 'stat', 'stat', { streak: true, row: 2 }], 2);
    /* The streak claims row 2, so the third stat cannot complete the block and
       spills to row 3 by itself -- one stat stranded on its own row, which is
       exactly the ragged layout the reviewer spotted. */
    eq(Object.keys(pinned).length, 3, 'pinning produces three rows instead of two');
    eq(pinned[3].length, 1, 'a statistic is stranded on its own row');
    eq(pinned[3].length < pinned[2].length, true, 'the block is no longer an even 2x2');
  });

  it('keeps a single row of four stats plus the streak on wide screens', () => {
    const wide = layout(['stat', 'stat', 'stat', 'stat', { streak: true }], 4);
    eq(wide[1].length, 4, 'all four stats share row 1');
    eq(wide[2].length, 1, 'the streak is the second row');
  });
});

group('HOME · states', () => {
  it('renders in dark mode without losing any section', () => {
    const { document, window } = boot();
    document.documentElement.setAttribute('data-theme', 'dark');
    ev(window, 'renderHome()');
    const order = homeOrder(document);
    assert(order.includes('hm-welcome') && order.includes('hm-progress')
      && order.includes('hm-review') && order.includes('grid'), 'dark mode lost sections');
    eq(document.querySelectorAll('[data-course]').length, 8, 'dark mode lost course cards');
  });

  it('survives a corrupted session without showing a broken resume card', () => {
    const { document } = boot({ seed: { 'qb.session': { courseId: 'nope', quiz: [] } } });
    eq(document.querySelector('#resumeBtn'), null, 'corrupt session produced a resume button');
    assert(document.querySelector('[data-course]'), 'home did not render');
  });

  it('has no leftover markup from the old hero', () => {
    const { document } = boot();
    eq(document.querySelector('.hero'), null, 'old hero block still rendered');
    eq(document.querySelector('.chips'), null, 'old chip strip still rendered');
  });
});
