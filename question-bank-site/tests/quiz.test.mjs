/**
 * Behavioural tests for the study/exam loop, timer, session persistence and
 * the review (mistake) log -- driven through the real UI in jsdom.
 */
import {
  group, it, assert, eq, includes, excludes,
  boot, ev, clickCourse, clickOption, optionButtons, appHtml, text,
  setMode, startQuizByClick,
} from './harness.mjs';

const SKEY = 'qb.session';
const RKEY = 'qb.review.v1';   // legacy
const MKEY = 'qb.mastery.v1';  // mastery model

/* Put the site on a course setup screen with a single section selected. */
function openCourseReady(doc, win, courseId = 'acct') {
  clickCourse(doc, courseId);
  assert(doc.querySelector('#startBtn'), 'start button missing on course screen');
}

function selectOnlySection(doc, win, keepIndex = 0) {
  const chips = [...doc.querySelectorAll('#secSeg button')].filter((b) => b.dataset.id);
  chips.forEach((chip, i) => {
    const on = chip.classList.contains('sel');
    if ((i === keepIndex && !on) || (i !== keepIndex && on)) {
      chip.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    }
  });
}

group('STUDY MODE · instant feedback', () => {
  it('shows the course screen with its sections and start button', () => {
    const { document } = boot();
    openCourseReady(document, document.defaultView);
    includes(text(document), 'جهّز جلستك', 'setup heading');
    assert(document.querySelectorAll('#secSeg button').length > 1, 'section chips missing');
  });

  it('marks the correct answer green and the wrong pick red', () => {
    const { document, window } = boot();
    openCourseReady(document, window);
    startQuizByClick(document);
    const q0 = ev(window, 'state.quiz[0]');
    const wrongPick = (q0.ans + 1) % q0.opts.length;
    clickOption(document, 0, wrongPick);
    const buttons = [...document.querySelectorAll('.opt')].filter((b) => b.dataset.q === '0');
    assert(buttons[q0.ans].classList.contains('correct'), 'correct option not marked');
    assert(buttons[wrongPick].classList.contains('wrong'), 'wrong option not marked');
    includes(appHtml(document), 'إجابة غير صحيحة', 'feedback text');
  });

  it('locks the question after a study-mode answer', () => {
    const { document, window } = boot();
    openCourseReady(document, window);
    startQuizByClick(document);
    clickOption(document, 0, 0);
    clickOption(document, 0, 1); // second click must be ignored
    const answered = ev(window, 'state.answers[0]');
    eq(answered, 0, 'answer changed after being locked');
  });

  it('increments the wrong counter in the top bar', () => {
    const { document, window } = boot();
    openCourseReady(document, window);
    startQuizByClick(document);
    const q0 = ev(window, 'state.quiz[0]');
    clickOption(document, 0, (q0.ans + 1) % q0.opts.length);
    includes(text(document), '✕ 1', 'wrong counter');
  });

  it('"إظهار الإجابة" reveals the answer and records a miss', () => {
    const { document, window } = boot();
    openCourseReady(document, window);
    startQuizByClick(document);
    const reveal = document.querySelector('[data-reveal="0"]');
    assert(reveal, 'reveal button missing');
    reveal.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    includes(appHtml(document), 'الإجابة الصحيحة', 'revealed answer text');
    const q0 = ev(window, 'state.quiz[0]');
    const items = JSON.parse(window.localStorage.getItem(MKEY) || '{}').items || {};
    assert(items[q0.id], 'reveal should put the question in the mastery queue');
    eq(items[q0.id].level, 0, 'revealed question should not be promoted');
  });
});

