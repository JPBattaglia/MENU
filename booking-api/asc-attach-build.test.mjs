import test from "node:test";
import assert from "node:assert/strict";
import { editableVersion, internalGroups, groupAddResult, copyInternalGroup, copyTesters, refusal } from "./scripts/asc-attach-build.mjs";

test("only a version that can still be changed gets the new build", () => {
  const v = (id, appStoreState) => ({ id, attributes: { appStoreState } });
  assert.equal(editableVersion([v("a", "READY_FOR_SALE"), v("b", "REJECTED")])?.id, "b");
  assert.equal(editableVersion([v("a", "WAITING_FOR_REVIEW")]), null);
  assert.equal(editableVersion([v("a", "IN_REVIEW")]), null);
  assert.equal(editableVersion([v("a", "PREPARE_FOR_SUBMISSION")])?.id, "a");
  assert.equal(editableVersion(undefined), null);
});

test("only internal TestFlight groups get the build", () => {
  const groups = [{ id: "me", attributes: { isInternalGroup: true } }, { id: "public", attributes: { isInternalGroup: false } }];
  assert.deepEqual(internalGroups(groups).map((g) => g.id), ["me"]);
});

test("group add result names Apple's reason on a refusal", () => {
  assert.equal(groupAddResult({ ok: true, status: 204 }), "build added");
  assert.equal(groupAddResult({ ok: false, status: 409 }), "build added");
  assert.equal(groupAddResult({ ok: false, status: 422, body: { errors: [{ code: "ENTITY_UNPROCESSABLE", title: "Cannot add builds" }] } }), "answer 422 (ENTITY_UNPROCESSABLE: Cannot add builds)");
  assert.equal(groupAddResult({ ok: false, status: 500, body: null }), "answer 500");
});

test("an app with no internal group gets a copy of the account's other one, testers included", async () => {
  const sent = [];
  const call = async (path, init = {}) => {
    sent.push([init.method || "GET", path, init.body ? JSON.parse(init.body) : null]);
    if (path.startsWith("/betaGroups?")) return { ok: true, status: 200, body: { data: [
      { id: "own", attributes: { isInternalGroup: true, name: "Old" }, relationships: { app: { data: { id: "app2" } } } },
      { id: "me", attributes: { isInternalGroup: true, name: "Me" }, relationships: { app: { data: { id: "app1" } } } }] } };
    if (path === "/betaGroups/me/betaTesters?limit=50") return { ok: true, status: 200, body: { data: [{ id: "t1" }] } };
    if (path === "/betaGroups" && init.method === "POST") return { ok: true, status: 201, body: { data: { id: "new", attributes: { isInternalGroup: true, hasAccessToAllBuilds: true } } } };
    if (path === "/betaGroups/new/relationships/betaTesters") return { ok: true, status: 204, body: null };
    return { ok: false, status: 404, body: null };
  };
  const made = await copyInternalGroup(call, "app2");
  assert.equal(made.group.id, "new");
  assert.match(made.message, /made for this app; 1 tester added/);
  const create = sent.find(([m, p]) => m === "POST" && p === "/betaGroups")[2].data;
  assert.deepEqual(create.attributes, { name: "Me", isInternalGroup: true, hasAccessToAllBuilds: true });
  assert.equal(create.relationships.app.data.id, "app2");
  assert.deepEqual(sent.at(-1)[2], { data: [{ type: "betaTesters", id: "t1" }] });
  const none = await copyInternalGroup(async () => ({ ok: true, status: 200, body: { data: [] } }), "app2");
  assert.equal(none.group, null);
});

test("testers Apple won't take by id are added to the group by their address, and a refusal names Apple's reason", async () => {
  const sent = [];
  const call = async (path, init = {}) => {
    sent.push([path, init.body ? JSON.parse(init.body) : null]);
    if (path.endsWith("/relationships/betaTesters")) return { ok: false, status: 409, body: { errors: [{ code: "STATE_ERROR", title: "Tester belongs to another app", detail: "someone@example.com" }] } };
    if (path === "/betaTesters") return { ok: true, status: 201, body: { data: { id: "t2" } } };
    return { ok: false, status: 404, body: null };
  };
  const out = await copyTesters(call, { id: "new" }, [{ id: "t1", attributes: { email: "someone@example.com", firstName: "A", lastName: "B" } }]);
  assert.equal(out, "1 of 1 tester added");
  assert.deepEqual(sent.at(-1)[1].data.relationships.betaGroups.data, [{ type: "betaGroups", id: "new" }]);
  const refused = await copyTesters(async () => ({ ok: false, status: 409, body: { errors: [{ code: "STATE_ERROR", title: "No", detail: "someone@example.com" }] } }), { id: "new" }, [{ id: "t1", attributes: { email: "someone@example.com" } }]);
  assert.equal(refused, "its testers could not be added (answer 409 (STATE_ERROR: No))");
  assert.doesNotMatch(refused, /example\.com/);
  assert.equal(refusal({ status: 500, body: null }), "answer 500");
});
