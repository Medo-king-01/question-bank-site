/**
 * Data-level tests: the shipped index.html must contain a coherent question
 * bank, and the escaping choke point must actually neutralise markup.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { group, it, assert, eq, ROOT, boot, ev, excludes, appHtml } from './harness.mjs';

const data = JSON.parse(readFileSync(join(ROOT, 'src/data.json'), 'utf8'));

function eachQuestion(fn) {
  data.forEach((c) => c.sections.forEach((s) => s.questions.forEach((q) => fn(q, s, c))));
}

group('DATA · question bank', () => {
  it('has the 8 expected courses', () => {
    eq(data.length, 8, 'course count');
    const ids = data.map((c) => c.id);
    eq(ids, ['ethics', 'invest', 'acct', 'prog', 'macro', 'gov', 'ins', 'db'], 'course ids/order');
  });

  it('still has 709 questions across 32 sections', () => {
    const sections = data.reduce((n, c) => n + c.sections.length, 0);
    let total = 0;
    eachQuestion(() => total++);
    eq(total, 709, 'question count');
    eq(sections, 32, 'section count');
  });

  it('every question id is present and globally unique', () => {
    const ids = new Set();
    const dupes = [];
    eachQuestion((q) => {
      assert(typeof q.id === 'string' && q.id.length > 0, `missing id: ${q.q?.slice(0, 40)}`);
      if (ids.has(q.id)) dupes.push(q.id);
      ids.add(q.id);
    });
    eq(dupes, [], 'duplicate ids');
    eq(ids.size, 709, 'unique id count');
  });

  it('every mcq answer points at a real option', () => {
    eachQuestion((q, s) => {
      if (s.type !== 'mcq') return;
      assert(Array.isArray(q.options) && q.options.length >= 2, `few options: ${q.id}`);
      assert(Number.isInteger(q.ans), `mcq ans not integer: ${q.id}`);
      assert(q.ans >= 0 && q.ans < q.options.length, `ans out of range: ${q.id}`);
      assert(q.options.every((o) => o.trim().length > 0), `empty option: ${q.id}`);
    });
  });

  it('every tf answer is a real boolean and carries no options', () => {
    eachQuestion((q, s) => {
      if (s.type !== 'tf') return;
      assert(typeof q.ans === 'boolean', `tf ans not boolean: ${q.id}`);
      assert(!q.options || q.options.length === 0, `tf question carries options: ${q.id}`);
    });
  });

  it('no question text contains HTML markup', () => {
    const offenders = [];
    eachQuestion((q) => {
      const texts = [q.q, ...(q.options || []), q.note || ''];
      texts.forEach((t) => {
        if (t && /<\s*\/?\s*[a-zA-Z][a-zA-Z0-9]*\b[^<>]*>/.test(t)) offenders.push([q.id, t.slice(0, 50)]);
      });
    });
    eq(offenders, [], 'markup found in question text');
  });
});

group('SECURITY · escaping', () => {
  it('the built site defines a single esc() choke point', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    assert(/function esc\(/.test(html), 'esc() is missing from index.html');
  });

  it('a question containing markup renders as text, not as HTML', () => {
    // Patch a live question with a hostile stem, then route it through the real
    // result screen (which prints q.q, q.opts and q.note through esc()).
    const { window, document } = boot();
    const poison = '<img src=x onerror="window.__pwned=1">سؤال';
    ev(window, `
      const victim = DATA[0].sections[0].items[0];
      victim.q = ${JSON.stringify(poison)};
      victim.note = '<script>window.__pwned2=1<\/script>شرح';
      state.course = DATA[0];
      state.quiz = [victim];
      state.answers = {0: (victim.ans + 1) % victim.opts.length};
      state.mode = 'study';
      state.view = 'result';
      render();
    `);
    // The result screen renders wrong answers only, so this poisoned question
    // must show up there -- otherwise the assertion below proves nothing.
    const html = document.querySelector('#app').innerHTML;
    assert(html.includes('سؤال'), 'poisoned question never rendered; test is vacuous');
    excludes(html, '<img src=x', 'raw markup leaked into the DOM');
    assert(/&lt;img/.test(html), 'markup was not escaped');
    assert(!/<script/i.test(html), 'script tag survived');
    eq(window.__pwned, undefined, 'injected handler executed');
    eq(window.__pwned2, undefined, 'injected script executed');
  });

  it('escapes the stem, options and note on the quiz screen', () => {
    // qCard() is the main rendering path: exercise it directly with hostile
    // text in every field it interpolates.
    const { window, document } = boot();
    ev(window, `
      const victim = DATA[0].sections[0].items[0];
      victim.q = '<img src=y onerror="window.__pwned3=1">سؤال';
      victim.opts = victim.opts.map(o => '<b>' + o + '</b>');
      victim.note = '<iframe src="javascript:1"></iframe>شرح';
      state.course = DATA[0];
      state.quiz = [victim];
      state.answers = {0: victim.ans};
      state.mode = 'study';
      state.view = 'quiz';
      render();
    `);
    const html = document.querySelector('#app').innerHTML;
    assert(html.includes('سؤال') && html.includes('شرح'), 'quiz screen did not render the question');
    excludes(html, '<img src=y', 'stem markup leaked');
    excludes(html, '<b>', 'option markup leaked');
    excludes(html, '<iframe', 'note markup leaked');
    assert(/&lt;img/.test(html), 'stem was not escaped');
    eq(window.__pwned3, undefined, 'injected handler executed');
  });

  it('escapes course and section titles on the course screen', () => {
    const { window, document } = boot();
    ev(window, `
      DATA[0].title = '<b>عنوان خبيث</b>';
      DATA[0].sections[0].title = '<i>قسم خبيث</i>';
      openCourse(DATA[0].id);
    `);
    const html = appHtml(document);
    excludes(html, '<b>عنوان خبيث', 'course title not escaped');
    excludes(html, '<i>قسم خبيث', 'section title not escaped');
    assert(/&lt;b&gt;/.test(html), 'course title markup missing from DOM');
  });

  it('escapes the five dangerous characters', () => {
    const { window } = boot();
    const got = ev(window, `esc('&<>"\\'')`);
    eq(got, '&amp;&lt;&gt;&quot;&#39;', 'esc() output');
  });

  it('esc() passes null/undefined through as empty string', () => {
    const { window } = boot();
    eq(ev(window, `esc(null)`), '', 'esc(null)');
    eq(ev(window, `esc(undefined)`), '', 'esc(undefined)');
    eq(ev(window, `esc(0)`), '0', 'esc(0)');
  });
});
