import test from "node:test";
import assert from "node:assert/strict";
import { r2Get, r2Put, withR2Retry } from "./src/lib/r2-retry.js";

const noWait = { sleep: async () => {} };

test("an R2 internal error (10001) is retried and the second try's result is used", async () => {
  let calls = 0;
  const bucket = { put: async () => { calls++; if (calls === 1) throw new Error("put: We encountered an internal error. Please try again. (10001)"); return { key: "k" }; } };
  const out = await r2Put(bucket, "k", new Uint8Array(3), {}, noWait);
  assert.equal(out.key, "k");
  assert.equal(calls, 2);
});

test("three internal errors in a row still fail, after three tries", async () => {
  let calls = 0;
  const bucket = { get: async () => { calls++; throw new Error("get: We encountered an internal error. Please try again. (10001)"); } };
  await assert.rejects(() => r2Get(bucket, "k", undefined, noWait), /10001/);
  assert.equal(calls, 3);
});

test("a missing object is not an error and is not retried", async () => {
  let calls = 0;
  const bucket = { get: async () => { calls++; return null; } };
  assert.equal(await r2Get(bucket, "k", undefined, noWait), null);
  assert.equal(calls, 1);
});

test("other errors (bad input) fail at once", async () => {
  let calls = 0;
  await assert.rejects(() => withR2Retry(async () => { calls++; throw new TypeError("value must be a string"); }, noWait));
  assert.equal(calls, 1);
});
