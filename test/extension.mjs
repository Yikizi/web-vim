// Opt-in integration test against a disposable browser with dist/extension loaded.
// Never point this at a personal profile: it moves/closes tabs and creates a bookmark.
import puppeteer from "puppeteer-core";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
if (!process.env.CDP_EXTENSION_URL)
  throw new Error("Set CDP_EXTENSION_URL to a disposable extension-test browser");
const browser = await puppeteer.connect({ browserURL: process.env.CDP_EXTENSION_URL });
const control = await browser.target().createCDPSession();
const extensionPath = fileURLToPath(new URL("../dist/extension", import.meta.url));
const { id: extensionId } = await control.send("Extensions.loadUnpacked", {
  path: extensionPath,
});
await control.send("Extensions.uninstall", { id: extensionId });
await control.send("Extensions.loadUnpacked", { path: extensionPath });
const page = await browser.newPage();
const created = new Set([page]);
browser.on("targetcreated", async (target) => {
  const p = await target.page();
  if (p) created.add(p);
});
await page.setRequestInterception(true);
page.on("request", (r) =>
  r.respond({
    status: 200,
    contentType: "text/html",
    body: "<title>Web Vim browser action test</title><main><p>Empty page, no selection required.</p></main>",
  }),
);
const workerTarget = await browser.waitForTarget(
  (t) => t.type() === "service_worker" && t.url().endsWith("/background.js"),
);
const worker = await workerTarget.worker();
const url = "https://web-vim-extension-test.invalid/";
let bookmarkId;
async function choose(query) {
  await page.keyboard.press(":");
  await page.waitForFunction(() =>
    document.querySelector("[data-keybinds-ui]")?.shadowRoot.querySelector("input"),
  );
  await page.keyboard.type(query);
  await page.keyboard.press("Enter");
}
// tabs permission is intentionally absent, so identify the tab using a content-script
// message sender captured in the extension worker (read-only test observation).
await worker.evaluate(() => {
  globalThis.testSender = null;
  chrome.runtime.onMessage.addListener((_message, sender) => {
    globalThis.testSender = sender.tab?.id;
  });
});
async function observedTab() {
  return worker.evaluate(async () => chrome.tabs.get(globalThis.testSender));
}
async function until(fn) {
  for (let i = 0; i < 60; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Browser outcome not observed");
}
try {
  await page.goto(url);
  await page.waitForFunction(() => Boolean(document.querySelector("main")));
  await new Promise((r) => setTimeout(r, 300));
  await page.keyboard.press(":");
  await page.keyboard.type("detach");
  await page.evaluate(() =>
    document
      .querySelector("[data-keybinds-ui]")
      .shadowRoot.querySelector("input")
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
  assert.equal(await worker.evaluate(() => globalThis.testSender), null);
  console.log("✓ synthetic page input cannot invoke privileged browser commands");
  await choose("pin / unpin");
  await until(async () => (await observedTab()).pinned);
  const before = await observedTab();
  await page.evaluate(() => {
    window.testState = "preserved";
    history.pushState({}, "", "#state");
  });
  await choose("detach");
  await until(async () => (await observedTab()).windowId !== before.windowId);
  assert.equal(await page.evaluate(() => window.testState), "preserved");
  console.log("✓ palette detaches the same tab and preserves page state");
  await choose("mute / unmute");
  await until(async () => (await observedTab()).mutedInfo.muted);
  console.log("✓ palette pins and mutes the originating tab");
  await choose("bookmark this page");
  await until(async () => {
    const rows = await worker.evaluate(
      (url) => chrome.bookmarks.search({ url }),
      url + "#state",
    );
    bookmarkId = rows[0]?.id;
    return Boolean(bookmarkId);
  });
  await choose("bookmark this page");
  assert.equal(
    (await worker.evaluate((url) => chrome.bookmarks.search({ url }), url + "#state"))
      .length,
    1,
  );
  console.log("✓ bookmark command saves once");
  await choose("zoom in");
  await until(
    async () =>
      (await worker.evaluate(() => chrome.tabs.getZoom(globalThis.testSender))) > 1,
  );
  await choose("reset zoom");
  await until(
    async () =>
      (await worker.evaluate(() => chrome.tabs.getZoom(globalThis.testSender))) === 1,
  );
  console.log("✓ zoom actions reach the browser");
  const pagesBeforeDuplicate = new Set(await browser.pages());
  const tabsBeforeDuplicate = pagesBeforeDuplicate.size;
  await choose("duplicate tab");
  await until(async () => (await browser.pages()).length === tabsBeforeDuplicate + 1);
  const duplicate = (await browser.pages()).find((p) => !pagesBeforeDuplicate.has(p));
  assert.ok(duplicate);
  await duplicate.close();
  await page.bringToFront();
  await choose("reopen last closed");
  await until(async () => (await browser.pages()).length === tabsBeforeDuplicate + 1);
  await page.bringToFront();
  console.log("✓ duplicate and restore commands create and restore a real tab");
  await page.keyboard.press(":");
  await page.keyboard.type("downloads");
  await page.screenshot({ path: "/tmp/web-vim-profile/palette.png" });
  await page.keyboard.press("Enter");
  await until(async () =>
    (await browser.pages()).some((p) => p.url() === "chrome://downloads/"),
  );
  console.log("✓ palette opens the native downloads page");
} finally {
  if (bookmarkId) await worker.evaluate((id) => chrome.bookmarks.remove(id), bookmarkId);
  for (const p of created) if (!p.isClosed()) await p.close();
  await browser.disconnect();
}
