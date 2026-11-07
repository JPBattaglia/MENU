import assert from "node:assert/strict";
import test from "node:test";
import { asDomain, customerCents, handleDomainLookup, lookupDomains } from "./src/producers/website/registrar.js";

const env = { CF_REGISTRAR_TOKEN: "t", CF_ACCOUNT_ID: "acct" };

function fakeCloudflare(calls = []) {
  return async (url, init = {}) => {
    calls.push({ url, init });
    if (url.includes("/domain-check")) {
      const { domains } = JSON.parse(init.body);
      return Response.json({ success: true, result: { domains: domains.map((name) => name === "taken.com"
        ? { name, registrable: false, reason: "domain_unavailable" }
        : { name, registrable: true, tier: "standard", pricing: { currency: "USD", registration_cost: "10.11", renewal_cost: "10.11" } }) } });
    }
    if (url.includes("/domain-search")) {
      return Response.json({ success: true, result: { domains: [
        { name: "joespizza.com", registrable: true, tier: "standard", pricing: { currency: "USD", registration_cost: "8.57", renewal_cost: "8.57" } },
        { name: "joespizza.app", registrable: true, tier: "premium", pricing: { currency: "USD", registration_cost: "900", renewal_cost: "900" } },
        { name: "joespizza.dev", registrable: true, tier: "standard", pricing: { currency: "USD", registration_cost: "10.11", renewal_cost: "12.00" } }
      ] } });
    }
    return new Response("{}", { status: 404 });
  };
}

test("domain names are cleaned and priced at cost + $5", () => {
  assert.equal(asDomain("https://www.JoesPizza.com/menu"), "joespizza.com");
  assert.equal(asDomain("joes pizza"), null);
  assert.equal(customerCents("10.11"), 1511);
  assert.equal(customerCents("nope"), null);
});

test("lookup checks an exact name live, lists it first, hides premium names and never shows Cloudflare's cost", async () => {
  const calls = [];
  const { exact, results } = await lookupDomains(env, "joespizza.com", { fetchImpl: fakeCloudflare(calls) });
  assert.equal(exact, "joespizza.com");
  assert.deepEqual(results.map((d) => d.name), ["joespizza.com", "joespizza.app", "joespizza.dev"]);
  assert.deepEqual(results[0], { name: "joespizza.com", available: true, price_cents: 1511, renewal_cents: 1511 });
  assert.equal(results[1].available, false);
  assert.equal(results[2].renewal_cents, 1700);
  assert.ok(calls.every((c) => c.url.startsWith("https://api.cloudflare.com/client/v4/accounts/acct/registrar/")));
  assert.ok(calls.every((c) => c.init.headers.Authorization === "Bearer t"));
  assert.ok(!JSON.stringify(results).includes("registration_cost"));
});

test("a taken name says so", async () => {
  const { results } = await lookupDomains(env, "taken.com", { fetchImpl: fakeCloudflare() });
  assert.deepEqual(results[0], { name: "taken.com", available: false, reason: "Already taken" });
});

test("the endpoint is off without the token, and refuses empty searches", async () => {
  const off = await handleDomainLookup(new Request("https://menu-made.com/api/domains?q=joes"), {}, { cache: null });
  assert.deepEqual(await off.json(), { ok: true, enabled: false });
  const empty = await handleDomainLookup(new Request("https://menu-made.com/api/domains?q=a"), env, { cache: null, fetchImpl: fakeCloudflare() });
  assert.equal(empty.status, 400);
  const good = await handleDomainLookup(new Request("https://menu-made.com/api/domains?q=joes%20pizza"), env, { cache: null, fetchImpl: fakeCloudflare() });
  const body = await good.json();
  assert.equal(body.enabled, true);
  assert.equal(body.results.length, 3);
});

test("a Cloudflare failure becomes a friendly 502", async () => {
  const broken = async () => Response.json({ success: false, errors: [{ message: "Authentication error" }] }, { status: 403 });
  const res = await handleDomainLookup(new Request("https://menu-made.com/api/domains?q=joespizza.com"), env, { cache: null, fetchImpl: broken });
  assert.equal(res.status, 502);
});
