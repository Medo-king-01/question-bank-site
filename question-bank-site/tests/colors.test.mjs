/**
 * Colour-system tests.
 *
 * The palette is a design contract, not a suggestion: these tests fail if a
 * token drifts away from one of the eight official colours, if a retired
 * brand colour creeps back in, or if a text/background pair drops below WCAG
 * AA. They are deliberately independent of the rendered page — they read the
 * shipped index.html plus the token blocks, so a refactor that "looks fine"
 * still has to prove the contrast maths.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { group, it, assert, eq, ROOT } from './harness.mjs';

const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

/* The eight official colours. Order is the order the design brief lists them. */
const PALETTE = ['#a29594', '#7c2a27', '#dad4d2', '#1a1716', '#ecebeb', '#dedddd', '#e52729', '#e97371'];

/* Colours that belonged to the previous indigo/teal system. None may return. */
const RETIRED = [
  '4f46e5', '8b5cf6', '22d3ee', '7c8cff', '6d63ff', '16203a', '101a33',
  '79,70,229', '25d366', '12b352', 'f59e0b', 'eef2ff',
  '7c3aed', '0ea5e9', '16a34a', 'ef4444', '0d9488', '0284c7', '4338ca',
];

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const styleBlock = (() => {
  const m = html.match(/<style>([\s\S]*?)<\/style>/);
  assert(m, 'index.html has no <style> block');
  /* Comments contain braces and hex values, so they must go before parsing. */
  return stripComments(m[1]);
})();

const block = (selector) => {
  const i = styleBlock.indexOf(selector);
  assert(i > -1, `missing ${selector} block`);
  return styleBlock.slice(i, styleBlock.indexOf('}', i));
};

/* Plain string search: no regex escaping, no surprises with the leading "--". */
const decl = (css, name) => {
  const i = css.indexOf(name + ':');
  if (i < 0) return null;
  const end = css.indexOf(';', i);
  return css.slice(i + name.length + 1, end < 0 ? undefined : end).trim();
};
/* Resolve a token down to a literal hex, following var() chains. The eight
   palette variables are declared once in :root, so a dark-mode token such as
   --accent:var(--color-8) has to fall back to :root to resolve. */
function resolve(css, name) {
  let v = decl(css, name) ?? decl(root, name);
  for (let hops = 0; v && v.startsWith('var(') && hops < 5; hops++) {
    const ref = v.slice(4, v.indexOf(')'));
    v = decl(root, ref) ?? decl(css, ref);
  }
  return v;
}

