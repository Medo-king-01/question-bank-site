#!/usr/bin/env node
/**
 * Entry point:  node tests/run.mjs
 *
 * Loads every *.test.mjs file (registration only), then runs them in order and
 * exits non-zero on failure so CI can gate on it.
 */
import './data.test.mjs';
import './quiz.test.mjs';
import './a11y.test.mjs';
import './history.test.mjs';
import './search.test.mjs';
import './pwa.test.mjs';
import { run } from './harness.mjs';

const ok = await run();
process.exit(ok ? 0 : 1);
