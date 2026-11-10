#!/usr/bin/env node
/**
 * Entry point:  node tests/run.mjs
 *
 * Loads every *.test.mjs file (registration only), then runs them in order and
 * exits non-zero on failure so CI can gate on it.
 *
 * The version check has to come FIRST and must not import the harness, because
 * jsdom (loaded by the harness) crashes while importing on old Node versions:
 * jsdom 31 pulls in undici 8, which calls the zstd API added in Node 22.7.
 * Without this guard the user sees a stack trace about `createZstdDecompress`
 * instead of "your Node is too old".
 */
const MIN_NODE = [22, 22, 2];
const cur = process.versions.node.split('.').map(Number);
const tooOld =
  cur[0] < MIN_NODE[0] ||
  (cur[0] === MIN_NODE[0] && (cur[1] < MIN_NODE[1] ||
    (cur[1] === MIN_NODE[1] && cur[2] < MIN_NODE[2])));

if (tooOld) {
  console.error(
    '\n  \x1b[31mNode ' + process.versions.node + ' is too old to run these tests.\x1b[0m\n' +
    '  jsdom 31 needs Node >= ' + MIN_NODE.join('.') + '.\n' +
    '  The website itself runs anywhere — this only affects the test runner.\n' +
    '  Fix: upgrade Node, or set node-version to "22" in CI.\n');
  process.exit(1);
}

await import('./data.test.mjs');
await import('./quiz.test.mjs');
await import('./a11y.test.mjs');
await import('./history.test.mjs');
await import('./search.test.mjs');
await import('./pwa.test.mjs');
await import('./colors.test.mjs');

const { run } = await import('./harness.mjs');
const ok = await run();
process.exit(ok ? 0 : 1);