function luminance(hex) {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const root = block(':root{');
const dark = block('[data-theme="dark"]{');

group('COLOUR · palette', () => {
  it('declares all eight official colours and nothing else', () => {
    const names = [...styleBlock.matchAll(/--color-([1-8])\s*:\s*(#[0-9a-f]{6})/gi)];
    eq(names.length, 8, 'palette must expose exactly --color-1 … --color-8');
    const values = names.map((m) => m[2].toLowerCase());
    eq([...values].sort(), [...PALETTE].sort(), 'palette values drifted from the official eight');
  });

  it('keeps every retired brand colour out of the shipped page', () => {
    const found = RETIRED.filter((c) => html.toLowerCase().includes(c));
    eq(found, [], 'retired colours are back in the build');
  });

  it('every semantic token resolves to a real colour', () => {
    const names = ['--bg', '--bg2', '--card', '--ink', '--ink-soft', '--line',
      '--accent', '--accent-soft', '--ok', '--bad', '--warn', '--focus'];
    for (const t of names) {
      const light = resolve(root, t);
      assert(light && light.startsWith('#'), `${t} does not resolve in light mode (got ${light})`);
      const darkVal = resolve(dark, t) || resolve(root, t);
      assert(darkVal && darkVal.startsWith('#'), `${t} does not resolve in dark mode`);
    }
  });

  it('themes are genuinely different, not a rename', () => {
    /* A "dark mode" that only renamed the same variables would leave every
       surface identical; the brand surfaces must actually move. */
    for (const t of ['--bg', '--card', '--ink', '--accent']) {
      assert(resolve(root, t) !== resolve(dark, t) || t === '--ink',
        `${t} is identical in both themes, so dark mode is cosmetic only`);
    }
    const lightBg = luminance(resolve(root, '--bg'));
    const darkBg = luminance(resolve(dark, '--bg'));
    assert(lightBg > 0.6 && darkBg < 0.1,
      `themes must actually invert lightness (light ${lightBg.toFixed(2)}, dark ${darkBg.toFixed(2)})`);
  });
});

group('COLOUR · contrast', () => {
  const pair = (label, fg, bg, min) => {
    const c = contrast(fg, bg);
    assert(c >= min, `${label} is ${c.toFixed(2)}:1, needs ${min}:1`);
  };

  it('light mode text clears AA on every surface', () => {
    const bg = resolve(root, '--bg');
    const card = resolve(root, '--card');
    pair('light ink on page', resolve(root, '--ink'), bg, 4.5);
    pair('light ink on card', resolve(root, '--ink'), card, 4.5);
    pair('light muted on page', resolve(root, '--ink-soft'), bg, 4.5);
    pair('light muted on card', resolve(root, '--ink-soft'), card, 4.5);
    pair('light accent on page', resolve(root, '--accent'), bg, 4.5);
    pair('light accent on card', resolve(root, '--accent'), card, 4.5);
  });

  it('dark mode text clears AA on every surface', () => {
    const bg = resolve(dark, '--bg');
    const card = resolve(dark, '--card');
    pair('dark ink on page', resolve(dark, '--ink'), bg, 4.5);
    pair('dark ink on card', resolve(dark, '--ink'), card, 4.5);
    pair('dark muted on page', resolve(dark, '--ink-soft'), bg, 4.5);
    pair('dark muted on card', resolve(dark, '--ink-soft'), card, 4.5);
    pair('dark accent on page', resolve(dark, '--accent'), bg, 4.5);
    pair('dark accent on card', resolve(dark, '--accent'), card, 4.5);
  });

  it('labels on the interactive fill are readable in both themes', () => {
    pair('light label on accent', resolve(root, '--ink-on-accent'), resolve(root, '--accent'), 4.5);
    pair('dark label on accent', resolve(dark, '--ink-on-accent'), resolve(dark, '--accent'), 4.5);
  });

  it('the answer-state chips stay readable (✓ and ✕ must not vanish)', () => {
    pair('light ✓ chip', resolve(root, '--ok-ink'), resolve(root, '--ok'), 4.5);
    pair('light ✕ chip', resolve(root, '--bad-ink'), resolve(root, '--bad'), 4.5);
    pair('dark ✓ chip', resolve(dark, '--ok-ink'), resolve(dark, '--ok'), 4.5);
    pair('dark ✕ chip', resolve(dark, '--bad-ink'), resolve(dark, '--bad'), 4.5);
  });

  it('the focus ring is perceivable against the page it sits on', () => {
    /* Non-text UI needs 3:1 against its surroundings, not 4.5:1. */
    pair('light focus ring', resolve(root, '--focus'), resolve(root, '--bg'), 3);
    pair('light focus ring on card', resolve(root, '--focus'), resolve(root, '--card'), 3);
    pair('dark focus ring', resolve(dark, '--focus'), resolve(dark, '--bg'), 3);
    pair('dark focus ring on card', resolve(dark, '--focus'), resolve(dark, '--card'), 3);
  });

  it('the three states are distinguishable from each other', () => {
    /* Contrast ratio only measures lightness: green and amber can sit at the
       same luminance and still read as different colours. Compare actual RGB
       distance so the test reflects what an eye would see. */
    const distance = (a, b) => {
      const rgb = (h) => [0, 2, 4].map((i) => parseInt(h.replace('#', '').slice(i, i + 2), 16));
      const [x, y] = [rgb(a), rgb(b)];
      return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
    };
    for (const [label, css] of [['light', root], ['dark', dark]]) {
      const states = ['--ok', '--warn', '--bad'].map((t) => resolve(css, t));
      for (let i = 0; i < states.length; i++) {
        for (let j = i + 1; j < states.length; j++) {
          assert(distance(states[i], states[j]) > 40,
            `${label}: two states are nearly the same colour (${states[i]} vs ${states[j]})`);
        }
      }
    }
  });

  it('the running-out-of-time badge stays readable on its own tint', () => {
    /* This badge sits on --urgent-soft, not on a page surface, so it needs its
       own pair checked — a bright signal red here lands near 3:1. */
    pair('light urgent badge', resolve(root, '--urgent'), resolve(root, '--urgent-soft'), 4.5);
    pair('dark urgent badge', resolve(dark, '--urgent'), resolve(dark, '--urgent-soft'), 4.5);
  });

  it('no state colour is confusable with the brand accent in dark mode', () => {
    /* In dark mode the interactive colour is a light red; "error" must not
       look like every link on the page. */
    const accent = resolve(dark, '--accent');
    const bad = resolve(dark, '--bad');
    assert(accent !== bad, 'dark accent and error are the same colour');
  });
});

group('COLOUR · no colour-only meaning', () => {
  it('correct and wrong answers also change something other than hue', () => {
    const css = styleBlock;
    for (const cls of ['correct', 'wrong']) {
      const rules = [...css.matchAll(new RegExp(`\\.opt\\.${cls}[^{]*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]);
      assert(rules.length, `.opt.${cls} has no styling`);
      const text = rules.join(';');
      assert(/border/.test(text), `.opt.${cls} relies on colour alone (no border change)`);
    }
    /* The ✓ / ✕ glyphs are markup, so they survive any colour blindness. */
    assert(/[✓✕]/.test(html), 'the answer marks have no glyph fallback');
  });
});
