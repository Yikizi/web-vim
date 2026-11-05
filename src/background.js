import { browserActions } from "./browser-actions.js";
const ids = new Set(browserActions.map((a) => a.id));
const pages = {
  downloads: "chrome://downloads/",
  history: "chrome://history/",
  bookmarks: "chrome://bookmarks/",
  settings: "chrome://settings/",
  extensions: "chrome://extensions/",
  shortcuts: "chrome://extensions/shortcuts",
};

export async function handleBrowserAction(message, sender, api = chrome) {
  if (
    sender.id !== api.runtime.id ||
    sender.frameId !== 0 ||
    !Number.isInteger(sender.tab?.id) ||
    !/^https?:\/\//.test(sender.url || "") ||
    !ids.has(message.action)
  )
    return { status: "unavailable", reason: "Unknown action or invalid sender" };
  const tab = await api.tabs.get(sender.tab.id);
  if (!tab.active)
    return { status: "unavailable", reason: "The originating tab is no longer active" };
  const id = tab.id;
  const action = message.action;
  if (pages[action])
    await api.tabs.create({ url: pages[action], windowId: tab.windowId });
  else
    switch (action) {
      case "detach": {
        const window = await api.windows.create({ tabId: id, focused: true });
        const moved = await api.tabs.get(id);
        return moved.windowId === window.id && moved.windowId !== tab.windowId
          ? { status: "confirmed", evidence: "Tab moved to a new window" }
          : { status: "executed" };
      }
      case "duplicate":
        await api.tabs.duplicate(id);
        break;
      case "pin":
        await api.tabs.update(id, { pinned: !tab.pinned });
        break;
      case "mute":
        await api.tabs.update(id, { muted: !tab.mutedInfo?.muted });
        break;
      case "newTab":
        await api.tabs.create({ windowId: tab.windowId });
        break;
      case "newWindow":
        await api.windows.create({ focused: true });
        break;
      case "close":
        await api.tabs.remove(id);
        break;
      case "reopen": {
        const recent = await api.sessions.getRecentlyClosed({ maxResults: 1 });
        const sessionId = recent[0]?.tab?.sessionId || recent[0]?.window?.sessionId;
        if (!sessionId)
          return { status: "unavailable", reason: "No recently closed tab or window" };
        await api.sessions.restore(sessionId);
        break;
      }
      case "reload":
      case "hardReload":
        await api.tabs.reload(id, { bypassCache: action === "hardReload" });
        break;
      case "bookmark": {
        // sender.url is the document's original URL; sender.tab.url follows SPA
        // pushState/fragment navigation and is provided for our own message sender.
        const url = sender.tab.url || sender.url;
        if (!/^https?:\/\//.test(url))
          return { status: "unavailable", reason: "This page cannot be bookmarked" };
        const existing = await api.bookmarks.search({ url });
        if (existing.length)
          return { status: "confirmed", evidence: "This page is already bookmarked" };
        const saved = await api.bookmarks.create({
          url,
          title: typeof message.title === "string" ? message.title.slice(0, 500) : url,
        });
        return saved.url === url
          ? { status: "confirmed", evidence: "Page bookmarked" }
          : { status: "executed" };
      }
      case "zoomIn":
      case "zoomOut":
      case "zoomReset": {
        const zoom = await api.tabs.getZoom(id);
        const levels = [
          0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5,
        ];
        const next =
          action === "zoomReset"
            ? 0
            : action === "zoomIn"
              ? (levels.find((v) => v > zoom + 0.01) ?? 5)
              : (levels.findLast((v) => v < zoom - 0.01) ?? 0.25);
        await api.tabs.setZoom(id, next);
        break;
      }
    }
  return { status: "executed" };
}

// No external/page message bridge. The worker wakes only for an explicit command.
globalThis.chrome?.runtime?.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== "web-vim:browser-action") return;
  handleBrowserAction(message, sender).then(respond, (error) =>
    respond({ status: "failed", reason: error.message }),
  );
  return true;
});
