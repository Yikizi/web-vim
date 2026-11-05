// Shared, declarative catalog. Content scripts cannot supply URLs or target tab IDs.
export const browserActions = [
  {
    id: "detach",
    label: "Move tab to new window",
    keywords: "detach popout pop out aken eraldi",
  },
  { id: "duplicate", label: "Duplicate tab", keywords: "clone copy tab" },
  { id: "pin", label: "Pin / unpin tab", keywords: "keep pinned" },
  { id: "mute", label: "Mute / unmute tab", keywords: "sound audio silence" },
  {
    id: "reopen",
    label: "Reopen last closed tab or window",
    keys: "Ctrl+Shift+T",
    keywords: "restore undo closed",
  },
  { id: "newTab", label: "New tab", keys: "Ctrl+T" },
  { id: "newWindow", label: "New window", keys: "Ctrl+N" },
  { id: "close", label: "Close tab", keys: "Ctrl+W" },
  { id: "reload", label: "Reload page", keys: "Ctrl+R", keywords: "refresh" },
  {
    id: "hardReload",
    label: "Reload page bypassing cache",
    keys: "Ctrl+Shift+R",
    keywords: "hard refresh",
  },
  {
    id: "bookmark",
    label: "Bookmark this page",
    keys: "Ctrl+D",
    keywords: "save favourite favorite järjehoidja",
  },
  { id: "zoomIn", label: "Zoom in", keys: "Ctrl++", keywords: "enlarge bigger" },
  { id: "zoomOut", label: "Zoom out", keys: "Ctrl+-", keywords: "smaller" },
  { id: "zoomReset", label: "Reset zoom", keys: "Ctrl+0", keywords: "actual size" },
  { id: "downloads", label: "Open downloads", keys: "Ctrl+J" },
  { id: "history", label: "Open browsing history", keys: "Ctrl+H" },
  {
    id: "bookmarks",
    label: "Open bookmark manager",
    keys: "Ctrl+Shift+O",
    keywords: "saved favourites favorites",
  },
  { id: "settings", label: "Open browser settings", keywords: "preferences" },
  { id: "extensions", label: "Manage extensions", keywords: "addons plugins" },
  {
    id: "shortcuts",
    label: "Configure extension shortcuts",
    keywords: "keybinds keyboard bindings",
  },
];

export function hasBrowserActions() {
  return Boolean(globalThis.chrome?.runtime?.id && chrome.runtime.sendMessage);
}

export async function runBrowserAction(id, trusted) {
  if (!trusted)
    return {
      status: "unavailable",
      reason: "Browser actions require keyboard or pointer input",
    };
  if (!hasBrowserActions())
    return {
      status: "unavailable",
      reason: "Install the extension to use browser actions",
    };
  try {
    return await chrome.runtime.sendMessage({
      type: "web-vim:browser-action",
      action: id,
      title: document.title,
    });
  } catch (error) {
    return { status: "failed", reason: error.message };
  }
}
