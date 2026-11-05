import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCommit } from "../scripts/check-commit.mjs";

test("commit convention accepts scoped fixes, breaking changes and explanatory bodies", () => {
  for (const message of [
    "feat: add search view navigation",
    "fix(duckduckgo): preserve native shortcuts\n\nKeep typing native.",
    "refactor(core)!: version adapter snapshots",
  ])
    assert.equal(validateCommit(message), null);
});
test("commit convention rejects vague, malformed and oversized titles", () => {
  for (const message of [
    "",
    "WIP",
    "fix:",
    "features: add keys",
    "fix: " + "x".repeat(70),
  ])
    assert.ok(validateCommit(message));
});
