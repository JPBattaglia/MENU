import test from 'node:test';
import assert from 'node:assert/strict';
import { SETUP_WAIVER, setupWaiverOn } from './src/checkout/quote.js';

// Holiday setup waiver (owner, Nov 20, 2026): no $149 setup on MΞNU Plus or Pro through Dec 31, 2026 PT; ends by itself.
test('holiday setup waiver runs through Dec 31, 2026 Pacific and ends on its own', () => {
  assert.equal(SETUP_WAIVER.ends, 'Dec 31');
  assert.equal(setupWaiverOn(Date.parse('2026-11-20T18:00:00Z')), true);
  assert.equal(setupWaiverOn(Date.parse('2026-12-31T23:59:00-08:00')), true, 'last minute of Dec 31 PT');
  assert.equal(setupWaiverOn(Date.parse('2027-01-01T00:00:00-08:00')), false, 'Jan 1 PT');
  assert.equal(setupWaiverOn(Date.parse('2027-03-01T00:00:00Z')), false);
});
