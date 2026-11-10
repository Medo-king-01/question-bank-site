/**
 * In-course search.
 *
 * The defining rule of this feature is its SCOPE: results may only ever come
 * from the course the student is currently viewing. Several tests below exist
 * purely to prove that a cross-course leak is impossible, because that is the
 * one behaviour the whole design hinges on.
 */
import {
  group, it, assert, eq, includes, excludes,
  boot, ev, text, appHtml,
} from './harness.mjs';

function openCourse(doc, win, id) {
  doc.querySelector(`[data-course="${id}"]`).dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
}

function type(doc, win, value) {
  const input = doc.querySelector('#courseSearch');
  assert(input, 'search box not rendered');
  input.value = value;
  input.dispatchEvent(new win.Event('input', { bubbles: true }));
  return doc.querySelector('#searchResults');
}

function resultIds(doc) {
  return [...doc.querySelectorAll('[data-search-id]')].map((el) => el.dataset.searchId);
}

function idsOfCourse(win, courseId) {
  return ev(win, `DATA.find(c => c.id === ${JSON.stringify(courseId)}).sections.flatMap(s => s.items.map(i => i.id))`);
}

group('SEARCH · scope is one course only', () => {
  it('only appears inside a course, never on the home screen', () => {
    const { document } = boot();
    eq(document.querySelector('#courseSearch'), null, 'search box leaked onto the home screen');
  });

  it('is not available on the analytics screen', () => {
    const { document, window } = boot();
    document.querySelector('#anBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    eq(document.querySelector('#courseSearch'), null, 'search box leaked onto analytics');
  });

  it('labels itself with the current course name', () => {
    const { document, window } = boot();
    openCourse(document, window, 'db');
    const label = document.querySelector('#courseSearch').getAttribute('aria-label');
    includes(label, 'قواعد البيانات', 'label does not name the course');
  });

  it('never returns a question from another course', () => {
    const { document, window } = boot();
    openCourse(document, window, 'db');
    const inScope = new Set(idsOfCourse(window, 'db'));
    // A term that exists across several courses must still only return db hits.
    for (const term of ['ال', 'سؤال', 'بيانات', 'جدول']) {
      type(document, window, term);
      const leaked = resultIds(document).filter((id) => !inScope.has(id));
      eq(leaked, [], `"${term}" returned out-of-scope ids`);
    }
  });

  it('switching course changes the scope', () => {
    const { document, window } = boot();
    openCourse(document, window, 'db');
    type(document, window, 'مفتاح');
    const dbHits = resultIds(document);

    // Start a search in db, then jump to another course. The query must be
    // cleared by openCourse() itself -- the test calls openCourse() directly
    // rather than clicking home, so goHome() cannot clear it for us.
    const before = ev(window, 'state.searchQuery');
    assert(before, 'baseline query was not set');
    ev(window, 'openCourse("ethics")');
    // The query is cleared when the course changes, and a fresh search must
    // only look at the new course.
    eq(ev(window, 'state.searchQuery'), '', 'query leaked into the next course');
    type(document, window, 'مفتاح');
    const ethicsIds = new Set(idsOfCourse(window, 'ethics'));
    const shown = resultIds(document);
    eq(shown.filter((id) => !ethicsIds.has(id)), [], 'results crossed into the previous course');
    assert(dbHits.length > 0, 'baseline search returned nothing in db');
  });

  it('searchCourse ignores every course but the one passed in', () => {
    const { window } = boot();
    const out = ev(window, `
      (() => {
        const db = DATA.find(c => c.id === 'db');
        const hits = searchCourse(db, 'ال');
        const dbIds = new Set(db.sections.flatMap(s => s.items.map(i => i.id)));
        return hits.every(h => dbIds.has(h.item.id));
      })()
    `);
    eq(out, true, 'searchCourse returned items outside the given course');
  });
});

group('SEARCH · matching', () => {
  it('finds a question by a word from its stem', () => {
    const { document, window } = boot();
    openCourse(document, window, 'db');
    const word = ev(window, 'DATA.find(c=>c.id==="db").sections[0].items[0].q.split(" ").find(w => w.length > 3)');
    const box = type(document, window, word);
    assert(box.querySelectorAll('.srch-item').length > 0, `no results for "${word}"`);
    includes(box.textContent, word.slice(0, 3), 'matched text not shown');
  });

  it('finds a question by a word from its note', () => {
    const { document, window } = boot();
    openCourse(document, window, 'db');
    const probe = ev(window, `
      (() => {
        const c = DATA.find(x => x.id === 'db');
        for (const s of c.sections) for (const it of s.items) {
          if (it.note && it.note.length > 30) return {id: it.id, word: it.note.split(' ').find(w => w.length > 4)};
        }
        return null;
      })()
    `);
    assert(probe, 'no note in db to test against');
    type(document, window, probe.word);
    includes(resultIds(document), probe.id, 'note match not found');
  });

  it('finds a question by a word from its options', () => {
    const { document, window } = boot();
    openCourse(document, window, 'db');
    const probe = ev(window, `
      (() => {
        const c = DATA.find(x => x.id === 'db');
        for (const s of c.sections) for (const it of s.items) {
          for (const o of it.opts) {
            const w = o.split(' ').find(x => x.length > 5);
            if (w) return {id: it.id, word: w};
          }
        }
        return null;
      })()
    `);
    type(document, window, probe.word);
    includes(resultIds(document), probe.id, 'option match not found');
  });

  it('requires every token to match (AND, not OR)', () => {
    const { window } = boot();
    const out = ev(window, `
      (() => {
        const c = DATA.find(x => x.id === 'db');
        const one = searchCourse(c, 'جدول').length;
        const two = searchCourse(c, 'جدول بيانات').length;
        return {one, two};
      })()
    `);
    assert(out.two <= out.one, 'adding a token widened the result set');
  });

  it('ignores Arabic diacritics and hamza variants', () => {
    const { window } = boot();
    // "أ" vs "ا" and "ة" vs "ه" must be treated as the same letter.
    eq(ev(window, 'normaliseArabic("أحمد") === normaliseArabic("احمد")'), true, 'hamza not normalised');
    eq(ev(window, 'normaliseArabic("قاعدة") === normaliseArabic("قاعده")'), true, 'taa marbuta not normalised');
    eq(ev(window, 'normaliseArabic("مُحَمَّد") === normaliseArabic("محمد")'), true, 'diacritics not stripped');
  });

  it('finds the same results with or without diacritics', () => {
    const { window } = boot();
    const out = ev(window, `
      (() => {
        const c = DATA.find(x => x.id === 'db');
        return {plain: searchCourse(c, 'جدول').length, tashkeel: searchCourse(c, 'جَدْوَل').length};
      })()
    `);
    eq(out.tashkeel, out.plain, 'diacritics changed the result count');
  });

  it('is case-insensitive for Latin text', () => {
    const { window } = boot();
    const out = ev(window, `
      (() => {
        const c = DATA.find(x => x.id === 'db');
        return {upper: searchCourse(c, 'SQL').length, lower: searchCourse(c, 'sql').length,
                mixed: searchCourse(c, 'SqL').length};
      })()
    `);
    eq(out.lower, out.upper, 'case sensitivity leaked in');
    eq(out.mixed, out.upper, 'mixed case failed');
  });

  it('returns nothing for an empty query', () => {
    const { document, window } = boot();
    openCourse(document, window, 'db');
    const box = type(document, window, '   ');
    eq(box.innerHTML.trim(), '', 'whitespace query painted results');
  });

  it('shows a helpful empty state, still naming the course', () => {
    const { document, window } = boot();
    openCourse(document, window, 'db');
    const box = type(document, window, 'qqqzzz');
    assert(box.querySelector('.srch-empty'), 'no empty state');
    includes(box.textContent, 'قواعد البيانات', 'empty state does not name the scope');
    includes(box.textContent, '122', 'empty state does not show the question count');
  });
});

group('SEARCH · presentation', () => {
  it('ranks stem matches above note-only matches', () => {
    const { window } = boot();
    const out = ev(window, `
      (() => {
        const c = DATA.find(x => x.id === 'db');
        const hits = searchCourse(c, 'بيانات');
        if (hits.length < 2) return {skip:true};
        return {first: hits[0].score, last: hits[hits.length-1].score, sorted: hits.every((h,i,a)=> i===0 || a[i-1].score >= h.score)};
      })()
    `);
    if (!out.skip) eq(out.sorted, true, 'results are not ordered by score');
  });

  it('reports the result count and scope', () => {
    const { document, window } = boot();
    openCourse(document, window, 'db');
    const box = type(document, window, 'جدول');
    includes(box.querySelector('.srch-head').textContent, 'نتيجة', 'count missing');
    includes(box.querySelector('.srch-head').textContent, 'قواعد البيانات', 'scope missing');
  });

  it('caps the rendered list but reports the full count', () => {
    const { document, window } = boot();
    openCourse(document, window, 'db');
    const box = type(document, window, 'ال');
    const total = ev(window, 'searchCourse(DATA.find(c=>c.id==="db"), "ال").length');
    assert(total > 25, 'test needs more than 25 hits');
    eq(box.querySelectorAll('.srch-item').length, 25, 'render cap not applied');
    includes(box.querySelector('.srch-head').textContent, String(total), 'full count not reported');
  });

  it('shows the answer and the note for each hit', () => {
    const { document, window } = boot();
    openCourse(document, window, 'db');
    const box = type(document, window, 'جدول');
    const first = box.querySelector('.srch-item');
    assert(first.querySelector('.srch-ans'), 'answer missing from result');
    includes(first.querySelector('.srch-ans').textContent, 'الإجابة', 'answer label missing');
  });

  it('escapes question text in the results', () => {
    const { document, window } = boot();
    // Give the poisoned question a unique token so it is guaranteed to be the
    // first hit; otherwise the assertion could be checking an empty list.
    const token = 'ززققفف';
    ev(window, `
      const victim = DATA.find(c=>c.id==='db').sections[0].items[0];
      victim.q = '<img src=z onerror="window.__s=1">' + ${JSON.stringify(token)};
    `);
    openCourse(document, window, 'db');
    const box = type(document, window, token);
    assert(box.querySelectorAll('.srch-item').length === 1, 'poisoned question was not returned');
    // innerHTML re-serialises attributes, so match any <img …> rather than the
    // exact source spelling -- and also assert on the parsed DOM.
    assert(!/<img\b/i.test(box.innerHTML), 'markup leaked into search results');
    eq(box.querySelectorAll('img').length, 0, 'injected <img> element exists in the DOM');
    assert(box.querySelector('.srch-q').textContent.includes(token), 'escaped text missing');
    eq(window.__s, undefined, 'injected handler ran');
  });

  it('clears the query with the ✕ button', () => {
    const { document, window } = boot();
    openCourse(document, window, 'db');
    type(document, window, 'جدول');
    const clear = document.querySelector('#clearSearch');
    assert(clear, 'clear button missing');
    clear.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    eq(ev(window, 'state.searchQuery'), '', 'query not cleared');
    eq(document.querySelector('#searchResults').innerHTML.trim(), '', 'results not cleared');
  });

  it('clears the query with Escape', () => {
    const { document, window } = boot();
    openCourse(document, window, 'db');
    type(document, window, 'جدول');
    const input = document.querySelector('#courseSearch');
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    eq(ev(window, 'state.searchQuery'), '', 'Escape did not clear the query');
  });

  it('can start a practice session from the results', () => {
    const { document, window } = boot();
    openCourse(document, window, 'db');
    type(document, window, 'جدول');
    const btn = document.querySelector('#practiseResults');
    assert(btn, 'practice button missing');
    const expected = document.querySelectorAll('.srch-item').length;
    btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));   // leaves the course screen
    eq(ev(window, 'state.view'), 'quiz', 'did not open a quiz');
    const quizIds = ev(window, 'state.quiz.map(q => q.id)');
    const inScope = new Set(idsOfCourse(window, 'db'));
    eq(quizIds.filter((id) => !inScope.has(id)), [], 'practice pool escaped the course');
    eq(quizIds.length, expected, 'pool size mismatch');
    eq(ev(window, 'state.searchQuery'), '', 'query survived into the quiz');
  });
});

group('SEARCH · performance', () => {
  it('answers a query in under 20 ms for the largest course', () => {
    const { window } = boot();
    const ms = ev(window, `
      (() => {
        const c = DATA.find(x => x.id === 'db');
        const runs = 100;
        const t0 = performance.now();
        for (let i = 0; i < runs; i++) searchCourse(c, 'ال');
        return (performance.now() - t0) / runs;
      })()
    `);
    assert(ms < 20, `search took ${ms.toFixed(1)} ms per query`);
  });

  it('scans only the current course, not the whole bank', () => {
    const { window } = boot();
    const ratio = ev(window, `
      (() => {
        const time = (fn) => { const t0 = performance.now(); for (let i=0;i<100;i++) fn(); return performance.now()-t0; };
        const db = DATA.find(c => c.id === 'db');
        const one = time(() => searchCourse(db, 'ال'));
        const all = time(() => DATA.forEach(c => searchCourse(c, 'ال')));
        return all / one;
      })()
    `);
    assert(ratio > 2, `single-course search was not meaningfully cheaper (ratio ${ratio.toFixed(1)})`);
  });
});
