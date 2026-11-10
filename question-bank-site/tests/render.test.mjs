/**
 * Rendered-layout tests for the home progress block.
 *
 * The CSS tests next door prove what the stylesheet *says*. These prove what
 * the browser would actually *place*, by handing the real stylesheet to a
 * geometry engine (scripts/render_home_layout.py) that resolves the grid and
 * reports boxes. That engine also paints PNGs into docs/screenshots so a human
 * can look at the same numbers.
 *
 * This is the layer that catches "the CSS is right but the layout is wrong":
 * a pinned streak passed every stylesheet assertion and still rendered the
 * badge between two rows of statistics at 390px.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { group, it, assert, eq, ROOT } from './harness.mjs';

let report = null;

function renderReport() {
  if (report) return report;
  const out = execFileSync('python3', ['scripts/render_home_layout.py'], {
    cwd: ROOT, encoding: 'utf8', timeout: 300000,
  });
  report = JSON.parse(out.slice(out.indexOf('[')));
  return report;
}

const at = (report, width, theme) => {
  const row = report.find((r) => r.width === width && r.theme === theme);
  assert(row, `no render for ${width}px ${theme}`);
  return row;
};

group('RENDER · home progress block', () => {
  it('renders every reviewed width in both themes', () => {
    const rows = renderReport();
    const wanted = [
      [1440, 'light'], [768, 'light'], [390, 'light'],
      [768, 'dark'], [390, 'dark'],
    ];
    for (const [w, t] of wanted) {
      const row = at(rows, w, t);
      assert(row.image, `missing image path for ${w}px ${t}`);
    }
  });

  it('produces no overlapping boxes at any width', () => {
    /* The original defect in this area was an absolutely positioned pill
       sitting on top of a number. Overlap is now measured, not assumed away. */
    for (const row of renderReport()) {
      eq(row.collisions, [], `boxes overlap at ${row.width}px ${row.theme}`);
    }
  });

  it('keeps the statistics side by side and the badge underneath at 390px', () => {
    const row = at(renderReport(), 390, 'light');
    eq(row.columns, 2, 'phone width must resolve to two columns');
    eq(row.rows, 3, 'two stat rows plus the badge row');
    eq(row.streak_below_all_stats, true, 'the badge must sit below every statistic');
  });

  it('keeps four statistics in one row and the badge underneath at 768px', () => {
    const row = at(renderReport(), 768, 'light');
    eq(row.columns, 4, 'tablet width fits four statistics');
    eq(row.rows, 2, 'one stat row plus the badge row');
    eq(row.streak_below_all_stats, true, 'the badge must sit below the statistics');
  });

  it('matches the same placement in dark mode', () => {
    for (const width of [768, 390]) {
      const light = at(renderReport(), width, 'light');
      const dark = at(renderReport(), width, 'dark');
      eq(dark.columns, light.columns, `${width}px: themes must place the same columns`);
      eq(dark.rows, light.rows, `${width}px: themes must place the same rows`);
      eq(dark.streak_below_all_stats, true, `${width}px dark: badge must stay below`);
    }
  });

  it('keeps the badge readable on its own tint in both themes', () => {
    for (const row of renderReport()) {
      assert(row.contrast_badge >= 4.5,
        `${row.width}px ${row.theme}: badge contrast is ${row.contrast_badge}:1`);
      assert(row.contrast_number >= 4.5,
        `${row.width}px ${row.theme}: stat number contrast is ${row.contrast_number}:1`);
    }
  });

  it('writes the screenshots it claims to write', () => {
    for (const row of renderReport()) {
      const path = join(ROOT, row.image);
      assert(existsSync(path), `missing screenshot: ${row.image}`);
      assert(statSync(path).size > 2000, `screenshot is suspiciously small: ${row.image}`);
      const head = readFileSync(path).subarray(0, 8);
      assert(head.toString('hex').startsWith('89504e47'), `${row.image} is not a PNG`);
    }
  });
});
