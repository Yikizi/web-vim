import { Navigation } from "./navigation.js";
import { validateSnapshot, validateResult, unavailable } from "./contract.js";
import {
  loadKeybinds,
  showToast,
  setCursor,
  clearCursor,
  refreshCursor,
  openPicker,
  showHelp,
  fuzzyMatch,
  copyText,
  resetPending,
} from "./keyboard-ui.js";
import { visible, rect, deepAll, label } from "./dom.js";

export function start(adapters, { fallback, readDialog, policy = {} }) {
  let adapter = adapters.find((a) => a.matches()) || fallback;
  const nav = new Navigation();
  let dirty = true,
    mode = policy.defaultMode ?? "normal",
    busy = false,
    errors = [],
    lastResult = null,
    revision = 0;
  let dialog = null,
    basePage = null,
    timer = null;
  const storageKey = "web-vim:selection:v1";
  try {
    nav.memory = new Map(JSON.parse(sessionStorage.getItem(storageKey) || "[]"));
  } catch {}
  function persist() {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify([...nav.memory]));
    } catch {}
  }
  function invalidate() {
    dirty = true;
    clearTimeout(timer);
    timer = setTimeout(() => {
      read();
      draw();
    }, 80);
  }
  function read() {
    if (!dirty) return errors.length ? null : nav.snapshot;
    dirty = false;
    try {
      adapter = adapters.find((a) => a.matches()) || fallback;
      const redirect = adapter.redirect?.();
      if (redirect && new URL(redirect, location.href).href !== location.href) {
        location.replace(redirect);
        return null;
      }
      let snapshot = adapter.read();
      dialog =
        [...document.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"]')]
          .filter(visible)
          .at(-1) || null;
      // Treat dialogs as their own temporary page, so the previous selection is restored.
      basePage = snapshot.pageKey;
      if (dialog)
        snapshot = {
          ...snapshot,
          pageKey: snapshot.pageKey + "::dialog",
          regions: readDialog(dialog),
        };
      errors = validateSnapshot(snapshot);
      if (errors.length) {
        clearCursor();
        return null;
      }
      nav.update(snapshot);
      revision++;
      persist();
      return snapshot;
    } catch (e) {
      errors = [String(e)];
      clearCursor();
      return null;
    }
  }
  function cursorRect() {
    const item = nav.item();
    if (!item) return [];
    let r = rect(item.element);
    // Adapters may supply a smaller own-content rect for tree nodes.
    if (item.rect && nav.region()?.kind === "tree")
      r = { ...r, height: item.rect.height, bottom: r.top + item.rect.height };
    for (let el = item.element.parentElement; el; el = el.parentElement) {
      // Root overflow is propagated to the viewport. The body can legitimately
      // have a zero-height box (YouTube), which is not a zero-height clip area.
      if (el === document.body || el === document.documentElement) continue;
      const s = getComputedStyle(el);
      if (s.display === "contents") continue;
      if (/(auto|scroll|hidden|clip)/.test(s.overflowY + s.overflowX)) {
        const box = el.getBoundingClientRect();
        r = {
          ...r,
          top: Math.max(r.top, box.top),
          bottom: Math.min(r.bottom, box.bottom),
          left: Math.max(r.left, box.left),
          right: Math.min(r.right, box.right),
        };
      }
    }
    r = { ...r, width: r.right - r.left, height: r.bottom - r.top };
    return [r];
  }
  function draw() {
    if (mode !== "normal" || errors.length || !nav.item()) {
      clearCursor();
      return;
    }
    setCursor(nav.item().element, cursorRect);
  }
  function reveal() {
    const item = nav.item();
    if (!item) return;
    // Nearest ancestor scrolling supports independently scrolling panes.
    const r = item.element.getBoundingClientRect();
    if (r.top < 72 || r.bottom > innerHeight - 30 || r.left < 0 || r.right > innerWidth)
      item.element.scrollIntoView({
        block: "nearest",
        inline: "nearest",
        behavior: "instant",
      });
    else {
      for (let p = item.element.parentElement; p; p = p.parentElement) {
        const s = getComputedStyle(p),
          pr = p.getBoundingClientRect();
        if (
          /(auto|scroll)/.test(s.overflowY) &&
          (r.top < pr.top || r.bottom > pr.bottom)
        ) {
          item.element.scrollIntoView({
            block: "nearest",
            inline: "nearest",
            behavior: "instant",
          });
          break;
        }
      }
    }
    draw();
    persist();
  }
  function move(direction, count) {
    if (!read()) return;
    if (nav.region()?.kind === "article") {
      window.scrollBy({
        top: (direction === "up" ? -1 : 1) * 80 * count,
        behavior: "instant",
      });
      return;
    }
    nav.move(direction, count);
    reveal();
  }
  function halfPage(direction, count) {
    if (!read()) return;
    const before = nav.item()?.element.getBoundingClientRect();
    const x = before ? (before.left + before.right) / 2 : innerWidth / 2;
    const y =
      before && before.top >= 0 && before.bottom <= innerHeight
        ? (before.top + before.bottom) / 2
        : innerHeight / 2;
    window.scrollBy({ top: direction * innerHeight * 0.5 * count, behavior: "instant" });
    dirty = true;
    if (!read()) return;
    const candidates = (nav.region()?.items || [])
      .map((item) => ({ item, r: rect(item.element) }))
      .filter(({ r }) => r.bottom > 72 && r.top < innerHeight);
    const score = ({ r }) =>
      Math.abs((r.top + r.bottom) / 2 - y) + Math.abs((r.left + r.right) / 2 - x);
    candidates.sort((a, b) => score(a) - score(b));
    if (candidates[0]) nav.select(candidates[0].item.id);
    draw();
    persist();
  }
  async function act(action, expected, pageAction = false) {
    if (busy) return unavailable("Another action is running");
    if (!read()) return unavailable("Adapter contract failed");
    const item = nav.item() || null;
    if (
      (!item && !pageAction) ||
      (expected &&
        (expected.page !== nav.snapshot.pageKey ||
          expected.id !== item.id ||
          expected.region !== nav.regionId))
    )
      return unavailable("Selection changed");
    action = action === "primary" ? item?.primaryAction : action;
    if (
      !(pageAction
        ? adapter.pageActions?.includes(action)
        : item.actions.includes(action))
    )
      return unavailable("Action unavailable");
    const page = nav.snapshot.pageKey,
      region = nav.regionId,
      id = item?.id,
      node = item?.element,
      href = item?.href;
    const actingAdapter = dialog ? fallback : adapter;
    const guard = () => {
      if (pageAction) {
        return (
          location.href === page &&
          adapter === actingAdapter &&
          !dialog &&
          (!item || (node.isConnected && nav.itemId === id && nav.regionId === region))
        );
      }
      if (
        location.href !== basePage ||
        !node.isConnected ||
        nav.itemId !== id ||
        nav.regionId !== region
      )
        return false;
      if (item.link && item.link.href !== href) return false;
      const current = actingAdapter.read();
      const fresh = current.regions
        .find((r) => r.id === region)
        ?.items.find((i) => i.id === id);
      return (
        nav.snapshot.pageKey === page &&
        Boolean(dialog || (fresh?.element === node && fresh?.href === href))
      );
    };
    if (!guard() || (!pageAction && !visible(node)))
      return unavailable("Stale or hidden target");
    busy = true;
    try {
      const result =
        action === "copy"
          ? (await copyText(item.href), { status: "confirmed", evidence: "URL copied" })
          : await actingAdapter.execute(action, item, { guard });
      lastResult = validateResult(result)
        ? result
        : { status: "failed", reason: "Adapter returned an invalid result" };
    } catch (e) {
      lastResult = { status: "failed", reason: String(e) };
    } finally {
      busy = false;
      invalidate();
    }
    if (lastResult.status === "confirmed") showToast(lastResult.evidence);
    else if (lastResult.status !== "executed")
      showToast(lastResult.reason || lastResult.status, "error");
    return lastResult;
  }
  async function pick(kind) {
    if (!read()) return;
    const page = nav.snapshot.pageKey,
      selected = nav.item();
    let options;
    if (kind === "actions") {
      options = (selected?.actions || []).map((action) => ({
        label: action,
        value: { action, id: selected.id, region: nav.regionId, page },
      }));
    } else
      options = nav.snapshot.regions.flatMap((r) =>
        r.items.map((i) => ({
          label: i.label,
          detail: r.label,
          value: { id: i.id, region: r.id, page },
        })),
      );
    const result = await openPicker({
      label: kind === "actions" ? ":" : "Objects",
      placeholder: kind === "actions" ? "Find an action" : "Find an item by its text",
      source: (q) =>
        options
          .map((o) => ({ ...o, score: fuzzyMatch(o.label, q)?.score }))
          .filter((o) => o.score !== undefined)
          .sort((a, b) => b.score - a.score),
    });
    if (!result || !read() || nav.snapshot.pageKey !== page) return;
    if (kind === "actions") await act(result.value.action, result.value);
    else {
      nav.select(result.value.id, result.value.region);
      reveal();
    }
  }
  async function search() {
    const fields = deepAll(
      dialog || document,
      'input[type="search"], input[name="search_query"], input[name="q"], [role="searchbox"], [role="search"] input',
    ).filter(visible);
    if (fields.length === 1) {
      fields[0].focus();
      return;
    }
    if (!fields.length) {
      showToast("No search field found", "error");
      return;
    }
    const result = await openPicker({
      label: "Search",
      source: (q) =>
        fields
          .map((el) => ({
            label: label(el) || el.placeholder || "Search",
            value: el,
          }))
          .filter((i) => fuzzyMatch(i.label, q)),
    });
    if (result && visible(result.value)) result.value.focus();
  }
  async function inspect() {
    read();
    const rows = errors.length
      ? errors.map((label) => ({ label, detail: "invalid" }))
      : nav.snapshot.regions.map((r) => ({
          label: `${r.id} · ${r.kind} · ${r.items.length} items`,
          detail: r.id === nav.regionId ? "active" : "valid",
        }));
    await openPicker({
      label: `Contract v1 · ${adapter.id}`,
      footer: "Read-only diagnostics. Esc closes.",
      source: (q) => rows.filter((r) => fuzzyMatch(r.label, q)),
    });
  }
  const binds = [];
  const bind = (keys, desc, action, when) =>
    binds.push({
      keys,
      desc,
      group: "Web Vim",
      action,
      when: () =>
        (mode === "normal" ||
          (mode === "native" && policy.supplementalKeys?.includes(keys))) &&
        (keys === "g?" || keys === "?" || !errors.length) &&
        (!when || when()),
    });
  bind("j", "Down", (c) => move("down", c.count));
  bind("k", "Up", (c) => move("up", c.count));
  bind("h", "Left / parent", (c) => {
    read();
    const kind = nav.region()?.kind;
    if (kind === "grid") move("left", c.count);
    else if (kind === "tree" && nav.item()?.parentId) move("parent", c.count);
    else if (kind === "tree" && nav.item()?.actions.includes("collapse"))
      void act("collapse");
    else history.back();
  });
  bind("l", "Right / child", async (c) => {
    read();
    if (nav.region()?.kind === "tree") {
      if (nav.item()?.collapsed) {
        const id = nav.itemId;
        const result = await act("expand");
        if (["confirmed", "executed"].includes(result?.status) && nav.itemId === id) {
          dirty = true;
          move("child", c.count);
        }
      } else move("child", c.count);
    } else if (nav.region()?.kind === "grid") move("right", c.count);
    else await act("primary");
  });
  bind(
    "]j",
    "Next sibling",
    (c) => move("siblingNext", c.count),
    () => nav.region()?.kind === "tree",
  );
  bind(
    "[j",
    "Previous sibling",
    (c) => move("siblingPrev", c.count),
    () => nav.region()?.kind === "tree",
  );
  bind("gg", "First item / count", (c) => {
    read();
    const i = nav.region()?.items[c.hasCount ? c.count - 1 : 0];
    if (i) nav.select(i.id);
    reveal();
  });
  bind("G", "Last item / count", (c) => {
    read();
    const items = nav.region()?.items || [];
    const i = items[c.hasCount ? c.count - 1 : items.length - 1];
    if (i) nav.select(i.id);
    reveal();
  });
  for (const [keys, action] of [
    ["o", "primary"],
    ["<CR>", "primary"],
    ["O", "openNew"],
    ["y", "copy"],
  ])
    bind(keys, action, () => act(action));
  bind("J", "Next region", () => {
    read();
    nav.switchRegion(1);
    reveal();
  });
  bind("K", "Previous region", () => {
    read();
    nav.switchRegion(-1);
    reveal();
  });
  bind(
    "gs",
    "Focus search",
    search,
    () => !adapter.shortcuts?.some((s) => s.keys === "gs"),
  );
  bind(":", "Find action", () => pick("actions"));
  bind("f", "Find object by text", () => pick("objects"));
  bind("?", "Available keys", () => showHelp("Web Vim"));
  bind("g?", "Inspect adapter contract", inspect);
  bind("H", "Back", () => history.back());
  bind("L", "Forward", () => history.forward());
  bind("D", "Half page down", (c) => halfPage(1, c.count));
  bind("U", "Half page up", (c) => halfPage(-1, c.count));
  for (const [keys, block] of [
    ["zz", "center"],
    ["zt", "start"],
    ["zb", "end"],
  ])
    bind(keys, "Align selection: " + block, () => {
      read();
      nav.item()?.element.scrollIntoView({ block, behavior: "instant" });
      draw();
    });
  bind(
    "<Esc>",
    "Clear selection",
    () => {
      nav.clear();
      clearCursor();
      persist();
    },
    () => !dialog,
  );
  for (const a of adapters)
    for (const shortcut of a.shortcuts || [])
      bind(
        shortcut.keys,
        shortcut.label,
        (ctx) => {
          if (ctx.repeat) return;
          if (shortcut.region) {
            if (!read()) return;
            const region = nav.snapshot.regions.find((r) => r.id === shortcut.region);
            if (!region?.items.length)
              return showToast("This section is not available", "error");
            nav.select(region.items[0].id, region.id);
            reveal();
          } else return act(shortcut.action, undefined, shortcut.scope === "page");
        },
        () =>
          adapter === a &&
          !dialog &&
          Boolean(
            shortcut.region ||
            (shortcut.scope === "page"
              ? a.pageActions?.includes(shortcut.action)
              : nav.item()?.actions.includes(shortcut.action)),
          ),
      );
  loadKeybinds(binds, {
    context: () => ({
      native: mode === "native",
      counts: mode === "normal" && !errors.length && Boolean(nav.region()?.items.length),
    }),
    gate: (e) => {
      if (e.ctrlKey && e.key === "Escape") {
        mode = mode === "passthrough" ? (policy.defaultMode ?? "normal") : "passthrough";
        resetPending();
        draw();
        showToast(mode);
        e.preventDefault();
        e.stopImmediatePropagation();
        return false;
      }
      if (mode === "passthrough") return false;
      read();
      return true;
    },
  });
  const observer = new MutationObserver((records) => {
    if (
      records.some(
        (r) =>
          !r.target.closest?.("[data-keybinds-ui]") &&
          !(
            [...r.addedNodes, ...r.removedNodes].length &&
            [...r.addedNodes, ...r.removedNodes].every(
              (n) => n.nodeType === 1 && n.matches?.("[data-keybinds-ui]"),
            )
          ),
      )
    )
      invalidate();
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
    attributeFilter: [
      "href",
      "hidden",
      "aria-hidden",
      "open",
      "collapsed",
      "aria-expanded",
      "aria-modal",
      "role",
      "style",
      "class",
    ],
  });
  window.addEventListener("resize", invalidate, { passive: true });
  document.addEventListener(
    "scroll",
    () => {
      dirty = true;
      refreshCursor();
    },
    { capture: true, passive: true },
  );
  window.addEventListener("popstate", invalidate);
  window.navigation?.addEventListener("navigatesuccess", invalidate);
  setInterval(() => {
    if (basePage !== location.href) invalidate();
  }, 400);
  read();
  draw();
  // Introspection only; no remote execution bridge or page-driven command messages.
  return {
    inspect: () => ({
      adapter: adapter.id,
      policy,
      mode,
      errors,
      revision,
      selection: { region: nav.regionId, item: nav.itemId },
      regions: nav.snapshot?.regions.map((r) => ({
        id: r.id,
        kind: r.kind,
        items: r.items.map((i) => ({
          id: i.id,
          label: i.label,
          parentId: i.parentId,
          actions: i.actions,
        })),
      })),
      lastResult,
    }),
    refresh: invalidate,
  };
}
