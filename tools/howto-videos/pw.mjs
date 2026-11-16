// Playwright from the repo's node_modules, or a global install (npm i -g playwright) when NODE_PATH points at it.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch {
  const root = execSync('npm root -g').toString().trim();
  pw = require(`${root}/playwright`);
}
export const { chromium } = pw;
