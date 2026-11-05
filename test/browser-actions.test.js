import { test } from "node:test";
import assert from "node:assert/strict";
import { handleBrowserAction } from "../src/background.js";
import { browserActions, runBrowserAction } from "../src/browser-actions.js";

const sender = {
  id: "web-vim",
  frameId: 0,
  url: "https://example.com/page",
  tab: { id: 7 },
};
function setup() {
  const calls = [];
  let tab = {
    id: 7,
    active: true,
    windowId: 4,
    pinned: false,
    mutedInfo: { muted: false },
  };
  const api = {
    runtime: { id: "web-vim" },
    tabs: {
      get: async (id) => {
        assert.equal(id, 7);
        return { ...tab };
      },
      update: async (...args) => calls.push(["update", ...args]),
      create: async (...args) => calls.push(["create", ...args]),
      reload: async (...args) => calls.push(["reload", ...args]),
      getZoom: async () => 1,
      setZoom: async (...args) => calls.push(["zoom", ...args]),
    },
    windows: {
      create: async (options) => {
        calls.push(["window", options]);
        tab.windowId = 8;
        return { id: 8 };
      },
    },
    bookmarks: {
      search: async () => [],
      create: async (options) => {
        calls.push(["bookmark", options]);
        return { id: "b1", ...options };
      },
    },
    sessions: {
      getRecentlyClosed: async () => [],
      restore: async (id) => calls.push(["restore", id]),
    },
  };
  return { api, calls, tab };
}
test("browser catalog has unique IDs and untrusted input cannot message the worker", async () => {
  assert.equal(new Set(browserActions.map((a) => a.id)).size, browserActions.length);
  assert.equal((await runBrowserAction("detach", false)).status, "unavailable");
});
test("detach moves the originating tab and confirms its new window", async () => {
  const { api, calls } = setup();
  const result = await handleBrowserAction({ action: "detach", tabId: 999 }, sender, api);
  assert.equal(result.status, "confirmed");
  assert.deepEqual(calls, [["window", { tabId: 7, focused: true }]]);
});
test("unknown actions, subframes, external senders and inactive tabs do nothing", async () => {
  for (const bad of [
    { ...sender, frameId: 2 },
    { ...sender, id: "other" },
    { ...sender, url: "chrome://settings" },
    { ...sender, tab: undefined },
  ]) {
    const { api, calls } = setup();
    assert.equal(
      (await handleBrowserAction({ action: "detach" }, bad, api)).status,
      "unavailable",
    );
    assert.deepEqual(calls, []);
  }
  const { api, calls, tab } = setup();
  assert.equal(
    (await handleBrowserAction({ action: "arbitrary" }, sender, api)).status,
    "unavailable",
  );
  tab.active = false;
  assert.equal(
    (await handleBrowserAction({ action: "detach" }, sender, api)).status,
    "unavailable",
  );
  assert.deepEqual(calls, []);
});
test("bookmark uses sender URL, avoids duplicates, and restore handles an empty session", async () => {
  const { api, calls } = setup();
  assert.equal(
    (
      await handleBrowserAction(
        { action: "bookmark", url: "https://wrong.test", title: "A page" },
        sender,
        api,
      )
    ).status,
    "confirmed",
  );
  assert.deepEqual(calls, [["bookmark", { url: sender.url, title: "A page" }]]);
  api.bookmarks.search = async () => [{ id: "existing" }];
  await handleBrowserAction({ action: "bookmark" }, sender, api);
  assert.equal(calls.length, 1);
  assert.equal(
    (await handleBrowserAction({ action: "reopen" }, sender, api)).status,
    "unavailable",
  );
  api.sessions.getRecentlyClosed = async () => [
    { window: { sessionId: "closed-window" } },
  ];
  await handleBrowserAction({ action: "reopen" }, sender, api);
  assert.deepEqual(calls.at(-1), ["restore", "closed-window"]);
});
test("bookmark preserves the current SPA route instead of the initial document URL", async () => {
  const { api, calls } = setup();
  await handleBrowserAction(
    { action: "bookmark", title: "Updated route" },
    { ...sender, tab: { id: 7, url: "https://example.com/next#section" } },
    api,
  );
  assert.equal(calls[0][1].url, "https://example.com/next#section");
});
test("tab toggles and fixed browser destinations use only the originating window", async () => {
  const { api, calls } = setup();
  for (const action of ["pin", "mute", "hardReload", "zoomIn", "zoomReset", "downloads"])
    await handleBrowserAction({ action, url: "https://wrong.test" }, sender, api);
  assert.deepEqual(calls, [
    ["update", 7, { pinned: true }],
    ["update", 7, { muted: true }],
    ["reload", 7, { bypassCache: true }],
    ["zoom", 7, 1.1],
    ["zoom", 7, 0],
    ["create", { url: "chrome://downloads/", windowId: 4 }],
  ]);
});
