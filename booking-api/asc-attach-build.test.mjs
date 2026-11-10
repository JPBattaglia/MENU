import test from "node:test";
import assert from "node:assert/strict";
import { editableVersion, internalGroups } from "./scripts/asc-attach-build.mjs";

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