group('EXAM MODE · answers hidden until the end', () => {
  it('renders one question at a time', () => {
    const { document, window } = boot();
    openCourseReady(document, window);
    setMode(document, 'exam');
    startQuizByClick(document);
    eq(document.querySelectorAll('.opt').length <= 6, true, 'more than one question rendered');
    assert(document.querySelector('.jump'), 'question navigator missing');
  });

  it('does not reveal correctness while answering', () => {
    const { document, window } = boot();
    openCourseReady(document, window);
    setMode(document, 'exam');
    startQuizByClick(document);
    clickOption(document, 0, 1);
    const opts = optionButtons(document);
    assert(opts.every((b) => !b.classList.contains('correct')), 'exam leaked a correct mark');
    excludes(appHtml(document), 'إجابة صحيحة', 'exam leaked feedback text');
  });

  it('does not write to the mistake log until submission', () => {
    const { document, window } = boot();
    openCourseReady(document, window);
    setMode(document, 'exam');
    startQuizByClick(document);
    clickOption(document, 0, 1);
    eq(JSON.parse(window.localStorage.getItem(RKEY) || '{}'), {}, 'exam wrote to review log early');
  });

  it('records every question once when submitted', () => {
    const { document, window } = boot();
    openCourseReady(document, window);
    selectOnlySection(document, window, 0);
    setMode(document, 'exam');
    startQuizByClick(document);
    const total = ev(window, 'state.quiz.length');
    for (let i = 0; i < total; i++) {
      ev(window, `state.idx=${i}; state.answers[${i}]=0; renderQuiz();`);
    }
    ev(window, 'finish()');
    const items = JSON.parse(window.localStorage.getItem(MKEY) || '{}').items || {};
    assert(Object.keys(items).length > 0, 'submission recorded nothing');
    assert(Object.keys(items).length <= total, 'recorded more questions than asked');
  });

  it('shows a percentage score on the result screen', () => {
    const { document, window } = boot();
    openCourseReady(document, window);
    selectOnlySection(document, window, 0);
    setMode(document, 'exam');
    startQuizByClick(document);
    const total = ev(window, 'state.quiz.length');
    for (let i = 0; i < total; i++) ev(window, `state.answers[${i}] = state.quiz[${i}].ans;`);
    ev(window, 'finish()');
    includes(text(document), '100%', 'perfect score');
    includes(text(document), 'صحيحة', 'score breakdown');
  });

  it('does not overwrite a stored best score with a worse one', () => {
    const { document, window } = boot({ seed: { 'qb.best': { acct: 95 } } });
    openCourseReady(document, window);
    selectOnlySection(document, window, 0);
    setMode(document, 'exam');
    startQuizByClick(document);
    ev(window, 'finish()'); // nothing answered -> 0%
    const best = JSON.parse(window.localStorage.getItem('qb.best'));
    eq(best.acct, 95, 'worse score overwrote the best score');
  });
});

group('SESSION · persistence and resume', () => {
  it('writes a resumable session while a quiz is open', () => {
    const { document, window } = boot();
    openCourseReady(document, window);
    startQuizByClick(document);
    clickOption(document, 0, 0);
    const sess = JSON.parse(window.localStorage.getItem(SKEY));
    assert(sess, 'no session saved');
    eq(sess.courseId, 'acct', 'session course');
    eq(sess.answers['0'], 0, 'session answer');
    assert(Array.isArray(sess.quiz) && sess.quiz.length > 0, 'session has no questions');
  });

  it('offers to resume after a reload and restores answers', () => {
    const first = boot();
    openCourseReady(first.document, first.window);
    startQuizByClick(first.document);
    clickOption(first.document, 0, 2);
    const saved = first.window.localStorage.getItem(SKEY);

    const second = boot({ storage: { [SKEY]: saved } });
    const resume = second.document.querySelector('#resumeBtn');
    assert(resume, 'resume button not offered');
    resume.dispatchEvent(new second.window.MouseEvent('click', { bubbles: true }));
    eq(ev(second.window, 'state.view'), 'quiz', 'not back in the quiz');
    eq(ev(second.window, 'state.answers[0]'), 2, 'answer not restored');
  });

  it('clears the session when the user drops it', () => {
    // Simulate an interrupted session (tab closed mid-quiz) rather than using
    // goHome(), which intentionally abandons the session itself.
    const first = boot();
    openCourseReady(first.document, first.window);
    startQuizByClick(first.document);
    clickOption(first.document, 0, 1);
    const saved = first.window.localStorage.getItem(SKEY);

    const { document, window } = boot({ storage: { [SKEY]: saved } });
    const drop = document.querySelector('#dropBtn');
    assert(drop, 'drop button missing');
    drop.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    eq(window.localStorage.getItem(SKEY), null, 'session not removed');
    eq(Boolean(document.querySelector('#resumeBtn')), false, 'resume still offered');
  });

  it('going home from a quiz abandons the saved session', () => {
    const { document, window } = boot();
    openCourseReady(document, window);
    startQuizByClick(document);
    ev(window, 'goHome()');
    eq(window.localStorage.getItem(SKEY), null, 'session survived an explicit exit');
    eq(Boolean(document.querySelector('#resumeBtn')), false, 'stale resume offered');
  });

  it('ignores a corrupted session instead of crashing', () => {
    const { window, document } = boot({
      seed: { [SKEY]: { courseId: 'acct', quiz: [{ q: 1 }], answers: {}, idx: 0 } },
    });
    eq(document.querySelector('#resumeBtn'), null, 'corrupt session offered for resume');
    assert(document.querySelector('[data-course]'), 'home screen did not render');
  });
});

