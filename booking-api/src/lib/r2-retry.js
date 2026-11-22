// R2 retries (Nov 21, 2026). Uploads of real menu files failed with R2's own "We encountered an internal error.
// Please try again. (10001)" while small files went through, so every visitor's menu upload answered "could not be
// saved". R2's guidance for 10001 and other 5xx errors is to retry, so the upload and preview paths try up to three
// times with a short pause. A missing object (get returning null) is not an error and is never retried.
const PAUSES_MS = [250, 750];

function retryable(error) {
  const text = String(error?.message || error || "");
  return /\(100(01|43|58)\)|internal error|try again|timed? ?out|network|reset/i.test(text);
}

async function withR2Retry(task, { pauses = PAUSES_MS, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let last;
  for (let attempt = 0; attempt <= pauses.length; attempt++) {
    try {
      return await task();
    } catch (error) {
      last = error;
      if (attempt === pauses.length || !retryable(error)) break;
      console.error(`R2 retry ${attempt + 1}: ${String(error?.message || error).slice(0, 120)}`);
      await sleep(pauses[attempt]);
    }
  }
  throw last;
}

function r2Put(bucket, key, value, options, retry) {
  return withR2Retry(() => bucket.put(key, value, options), retry);
}

function r2Get(bucket, key, options, retry) {
  return withR2Retry(() => bucket.get(key, options), retry);
}

export { r2Get, r2Put, retryable, withR2Retry };
