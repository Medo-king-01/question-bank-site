/**
 * Accessibility and keyboard tests.
 * These assert the ARIA contract the site exposes, not just that elements exist.
 */
import {
  group, it, assert, eq, includes,
  boot, ev, clickCourse, startQuizByClick, setMode,
} from './harness.mjs';

function key(doc, k, target = doc.body) {
  const win = doc.defaultView;
  const evt = new win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  target.dispatchEvent(evt);
  return evt;
}

group('A11Y · semantics', () => {
  it('every option is a radio with aria-checked', () => {
    const { document, window } = boot();
    clickCourse(document, 'acct');
    startQuizByClick(document);
    const opts = [...document.querySelectorAll('.opt')];
    assert(opts.length > 0, 'no options rendered');
    opts.forEach((o) => {
      eq(o.getAttribute('role'), 'radio', 'option role');
      assert(['true', 'false'].includes(o.getAttribute('aria-checked')), 'aria-checked missing');
    });
  });

  it('options live inside a radiogroup tied to the question text', () => {
    const { document } = boot();
    clickCourse(document, 'acct');
    startQuizByClick(document);
    const group0 = document.querySelector('.opts[role="radiogroup"]');
    assert(group0, 'no radiogroup');
    const labelledBy = group0.getAttribute('aria-labelledby');
    assert(labelledBy, 'radiogroup has no label');
    assert(document.getElementById(labelledBy), 'aria-labelledby points at nothing');
  });

  it('marks the chosen option as checked', () => {
    const { document } = boot();
    clickCourse(document, 'acct');
    startQuizByClick(document);
    const first = [...document.querySelectorAll('.opt')].find((b) => b.dataset.q === '0');
    first.dispatchEvent(new document.defaultView.MouseEvent('click', { bubbles: true }));
    const chosen = [...document.querySelectorAll('.opt')].find((b) => b.dataset.q === '0');
    eq(chosen.getAttribute('aria-checked'), 'true', 'chosen option not marked');
  });

  it('feedback is announced through a polite live region', () => {
    const { document } = boot();
    clickCourse(document, 'acct');
    startQuizByClick(document);
    const first = [...document.querySelectorAll('.opt')].find((b) => b.dataset.q === '0');
    first.dispatchEvent(new document.defaultView.MouseEvent('click', { bubbles: true }));
    const live = document.querySelector('.feedback[role="status"]');
    assert(live, 'feedback is not a live region');
    eq(live.getAttribute('aria-live'), 'polite', 'aria-live value');
  });

  it('the theme and home controls have accessible names', () => {
    const { document } = boot();
    ['#themeBtn', '#homeBtn'].forEach((sel) => {
      const el = document.querySelector(sel);
      assert(el, `${sel} missing`);
      assert(el.getAttribute('title') || el.textContent.trim() || el.getAttribute('aria-label'),
        `${sel} has no accessible name`);
    });
  });

  it('exposes a visible focus style somewhere in the sheet', () => {
    const { document } = boot();
    const css = [...document.querySelectorAll('style')].map((s) => s.textContent).join('');
    includes(css, 'focus-visible', 'no visible focus rule');
    includes(css, 'prefers-reduced-motion', 'reduced motion not honoured');
  });
});

group('KEYBOARD · shortcuts', () => {
  it('exam mode: number keys answer the current question', () => {
    const { document, window } = boot();
    clickCourse(document, 'acct');
    setMode(document, 'exam');
    startQuizByClick(document);
    key(document, '2');
    eq(ev(window, 'state.answers[0]'), 1, 'number key did not answer');
  });

  it('exam mode: arrow keys move between questions', () => {
    const { document, window } = boot();
    clickCourse(document, 'acct');
    setMode(document, 'exam');
    startQuizByClick(document);
    key(document, 'ArrowLeft');
    eq(ev(window, 'state.idx'), 1, 'ArrowLeft did not advance (RTL)');
    key(document, 'ArrowRight');
    eq(ev(window, 'state.idx'), 0, 'ArrowRight did not go back (RTL)');
  });

  it('study mode: number keys answer the first unanswered question', () => {
    const { document, window } = boot();
    clickCourse(document, 'acct');
    startQuizByClick(document);
    key(document, '3');
    eq(ev(window, 'state.answers[0]'), 2, 'study shortcut did not answer');
  });

  it('study mode: shortcuts do not overwrite a locked answer', () => {
    const { document, window } = boot();
    clickCourse(document, 'acct');
    startQuizByClick(document);
    key(document, '3');
    key(document, '1');
    eq(ev(window, 'state.answers[0]'), 2, 'locked answer was overwritten by keyboard');
  });

  it('study shortcuts target the focused card', () => {
    const { document, window } = boot();
    clickCourse(document, 'acct');
    startQuizByClick(document);
    const card = document.querySelector('#q2');
    assert(card, 'card #q2 missing');
    const target = card.querySelector('.opt') || card;
    key(document, '1', target);
    eq(ev(window, 'state.answers[2]'), 0, 'focused card did not receive the shortcut');
  });

  it('ignores shortcuts while typing in the timer field', () => {
    const { document, window } = boot();
    clickCourse(document, 'acct');
    setMode(document, 'exam');
    startQuizByClick(document);
    const input = document.createElement('input');
    document.body.appendChild(input);
    key(document, '3', input);
    eq(ev(window, 'state.answers[0]'), undefined, 'shortcut fired while typing');
  });

  it('ignores shortcuts when a modifier is held', () => {
    const { document, window } = boot();
    clickCourse(document, 'acct');
    setMode(document, 'exam');
    startQuizByClick(document);
    const e = new window.KeyboardEvent('keydown', { key: '2', ctrlKey: true, bubbles: true });
    document.body.dispatchEvent(e);
    eq(ev(window, 'state.answers[0]'), undefined, 'shortcut fired with Ctrl held');
  });
});