group('TIMER · exam deadline', () => {
  it('sets a deadline when the timer is enabled', () => {
    const { document, window } = boot({
      seed: { 'qb.examSettings': { count: 'all', timerEnabled: true, timerMinutes: 30 } },
    });
    openCourseReady(document, window);
    setMode(document, 'exam');
    startQuizByClick(document);
    const deadline = ev(window, 'state.deadline');
    assert(Number.isFinite(deadline), 'no deadline set');
    const minutes = Math.round((deadline - Date.now()) / 60000);
    eq(minutes, 30, 'deadline is not 30 minutes out');
    assert(document.querySelector('#timerPill'), 'timer pill not rendered');
  });

  it('has no deadline in study mode', () => {
    const { document, window } = boot({
      seed: { 'qb.examSettings': { count: 'all', timerEnabled: true, timerMinutes: 30 } },
    });
    openCourseReady(document, window);
    startQuizByClick(document);
    eq(ev(window, 'state.deadline'), null, 'study mode got a deadline');
  });

  it('uses the configured duration', () => {
    const { document, window } = boot({
      seed: { 'qb.examSettings': { count: 'all', timerEnabled: true, timerMinutes: 120 } },
    });
    openCourseReady(document, window);
    setMode(document, 'exam');
    startQuizByClick(document);
    const minutes = Math.round((ev(window, 'state.deadline') - Date.now()) / 60000);
    eq(minutes, 120, 'custom duration ignored');
  });

  it('auto-submits when the deadline passes', () => {
    const { document, window } = boot();
    openCourseReady(document, window);
    setMode(document, 'exam');
    startQuizByClick(document);
    ev(window, 'state.deadline = Date.now() - 1000; startExamTimer();');
    eq(ev(window, 'state.view'), 'result', 'did not submit after the deadline');
    eq(ev(window, 'state.timeExpired'), true, 'timeExpired flag not set');
    includes(text(document), 'انتهى وقت الامتحان', 'expiry message');
  });

  it('formats remaining time correctly', () => {
    const { window } = boot();
    eq(ev(window, 'formatRemaining(65000)'), '01:05', 'mm:ss format');
    eq(ev(window, 'formatRemaining(0)'), '00:00', 'zero format');
    eq(ev(window, 'formatRemaining(-5000)'), '00:00', 'negative clamps to zero');
    eq(ev(window, 'formatRemaining(600000)'), '10:00', 'ten minutes');
  });
});

