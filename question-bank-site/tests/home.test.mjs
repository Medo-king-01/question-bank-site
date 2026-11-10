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
  /* ------------------------------------------------------------------ *
   * A model of CSS Grid auto-placement, because jsdom has no layout engine
   * and "the pill looks lower" is not a test.
   *
   * Item shape matters here. Items are objects:
   *     { kind: 'stat' }                  a statistic
   *     { kind: 'streak' }                the streak badge, auto-placed
   *     { kind: 'streak', row: 2 }        the streak badge, explicitly placed
   * An earlier version of this helper compared the whole item to the string
   * 'streak', so an object item never matched, every fixture was laid out as
   * a plain statistic, and the "pinned" case silently stopped testing the pin.
   * The recognised shape is now explicit and asserted below.
   * ------------------------------------------------------------------ */
  const isStreak = (item) => Boolean(item) && item.kind === 'streak';

  const layout = (items, cols) => {
    const occupied = new Set();
    const placed = new Map();

    /* Spec order: items with an explicit row are placed before auto items. */
    for (const [i, item] of items.entries()) {
      if (!isStreak(item) || item.row == null) continue;
      for (let c = 1; c <= cols; c++) occupied.add(`${item.row}:${c}`);
      placed.set(i, { row: item.row, col: 1, span: cols });
    }

    let row = 1, col = 1;
    for (const [i, item] of items.entries()) {
      if (placed.has(i)) continue;
      const span = isStreak(item) ? cols : 1;
      for (;;) {
        if (col + span - 1 > cols) { row++; col = 1; continue; }
        const cells = Array.from({ length: span }, (_, k) => `${row}:${col + k}`);
        if (cells.some((c) => occupied.has(c))) { col++; continue; }
        cells.forEach((c) => occupied.add(c));
        placed.set(i, { row, col, span });
        col += span;
        break;
      }
    }

    /* Return rows -> item indices, so assertions can name what landed where. */
    const rows = {};
    for (const [i, p] of placed) (rows[p.row] ||= []).push(i);
    return rows;
  };

  /* A five-item page: four statistics then the badge, matching the markup. */
  const page = (streakRow = null) => [
    { kind: 'stat' }, { kind: 'stat' }, { kind: 'stat' }, { kind: 'stat' },
    streakRow == null ? { kind: 'streak' } : { kind: 'streak', row: streakRow },
  ];

  it('recognises the streak item by kind, not by identity', () => {
    /* Guards the helper itself: if this drifts, every assertion below turns
       into a tautology that passes against broken CSS. */
    eq(isStreak({ kind: 'streak' }), true, 'a streak object must be recognised');
    eq(isStreak({ kind: 'streak', row: 2 }), true, 'a pinned streak object must be recognised');
    eq(isStreak({ kind: 'stat' }), false, 'a stat must not be mistaken for the streak');
  });

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
    /* Reads the stylesheet rather than the DOM: the streak only renders when a
       history exists, and checking the DOM bailed out silently in that case. */
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
    const rows = layout(page(), 2);
    eq(Object.keys(rows).length, 3, 'two stats rows plus one streak row');
    eq(rows[1].length, 2, 'row 1 holds statistics 1 and 2');
    eq(rows[2].length, 2, 'row 2 holds statistics 3 and 4');
    eq(rows[3], [4], 'the streak sits alone on row 3');
  });

  it('breaks the 2x2 block when the streak is pinned to row 2', () => {
    /* The fixture now really pins. What pinning actually does at two columns
       is not "strand one stat" -- the badge claims row 2, so the last two
       statistics are pushed to row 3 and the badge ends up sandwiched
       *between* the stats instead of sitting below them. */
    const pinned = layout(page(2), 2);
    const flowing = layout(page(), 2);

    eq(Object.keys(pinned).length, 3, 'pinning still produces three rows');
    eq(pinned[2], [4], 'the pinned streak owns row 2 outright');
    eq(pinned[3], [2, 3], 'statistics 3 and 4 are pushed to row 3');
    assert(pinned[2].length < 2, 'row 2 is no longer a 2x2 pair');

    /* The badge must end up below every statistic. Pinning violates that. */
    const streakBelow = (rows) => rows[3] && rows[3].includes(4);
    eq(streakBelow(flowing), true, 'flowing: streak is the last row');
    eq(streakBelow(pinned), false, 'pinned: streak sits above two statistics');
  });

  it('keeps a single row of four stats plus the streak on wide screens', () => {
    const flowing = layout(page(), 4);
    eq(flowing[1].length, 4, 'all four stats share row 1');
    eq(flowing[2], [4], 'the streak is the second row');

    /* At four columns pinning and flowing produce the same picture, which is
       exactly why this bug survived a wide-screen check. Assert they agree
       here -- and the test below asserts they disagree at two columns. */
    const pinned = layout(page(2), 4);
    eq(pinned[1].length, 4, 'pinned: four stats still fit row 1');
    eq(pinned[2], [4], 'pinned: streak still lands on row 2');
    eq(JSON.stringify(pinned), JSON.stringify(flowing),
      'wide screens cannot tell the two placements apart');
  });

  it('distinguishes the two placements with the model alone', () => {
    /* Isolation check: no stylesheet, no DOM -- only the placement model. If
       this ever passes for a pinned fixture, the model is broken again and
       every assertion above becomes decorative. */
    const flowing = layout(page(), 2);
    const pinned = layout(page(2), 2);
    assert(JSON.stringify(flowing) !== JSON.stringify(pinned),
      'the model cannot tell a pinned streak from a flowing one');

    eq(flowing[3], [4], 'flowing: the badge is the last row');
    eq(pinned[3], [2, 3], 'pinned: statistics are displaced below the badge');
    assert(!pinned[3].includes(4), 'pinned: the badge is no longer last');
  });

  it('matches the placement the browser would produce at the two review widths', () => {
    /* 768px resolves to five auto-fit columns; 390px hits the two-column rule. */
    const wide = layout(page(), 5);
    eq(wide[1].length, 4, '768px: four stats in one row');
    eq(wide[2], [4], '768px: streak directly beneath them');

    const narrow = layout(page(), 2);
    eq(narrow[1].length, 2, '390px: first pair');
    eq(narrow[2].length, 2, '390px: second pair');
    eq(narrow[3], [4], '390px: streak on its own row');

    /* The whole point of the review note: the two widths disagree. */
    assert(JSON.stringify(layout(page(), 2)) !== JSON.stringify(layout(page(2), 2)),
      'at two columns a pinned streak must produce a different layout');
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
