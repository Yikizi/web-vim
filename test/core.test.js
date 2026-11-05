import { test } from "node:test";
import assert from "node:assert/strict";
import { Navigation } from "../src/core/navigation.js";
import { validateSnapshot, validateResult } from "../src/core/contract.js";
const item = (id, extra = {}) => ({
  id,
  label: id,
  element: { nodeType: 1, isConnected: true },
  actions: ["open"],
  primaryAction: "open",
  ...extra,
});
const snapshot = (items, kind = "list", pageKey = "feed") => ({
  version: 1,
  pageKey,
  regions: [{ id: "main", kind, items }],
});
const box = (x, y) => ({
  left: x,
  right: x + 80,
  top: y,
  bottom: y + 60,
  width: 80,
  height: 60,
});

test("contract accepts list and rejects duplicate, disconnected and invalid primary items", () => {
  assert.deepEqual(validateSnapshot(snapshot([item("a")])), []);
  const errors = validateSnapshot(
    snapshot([
      item("a"),
      item("a", {
        element: { nodeType: 1, isConnected: false },
        primaryAction: "delete",
      }),
    ]),
  );
  assert.equal(errors.length, 3);
});
test("contract rejects broken tree relationships and cycles", () => {
  assert.match(
    validateSnapshot(snapshot([item("a", { parentId: "missing" })], "tree")).join(),
    /missing parent/,
  );
  assert.match(
    validateSnapshot(
      snapshot([item("a", { parentId: "b" }), item("b", { parentId: "a" })], "tree"),
    ).join(),
    /cycle/,
  );
  assert.match(
    validateSnapshot(snapshot([item("a", { parentId: "a" })])).join(),
    /parent outside tree/,
  );
});
test("confirmation requires evidence", () => {
  assert.equal(validateResult({ status: "confirmed" }), false);
  assert.equal(
    validateResult({ status: "confirmed", evidence: "open state changed" }),
    true,
  );
  assert.equal(validateResult({ status: "executed" }), true);
  assert.equal(validateResult({ status: "success" }), false);
});
test("selection survives replaced DOM elements and insertion before selected row", () => {
  const nav = new Navigation();
  nav.update(snapshot([item("a"), item("b")]));
  nav.select("b");
  const replacement = item("b");
  nav.update(snapshot([item("new"), item("a"), replacement]));
  assert.equal(nav.item(), replacement);
});
test("deleted selection chooses next row, then previous at the end", () => {
  const nav = new Navigation();
  nav.update(snapshot([item("a"), item("b"), item("c")]));
  nav.select("b");
  nav.update(snapshot([item("a"), item("c")]));
  assert.equal(nav.itemId, "c");
  nav.update(snapshot([item("a")]));
  assert.equal(nav.itemId, "a");
});
test("collapsed descendant selects surviving ancestor", () => {
  const nav = new Navigation();
  nav.update(
    snapshot(
      [item("p"), item("c", { parentId: "p" }), item("g", { parentId: "c" })],
      "tree",
    ),
  );
  nav.select("g");
  nav.update(snapshot([item("p")], "tree"));
  assert.equal(nav.itemId, "p");
});
test("back restores selected identity even if data arrives after route", () => {
  const nav = new Navigation();
  nav.update(snapshot([item("a"), item("b")]));
  nav.select("b");
  nav.update(snapshot([item("detail")], "list", "detail"));
  nav.select("detail");
  nav.update(snapshot([]));
  assert.equal(nav.itemId, "b");
  assert.equal(nav.item(), undefined);
  nav.update(snapshot([item("a"), item("b")]));
  assert.equal(nav.itemId, "b");
});
test("grid preserves desired column across separate keypresses", () => {
  const nav = new Navigation();
  nav.update(
    snapshot(
      [
        item("a", { rect: box(200, 0) }),
        item("b", { rect: box(100, 100) }),
        item("c", { rect: box(100, 200) }),
        item("d", { rect: box(200, 200) }),
      ],
      "grid",
    ),
  );
  nav.select("a");
  nav.move("down");
  assert.equal(nav.itemId, "b");
  nav.move("down");
  assert.equal(nav.itemId, "d");
});
test("tree child, sibling and parent movements use relationships", () => {
  const nav = new Navigation();
  nav.update(
    snapshot(
      [
        item("p"),
        item("a", { parentId: "p" }),
        item("g", { parentId: "a" }),
        item("b", { parentId: "p" }),
      ],
      "tree",
    ),
  );
  nav.select("p");
  nav.move("child");
  assert.equal(nav.itemId, "a");
  nav.move("siblingNext");
  assert.equal(nav.itemId, "b");
  nav.move("parent");
  assert.equal(nav.itemId, "p");
});
test("regions keep movement bounded and counts clamp at ends", () => {
  const nav = new Navigation(),
    s = snapshot([item("a"), item("b")]);
  s.regions.push({ id: "side", kind: "list", items: [item("c")] });
  nav.update(s);
  nav.select("a");
  nav.move("down", 999);
  assert.equal(nav.itemId, "b");
  nav.switchRegion(1);
  assert.equal(nav.itemId, "c");
  nav.move("up", 5);
  assert.equal(nav.itemId, "c");
});

test("route restoration waits through repeated empty snapshots and missing regions", () => {
  const nav = new Navigation();
  nav.update(snapshot([item("a")]));
  nav.select("a");
  nav.update(snapshot([], "list", "detail"));
  nav.update({ version: 1, pageKey: "feed", regions: [] });
  nav.update({ version: 1, pageKey: "feed", regions: [] });
  nav.update(snapshot([item("a")]));
  assert.equal(nav.itemId, "a");
  assert.equal(nav.regionId, "main");
});

import { keyboardPolicy } from "../src/site-policies.js";
test("native keyboard policy applies only to DuckDuckGo and its subdomains", () => {
  for (const host of ["duckduckgo.com", "www.duckduckgo.com", "html.duckduckgo.com"])
    assert.equal(keyboardPolicy("https://" + host + "/?q=test").defaultMode, "native");
  for (const host of ["example.com", "notduckduckgo.com", "duckduckgo.com.example.com"])
    assert.equal(keyboardPolicy("https://" + host).defaultMode, "normal");
});