group('REVIEW · mastery queue', () => {
  it('a wrong answer makes the question due immediately at level 0', () => {
    const { document, window } = boot();
    openCourseReady(document, window);
    startQuizByClick(document);
    const q0 = ev(window, 'state.quiz[0]');
    clickOption(document, 0, (q0.ans + 1) % q0.opts.length);
    const m = JSON.parse(window.localStorage.getItem(MKEY));
    eq(m.items[q0.id].level, 0, 'level after a miss');
    eq(m.items[q0.id].wrong, 1, 'wrong count');
    eq(m.items[q0.id].streak, 0, 'streak');
    assert(m.items[q0.id].due <= Date.now(), 'not due immediately');
  });

  it('a correct answer promotes the level and schedules the next review', () => {
    const { document, window } = boot();
    openCourseReady(document, window);
    startQuizByClick(document);
    const q0 = ev(window, 'state.quiz[0]');
    clickOption(document, 0, q0.ans);
    const rec = JSON.parse(window.localStorage.getItem(MKEY)).items[q0.id];
    eq(rec.level, 1, 'level after one correct');
    const days = Math.round((rec.due - Date.now()) / 86400000);
    eq(days, 1, 'next review should be one day out');
  });

  it('repeated correct answers walk the interval ladder', () => {
    const { document, window } = boot();
    openCourseReady(document, window);
    startQuizByClick(document);
    const q0 = ev(window, 'state.quiz[0]');
    const expectedDays = [1, 3, 7, 14, 28];
    for (let step = 0; step < expectedDays.length; step++) {
      document.querySelector('[data-reset="0"]')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      clickOption(document, 0, q0.ans);
      const rec = JSON.parse(window.localStorage.getItem(MKEY)).items[q0.id];
      eq(rec.level, step + 1, `level after ${step + 1} correct`);
      eq(Math.round((rec.due - Date.now()) / 86400000), expectedDays[step],
        `interval at level ${step + 1}`);
    }
  });

  it('caps the level so intervals cannot grow forever', () => {
    const { document, window } = boot();
    openCourseReady(document, window);
    startQuizByClick(document);
    const q0 = ev(window, 'state.quiz[0]');
    for (let i = 0; i < 12; i++) {
      document.querySelector('[data-reset="0"]')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      clickOption(document, 0, q0.ans);
    }
    const rec = JSON.parse(window.localStorage.getItem(MKEY)).items[q0.id];
    const maxLevel = ev(window, 'MASTERY_MAX_LEVEL');
    eq(rec.level, maxLevel, 'level exceeded the cap');
    const maxDays = ev(window, 'MASTERY_INTERVALS[MASTERY_MAX_LEVEL]');
    eq(Math.round((rec.due - Date.now()) / 86400000), maxDays, 'interval exceeded the cap');
  });

  it('a later mistake sends a mastered question back to practice', () => {
    const { document, window } = boot();
    openCourseReady(document, window);
    startQuizByClick(document);
    const q0 = ev(window, 'state.quiz[0]');
    for (let i = 0; i < 5; i++) {
      document.querySelector('[data-reset="0"]')
        .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      clickOption(document, 0, q0.ans);
    }
    eq(JSON.parse(window.localStorage.getItem(MKEY)).items[q0.id].level, 5, 'should be mastered');
    document.querySelector('[data-reset="0"]')
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    clickOption(document, 0, (q0.ans + 1) % q0.opts.length);
    const rec = JSON.parse(window.localStorage.getItem(MKEY)).items[q0.id];
    eq(rec.level, 0, 'must drop to level 0 after a miss');
    assert(rec.due <= Date.now(), 'must be due immediately again');
  });

  it('revealing the answer does not count as mastery', () => {
    const { document, window } = boot();
    openCourseReady(document, window);
    startQuizByClick(document);
    const q0 = ev(window, 'state.quiz[0]');
    document.querySelector('[data-reveal="0"]')
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const rec = JSON.parse(window.localStorage.getItem(MKEY)).items[q0.id];
    eq(rec.level, 0, 'reveal must not promote');
    assert(rec.due <= Date.now(), 'revealed question must stay due');
  });

  it('does not queue a question that is not due yet', () => {
    const { document, window } = boot();
    openCourseReady(document, window);
    startQuizByClick(document);
    const q0 = ev(window, 'state.quiz[0]');
    clickOption(document, 0, q0.ans);           // level 1, due tomorrow
    ev(window, 'goHome()');
    const btn = document.querySelector('#reviewBtn');
    assert(btn.disabled, 'review button should be disabled: nothing is due');
  });

  it('an overdue question becomes due again once its date passes', () => {
    const { window } = boot();
    ev(window, `
      const it = DATA[0].sections[0].items[0];
      updateMastery(it, it.ans, Date.now() - 5 * 86400000);   // promoted 5 days ago
      updateMastery(it, it.ans, Date.now() - 5 * 86400000);
    `);
    eq(ev(window, 'dueCount(Date.now())'), 1, 'overdue question not queued');
    const due = ev(window, 'dueQuestions(Date.now())');
    eq(due.length, 1, 'dueQuestions length');
    eq(due[0].it.id, ev(window, 'DATA[0].sections[0].items[0].id'), 'wrong question queued');
  });

  it('a level-5 question is scheduled 28 days out, not retired', () => {
    const { window } = boot();
    /* Answer "now" five times so `due` is measured from today, which is what
       the learner experiences. */
    ev(window, `
      const it = DATA[0].sections[0].items[0];
      for (let i = 0; i < 5; i++) updateMastery(it, it.ans, Date.now());
    `);
    const rec = ev(window, 'loadMastery().items[DATA[0].sections[0].items[0].id]');
    eq(rec.level, 5, 'level');
    /* The interval table promises a review every 28 days at the top level,
       so the question must keep a future date rather than disappear. */
    eq(Math.round((rec.due - Date.now()) / 86400000), 28, 'level 5 must be due 28 days later');
    eq(ev(window, 'dueCount(Date.now())'), 0, 'not due yet — 28 days out');
  });

  it('a level-5 question comes back for review once its 28 days pass', () => {
    const { window } = boot();
    ev(window, `
      const it = DATA[0].sections[0].items[0];
      for (let i = 0; i < 5; i++) updateMastery(it, it.ans, Date.now());
      /* jump the clock past the 28-day appointment */
      const m = loadMastery();
      m.items[it.id].due = Date.now() - 1000;
      store.set('qb.mastery.v1', m);
    `);
    eq(ev(window, 'dueCount(Date.now())'), 1, 'an overdue level-5 question must be due again');
    eq(ev(window, 'dueQuestions(Date.now())').length, 1, 'and must be in the queue');
    eq(ev(window, 'dueQuestions(Date.now())[0].rec.level'), 5, 'still level 5');
  });

  it('a stable question that is not yet due stays out of the queue', () => {
    const { window } = boot();
    ev(window, `
      const it = DATA[0].sections[0].items[0];
      for (let i = 0; i < 5; i++) updateMastery(it, it.ans, Date.now());
    `);
    eq(ev(window, 'dueCount(Date.now())'), 0, 'not due for 28 days');
    eq(ev(window, 'dueQuestions(Date.now())').length, 0, 'queue empty');
  });

  it('shows the mastery breakdown on the home screen', () => {
    const { document, window } = boot();
    openCourseReady(document, window);
    startQuizByClick(document);
    clickOption(document, 0, ev(window, 'state.quiz[0].ans'));
    ev(window, 'goHome()');
    includes(text(document), 'مستويات الإتقان', 'mastery bars missing');
    includes(text(document), 'المراجعة الذكية', 'panel title');
  });

  it('migrates the legacy mistake log on first load', () => {
    const legacy = {
      'ethics-mcq-5f9398df184a5c7c': {
        questionId: 'ethics-mcq-5f9398df184a5c7c', courseId: 'ethics',
        wrongCount: 2, correctCount: 0, correctStreak: 0,
        lastAttemptAt: Date.now() - 1000,
      },
    };
    const { window } = boot({ seed: { [RKEY]: legacy } });
    const m = JSON.parse(window.localStorage.getItem(MKEY));
    assert(m && m.items, 'mastery model not created');
    const migrated = m.items['ethics-mcq-5f9398df184a5c7c'];
    assert(migrated, 'legacy record not migrated');
    eq(migrated.level, 0, 'migrated level');
    eq(migrated.wrong, 2, 'migrated wrong count');
    assert(migrated.due <= Date.now(), 'migrated record should be due immediately');
  });

  it('keeps the legacy key intact for one release', () => {
    const legacy = { 'ethics-mcq-5f9398df184a5c7c': { questionId: 'x', wrongCount: 1, correctStreak: 0, courseId: 'ethics' } };
    const { window } = boot({ seed: { [RKEY]: legacy } });
    const raw = window.localStorage.getItem(RKEY);
    assert(raw, 'legacy key was deleted');
    eq(JSON.parse(raw)['ethics-mcq-5f9398df184a5c7c'].wrongCount, 1, 'legacy content changed');
  });

  it('never serves a question that is no longer in the bank', () => {
    // A record can outlive its question when data.json is edited. The queue must
    // skip it so a stale id can never produce a blank card.
    const stale = { ghost: { questionId: 'ghost', wrongCount: 3, correctStreak: 0, courseId: 'ethics' } };
    const { document, window } = boot({ seed: { [RKEY]: stale } });
    eq(ev(window, 'dueQuestions(Date.now()).length'), 0, 'ghost question served from the queue');
    eq(document.querySelector('#reviewBtn').disabled, true, 'review button enabled with no live questions');
  });

  it('builds a review quiz from the logged questions only', () => {
    const { document, window } = boot();
    openCourseReady(document, window);
    startQuizByClick(document);
    const q0 = ev(window, 'state.quiz[0]');
    clickOption(document, 0, (q0.ans + 1) % q0.opts.length);
    ev(window, 'goHome()');
    const btn = document.querySelector('#reviewBtn');
    assert(btn && !btn.disabled, 'review button unavailable');
    btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    eq(ev(window, 'state.isReview'), true, 'not in review mode');
    eq(ev(window, 'state.quiz.length'), 1, 'review quiz size');
    eq(ev(window, 'state.quiz[0].id'), q0.id, 'review quiz picked the wrong question');
  });
});
