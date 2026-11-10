/**
 * Attempt history + analytics.
 *
 * Two things are checked here:
 *   1. the history is a faithful audit trail (nothing missed, nothing invented)
 *   2. the analytics derived from it are arithmetically correct
 * The second is what users will trust, so the numbers are asserted against
 * hand-computed expectations rather than against the implementation.
 */
import {
  group, it, assert, eq, includes, excludes,
  boot, ev, clickCourse, startQuizByClick, setMode, text, appHtml,
} from './harness.mjs';

const HKEY = 'qb.history.v1';
const RKEY = 'qb.review.v1';

/* Answer question `i` correctly / incorrectly through the UI. */
function answer(doc, win, i, mode = 'correct') {
  const ans = ev(win, `state.quiz[${i}].ans`);
  const opts = [...doc.querySelectorAll('.opt')].filter((b) => b.dataset.q === String(i));
  const pick = mode === 'correct' ? ans : (ans + 1) % opts.length;
  opts[pick].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  return { picked: pick, answer: ans };
}

function history(win) {
  return ev(win, 'loadHistory()');
}

group('HISTORY · audit trail', () => {
  it('records every study answer with course and section context', () => {
    const { document, window } = boot();
    clickCourse(document, 'acct');
    startQuizByClick(document);
    answer(document, window, 0, 'correct');
    answer(document, window, 1, 'wrong');

    const h = history(window);
    eq(h.attempts.length, 2, 'attempt count');
    const [a0, a1] = h.attempts;
    eq(a0.o, 'correct', 'first outcome');
    eq(a1.o, 'wrong', 'second outcome');
    eq(a0.c, 'acct', 'course id stored');
    assert(a0.s, 'section id missing');
    assert(typeof a0.t === 'number' && a0.t > 0, 'timestamp missing');
    eq(h.attempts.every((a) => typeof a.id === 'string' && a.id), true, 'question ids missing');
  });

  it('records the chosen option index', () => {
    const { document, window } = boot();
    clickCourse(document, 'acct');
    startQuizByClick(document);
    const { picked } = answer(document, window, 0, 'correct');
    eq(history(window).attempts[0].a, picked, 'chosen index not stored');
  });

  it('accepts repeated attempts on the same question', () => {
    const { document, window } = boot();
    clickCourse(document, 'acct');
    startQuizByClick(document);
    answer(document, window, 0, 'wrong');
    document.querySelector('[data-reset="0"]')
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    answer(document, window, 0, 'correct');
    const h = history(window);
    eq(h.attempts.length, 2, 'retry not recorded');
    eq(h.attempts.map((a) => a.o), ['wrong', 'correct'], 'outcome order');
  });

  it('records "revealed" separately from wrong', () => {
    const { document, window } = boot();
    clickCourse(document, 'acct');
    startQuizByClick(document);
    document.querySelector('[data-reveal="0"]')
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const a = history(window).attempts[0];
    eq(a.o, 'revealed', 'reveal outcome');
    eq(a.a, -1, 'reveal answer code');
  });

  it('records nothing until an exam is submitted', () => {
    const { document, window } = boot();
    clickCourse(document, 'acct');
    setMode(document, 'exam');
    startQuizByClick(document);
    answer(document, window, 0, 'correct');
    eq(history(window).attempts.length, 0, 'exam wrote to history early');
  });

  it('records the whole exam on submission', () => {
    const { document, window } = boot();
    clickCourse(document, 'acct');
    const chips = [...document.querySelectorAll('#secSeg button')].filter((b) => b.dataset.id);
    chips.forEach((c, i) => { if (i > 0 && c.classList.contains('sel'))
      c.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
    setMode(document, 'exam');
    startQuizByClick(document);
    const total = ev(window, 'state.quiz.length');
    for (let i = 0; i < total; i++) ev(window, `state.answers[${i}] = state.quiz[${i}].ans;`);
    ev(window, 'finish()');
    const h = history(window);
    eq(h.attempts.length, total, 'not every exam question recorded');
    assert(h.attempts.every((a) => a.o === 'correct'), 'outcomes wrong');
  });

  it('keeps the history independent from the mistake log', () => {
    // Two correct answers clear the mistake log, but must not clear history.
    const { document, window } = boot();
    clickCourse(document, 'acct');
    startQuizByClick(document);
    const q0 = ev(window, 'state.quiz[0]');
    answer(document, window, 0, 'wrong');
    document.querySelector('[data-reset="0"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    answer(document, window, 0, 'correct');
    document.querySelector('[data-reset="0"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    answer(document, window, 0, 'correct');

    const review = JSON.parse(window.localStorage.getItem(RKEY) || '{}');
    eq(review[q0.id], undefined, 'mistake log not cleared after two correct');
    eq(history(window).attempts.length, 3, 'history lost attempts when the mistake log cleared');
  });

  it('survives a reload', () => {
    const first = boot();
    clickCourse(first.document, 'acct');
    startQuizByClick(first.document);
    answer(first.document, first.window, 0, 'correct');
    const saved = first.window.localStorage.getItem(HKEY);

    const second = boot({ storage: { [HKEY]: saved } });
    eq(history(second.window).attempts.length, 1, 'history did not survive reload');
  });

  it('ignores corrupted history instead of crashing', () => {
    const { window, document } = boot({ seed: { [HKEY]: { attempts: 'nope', sessions: 42 } } });
    assert(document.querySelector('[data-course]'), 'home did not render');
    const st = ev(window, 'computeAnalytics()');
    eq(st.total, 0, 'corrupt data produced attempts');
  });
});

group('HISTORY · sessions', () => {
  it('opens a session when a quiz starts', () => {
    const { document, window } = boot();
    clickCourse(document, 'db');
    startQuizByClick(document);
    const h = history(window);
    eq(h.sessions.length, 1, 'session not opened');
    const s = h.sessions[0];
    eq(s.courseId, 'db', 'session course');
    eq(s.mode, 'study', 'session mode');
    assert(s.total > 0, 'session total');
    eq(s.finished, undefined, 'session marked finished prematurely');
  });

  it('updates counters live as the student answers', () => {
    const { document, window } = boot();
    clickCourse(document, 'acct');
    startQuizByClick(document);
    answer(document, window, 0, 'correct');
    answer(document, window, 1, 'wrong');
    const s = history(window).sessions[0];
    eq(s.answered, 2, 'answered');
    eq(s.correct, 1, 'correct');
    eq(s.wrong, 1, 'wrong');
  });

  it('closes with a percentage when the quiz is finished', () => {
    const { document, window } = boot();
    clickCourse(document, 'acct');
    const chips = [...document.querySelectorAll('#secSeg button')].filter((b) => b.dataset.id);
    chips.forEach((c, i) => { if (i > 0 && c.classList.contains('sel'))
      c.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
    setMode(document, 'exam');
    startQuizByClick(document);
    const total = ev(window, 'state.quiz.length');
    for (let i = 0; i < total; i++) ev(window, `state.answers[${i}] = state.quiz[${i}].ans;`);
    ev(window, 'finish()');
    const s = history(window).sessions[0];
    eq(s.finished, true, 'not marked finished');
    assert(typeof s.end === 'number', 'end timestamp missing');
    eq(s.pct, 100, 'percentage');
  });

  it('marks an abandoned session unfinished', () => {
    const { document, window } = boot();
    clickCourse(document, 'acct');
    startQuizByClick(document);
    answer(document, window, 0, 'correct');
    ev(window, 'goHome()');
    const s = history(window).sessions[0];
    eq(s.finished, false, 'abandoned session marked finished');
    eq(s.answered, 1, 'abandoned session lost its counters');
  });

  it('flags a timed-out session', () => {
    const { document, window } = boot({
      seed: { 'qb.examSettings': { count: 'all', timerEnabled: true, timerMinutes: 30 } },
    });
    clickCourse(document, 'acct');
    setMode(document, 'exam');
    startQuizByClick(document);
    ev(window, 'state.deadline = Date.now() - 1000; startExamTimer();');
    const s = history(window).sessions[0];
    eq(s.finished, true, 'timed-out session not finished');
    eq(s.timedOut, true, 'timedOut flag missing');
  });
});

group('HISTORY · bounded storage', () => {
  it('caps stored attempts at 5000', () => {
    const { window } = boot();
    ev(window, `
      const h = loadHistory();
      for (let i = 0; i < 5200; i++){
        h.attempts.push({id:'acct-mcq-1', t: Date.now() - i, o:'correct', a:0, c:'acct', s:'mcq'});
      }
      saveHistory(h);
      recordHistoryAttempt({id:'acct-mcq-1', ans:0, courseId:'acct', sectionId:'mcq'}, 0, null);
    `);
    const h = history(window);
    assert(h.attempts.length <= 5000, `attempts not capped (${h.attempts.length})`);
  });

  it('drops attempts older than 400 days on the next write', () => {
    const { window } = boot();
    ev(window, `
      const h = loadHistory();
      h.attempts.push({id:'old', t: Date.now() - 500*86400000, o:'wrong', a:0, c:'acct', s:'mcq'});
      h.attempts.push({id:'new', t: Date.now() - 86400000, o:'correct', a:0, c:'acct', s:'mcq'});
      saveHistory(h);
      recordHistoryAttempt({id:'acct-mcq-1', ans:0, courseId:'acct', sectionId:'mcq'}, 0, null);
    `);
    const h = history(window);
    eq(h.attempts.some((a) => a.id === 'old'), false, 'stale attempt kept');
    eq(h.attempts.some((a) => a.id === 'new'), true, 'recent attempt dropped');
  });
});

group('ANALYTICS · arithmetic', () => {
  it('computes totals and accuracy from the raw attempts', () => {
    const { document, window } = boot();
    clickCourse(document, 'acct');
    startQuizByClick(document);
    answer(document, window, 0, 'correct');
    answer(document, window, 1, 'correct');
    answer(document, window, 2, 'correct');
    answer(document, window, 3, 'wrong');
    const st = ev(window, 'computeAnalytics()');
    eq(st.total, 4, 'total');
    eq(st.correct, 3, 'correct');
    eq(st.wrong, 1, 'wrong');
    eq(st.accuracy, 75, 'accuracy');
    eq(st.uniqueCount, 4, 'unique count');
  });

  it('counts a revealed answer without counting it as correct', () => {
    const { document, window } = boot();
    clickCourse(document, 'acct');
    startQuizByClick(document);
    document.querySelector('[data-reveal="0"]')
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const st = ev(window, 'computeAnalytics()');
    eq(st.total, 1, 'total');
    eq(st.correct, 0, 'revealed counted as correct');
    eq(st.revealed, 1, 'revealed');
    eq(st.accuracy, 0, 'accuracy');
  });

  it('buckets attempts by course and section', () => {
    const { document, window } = boot();
    clickCourse(document, 'acct');
    startQuizByClick(document);
    answer(document, window, 0, 'correct');
    ev(window, 'goHome()');
    clickCourse(document, 'db');
    startQuizByClick(document);
    answer(document, window, 0, 'wrong');

    const st = ev(window, 'computeAnalytics()');
    eq(st.byCourse.acct.total, 1, 'acct bucket');
    eq(st.byCourse.db.total, 1, 'db bucket');
    eq(st.byCourse.acct.correct, 1, 'acct correct');
    eq(st.byCourse.db.wrong, 1, 'db wrong');
  });

  it('ranks weak sections worst-first with a minimum sample', () => {
    const { window } = boot();
    ev(window, `
      const h = loadHistory();
      const push = (course, section, outcome, n) => {
        for (let i = 0; i < n; i++)
          h.attempts.push({id: course + '-' + section + '-' + i, t: Date.now(), o: outcome, a: 0, c: course, s: section});
      };
      push('acct', '${'mcq'}', 'correct', 6);   // 100%
      push('db', 'mcq', 'wrong', 6);            // 0%
      push('prog', 'mcq', 'correct', 1);        // below the 3-attempt floor
      saveHistory(h);
    `);
    const weak = ev(window, 'weakSections(computeAnalytics())');
    assert(weak.length >= 2, 'weak sections missing');
    eq(weak[0].courseId, 'db', 'worst section not first');
    eq(weak[0].accuracy, 0, 'worst accuracy');
    eq(weak.some((w) => w.courseId === 'prog'), false, 'section below the sample floor included');
  });

  it('lists hardest questions by miss count', () => {
    const { window } = boot();
    const id = ev(window, 'DATA[0].sections[0].items[0].id');
    ev(window, `
      const h = loadHistory();
      for (let i = 0; i < 5; i++) h.attempts.push({id:${JSON.stringify(id)}, t: Date.now(), o:'wrong', a:1, c:'ethics', s:'mcq'});
      saveHistory(h);
    `);
    const hard = ev(window, 'hardestQuestions(5)');
    eq(hard.length, 1, 'hardest count');
    eq(hard[0].wrong, 5, 'wrong count');
    assert(hard[0].item && hard[0].item.q, 'question metadata missing');
  });

  it('finds questions never answered', () => {
    const { window } = boot();
    eq(ev(window, 'unansweredQuestions().length'), 709, 'all questions should start un answered');
    ev(window, `
      const it = DATA[0].sections[0].items[0];
      recordHistoryAttempt(it, it.ans, DATA[0]);
    `);
    eq(ev(window, 'unansweredQuestions().length'), 708, 'answered question still listed');
  });

  it('buckets attempts by calendar day', () => {
    const { window } = boot();
    const today = ev(window, 'dayKey(Date.now())');
    ev(window, `
      const h = loadHistory();
      h.attempts.push({id:'a', t: Date.now(), o:'correct', a:0, c:'acct', s:'mcq'});
      h.attempts.push({id:'b', t: Date.now() - 86400000, o:'wrong', a:0, c:'acct', s:'mcq'});
      saveHistory(h);
    `);
    const st = ev(window, 'computeAnalytics()');
    eq(st.byDay[today].total, 1, 'today bucket');
    eq(Object.keys(st.byDay).length, 2, 'day bucket count');
  });
});

group('ANALYTICS · screen', () => {
  it('shows an empty state before any activity', () => {
    const { document, window } = boot();
    document.querySelector('#anBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    eq(ev(window, 'state.view'), 'analytics', 'did not navigate');
    includes(text(document), 'لسه ما فيش بيانات', 'empty state text');
  });

  it('renders the overview numbers after activity', () => {
    const { document, window } = boot();
    clickCourse(document, 'acct');
    startQuizByClick(document);
    answer(document, window, 0, 'correct');
    answer(document, window, 1, 'wrong');
    document.querySelector('#anBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const html = appHtml(document);
    includes(html, 'إجمالي المحاولات', 'overview card');
    includes(html, 'نسبة الإجابات الصحيحة', 'accuracy card');
    includes(html, '50%', 'accuracy value (1 of 2)');
  });

  it('switches between the four tabs', () => {
    const { document, window } = boot();
    clickCourse(document, 'acct');
    startQuizByClick(document);
    answer(document, window, 0, 'correct');
    document.querySelector('#anBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    for (const tab of ['courses', 'weak', 'sessions', 'overview']) {
      const btn = document.querySelector(`[data-antab="${tab}"]`);
      assert(btn, `tab missing: ${tab}`);
      btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      eq(ev(window, 'state.anTab'), tab, `tab state: ${tab}`);
      eq(document.querySelector(`[data-antab="${tab}"]`).getAttribute('aria-selected'), 'true',
        `aria-selected for ${tab}`);
    }
  });

  it('lists the course the student practised', () => {
    const { document, window } = boot();
    clickCourse(document, 'db');
    startQuizByClick(document);
    answer(document, window, 0, 'correct');
    document.querySelector('#anBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    document.querySelector('[data-antab="courses"]')
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    includes(appHtml(document), 'قواعد البيانات', 'course name in analytics');
  });

  it('is reachable from the header and returns home', () => {
    const { document, window } = boot();
    document.querySelector('#anBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    document.querySelector('#anBack').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    eq(ev(window, 'state.view'), 'home', 'back button did not return home');
  });

  it('escapes question text in the weak-areas list', () => {
    const { document, window } = boot();
    ev(window, `
      DATA[0].sections[0].items[0].q = '<img src=z onerror="window.__x=1">سؤال';
      const h = loadHistory();
      for (let i = 0; i < 4; i++)
        h.attempts.push({id: DATA[0].sections[0].items[0].id, t: Date.now(), o:'wrong', a:1, c:'ethics', s:'mcq'});
      saveHistory(h);
      state.anTab = 'weak';
      state.view = 'analytics';
      render();
    `);
    const html = appHtml(document);
    excludes(html, '<img src=z', 'markup leaked into analytics');
    eq(window.__x, undefined, 'injected handler ran');
  });

  it('shows the mastery panel on the weak tab once questions are tracked', () => {
    const { document, window } = boot();
    clickCourse(document, 'acct');
    startQuizByClick(document);
    answer(document, window, 0, 'wrong');
    answer(document, window, 1, 'correct');
    document.querySelector('#anBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    document.querySelector('[data-antab="weak"]')
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const html = appHtml(document);
    includes(html, 'نظام المراجعة الذكية', 'mastery panel missing');
    includes(html, 'سؤال متتبَّع', 'tracked counter missing');
  });

  it('shows analytics when only mastery records exist', () => {
    // A migrated legacy log or age-trimmed history can leave mastery data with
    // no attempt records at all. The screen must not claim "no data".
    const { document, window } = boot();
    ev(window, `
      const it = DATA[0].sections[0].items[0];
      updateMastery(it, it.ans, Date.now());
    `);
    document.querySelector('#anBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert(document.querySelector('#anBody'), 'screen fell back to the empty state');
    includes(text(document), 'سؤال متتبَّع', 'mastery-only summary missing');
    // The home panel's "nothing tracked yet" wording is a different sentence;
    // assert on the analytics empty-state message specifically.
    excludes(text(document), 'لسه ما فيش بيانات. ابدأ الحل', 'wrongly reported empty');
  });

  it('does not break the home screen', () => {
    const { document, window } = boot();
    clickCourse(document, 'acct');
    startQuizByClick(document);
    answer(document, window, 0, 'correct');
    document.querySelector('#anBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    document.querySelector('#homeBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    eq(ev(window, 'state.view'), 'home', 'home button failed after analytics');
    assert(document.querySelector('[data-course]'), 'course cards missing');
  });
});
