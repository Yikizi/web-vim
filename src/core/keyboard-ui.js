/**
 * Keybinds Engine — vim-style key sequences for userscripts.
 *
 * Usage: loadKeybinds(bindings) where bindings is an array of binding objects.
 *
 * Binding shape:
 *   { keys: "gg", group: "Move", desc: "First item", when: (ctx) => bool, action: (ctx) => { ... } }
 *
 * Key notation follows vim:
 *   "j", "G", "gg", "za", "?", "/"        printable keys, case-sensitive
 *   "<CR>", "<Esc>", "<Space>", "<Tab>"   named keys
 *   "<C-d>", "<S-Tab>"                    modifiers (C = ctrl, S = shift on named keys)
 *
 * Numeric prefixes are supported (10j, 3K, ...) and passed as ctx.count.
 * ctx.repeat is true while a key is held down (use it to skip smooth scrolling).
 * When one binding is a prefix of another ("g" vs "gg"), the engine waits
 * SEQUENCE_TIMEOUT_MS for the next key, like vim's timeoutlen.
 *
 * The engine also owns a small UI layer rendered inside a closed-off shadow root
 * so the host page's CSS can't touch it: a selection cursor, toasts, a showcmd
 * indicator, a fuzzy picker and a help overlay.
 */

const SEQUENCE_TIMEOUT_MS = 1000;
const COUNT_TIMEOUT_MS = 2000;
const MAX_COUNT = 999;

const NAMED_KEYS = {
  Enter: "CR",
  Escape: "Esc",
  " ": "Space",
  Tab: "Tab",
  Backspace: "BS",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  PageUp: "PageUp",
  PageDown: "PageDown",
  Home: "Home",
  End: "End",
};

const MODIFIER_KEYS = new Set([
  "Shift",
  "Control",
  "Alt",
  "Meta",
  "CapsLock",
  "AltGraph",
  "Dead",
]);

const keyState = {
  bindings: [],
  pending: [],
  count: "",
  timer: null,
  modal: null,
  repeat: false,
};

let eventGate = () => true;
let contextProvider = () => ({});
let prepareInput = () => {};

function loadKeybinds(
  bindings,
  { gate = () => true, context = () => ({}), prepare = () => {} } = {},
) {
  eventGate = gate;
  contextProvider = context;
  prepareInput = prepare;
  keyState.bindings = bindings.map((binding) => ({
    ...binding,
    tokens: parseKeys(binding.keys),
  }));

  // Window + capture phase so we run before the page's own shortcut handlers.
  window.addEventListener("keydown", onKeydown, true);
}

function onKeydown(e) {
  if (!eventGate(e)) return;
  if (keyState.modal) {
    if (isEventFromUi(e)) return;
    keyState.modal(e);
    return;
  }

  if (shouldIgnoreEvent(e)) {
    if (keyState.pending.length || keyState.count) resetPending();
    return;
  }

  const token = eventToToken(e);
  if (!token) return;

  // Typing, modifier keys and unowned browser/native shortcuts never scan the page.
  if (
    keyState.pending.length ||
    keyState.bindings.some(
      (b) => b.tokens[0] === token && (!b.when || b.when(buildContext())),
    )
  )
    prepareInput();

  if (!keyState.pending.length && handleCountPrefix(e)) return;

  keyState.repeat = e.repeat;
  keyState.pending.push(token);
  const resolved = resolvePending();

  if (resolved === "none") {
    // An unknown continuation ("gx") drops the sequence; retry the last key alone.
    const retry = keyState.pending.length > 1;
    resetPending();
    if (retry) {
      keyState.pending.push(token);
      if (resolvePending() === "none") {
        resetPending();
        return;
      }
    } else {
      return;
    }
  }

  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
}

/**
 * Looks at keyState.pending and either runs a binding, waits for more keys, or
 * reports "none" when nothing can match.
 */
function resolvePending() {
  const ctx = buildContext();
  const active = keyState.bindings.filter(
    (binding) => !binding.when || binding.when(ctx),
  );
  const pending = keyState.pending;

  const candidates = active.filter((binding) =>
    startsWithTokens(binding.tokens, pending),
  );
  if (!candidates.length) return "none";

  const exact = candidates.find((binding) => binding.tokens.length === pending.length);
  const longer = candidates.some((binding) => binding.tokens.length > pending.length);

  clearTimeout(keyState.timer);

  if (exact && !longer) {
    runBinding(exact);
    return "ran";
  }

  updateShowcmd();
  keyState.timer = window.setTimeout(() => {
    if (exact) runBinding(exact);
    else resetPending();
  }, SEQUENCE_TIMEOUT_MS);
  return "waiting";
}

function runBinding(binding) {
  const hasCount = Boolean(keyState.count);
  const count = hasCount ? Math.min(MAX_COUNT, Math.max(1, Number(keyState.count))) : 1;
  const repeat = keyState.repeat;
  resetPending();

  try {
    const result = binding.action({
      ...buildContext(),
      count,
      hasCount,
      repeat,
      binding,
    });
    if (result && typeof result.catch === "function") {
      result.catch((error) => console.warn(`[keybinds] ${binding.keys} failed`, error));
    }
  } catch (error) {
    console.warn(`[keybinds] ${binding.keys} failed`, error);
  }
}

function buildContext() {
  return { url: new URL(location.href), ...contextProvider() };
}

function resetPending() {
  keyState.pending = [];
  keyState.count = "";
  clearTimeout(keyState.timer);
  keyState.timer = null;
  updateShowcmd();
}

function startsWithTokens(tokens, prefix) {
  if (prefix.length > tokens.length) return false;
  return prefix.every((token, index) => tokens[index] === token);
}

// --- key parsing ---

function parseKeys(keys) {
  return keys.match(/<[^>]+>|./gu) || [];
}

function eventToToken(e) {
  if (MODIFIER_KEYS.has(e.key)) return null;

  // Leave Cmd/Alt shortcuts to the browser and OS (Cmd+L, Alt+Left, ...).
  if (e.metaKey || e.altKey) return null;

  const named = NAMED_KEYS[e.key];
  if (e.ctrlKey) {
    const key = named || e.key.toLowerCase();
    return `<C-${key}>`;
  }

  if (named) return e.shiftKey && named !== "Space" ? `<S-${named}>` : `<${named}>`;
  if (e.key.length === 1) return e.key;
  return null;
}

function handleCountPrefix(e) {
  if (e.ctrlKey || e.altKey || e.metaKey || !/^\d$/.test(e.key)) return false;
  if (!contextProvider().counts) return false;

  // Vim-style counts start with 1-9; 0 is only part of an existing count.
  if (e.key === "0" && !keyState.count) return false;

  keyState.count = `${keyState.count}${e.key}`.slice(0, 3);
  clearTimeout(keyState.timer);
  keyState.timer = window.setTimeout(resetPending, COUNT_TIMEOUT_MS);
  updateShowcmd();

  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
  return true;
}

// --- text fields ---

function getDeepActiveElement() {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

function isTextField(el) {
  if (!el || el.nodeType !== 1) return false;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (
    tag === "INPUT" &&
    ![
      "checkbox",
      "radio",
      "range",
      "button",
      "submit",
      "reset",
      "file",
      "color",
    ].includes(el.type)
  )
    return true;
  if (el.isContentEditable) return true;
  const role = el.getAttribute("role");
  if (role === "textbox" || role === "searchbox" || role === "combobox") return true;
  return false;
}

function isEventFromUi(e) {
  return Boolean(ui.host) && e.composedPath().includes(ui.host);
}

function shouldIgnoreEvent(e) {
  // IME composition — never intercept
  if (e.isComposing) return true;

  // Our own picker input handles its own keys.
  if (isEventFromUi(e)) return true;

  // Shadow DOM hides the real target from document.activeElement, so check
  // both the deep active element and the event's composed path.
  const active = getDeepActiveElement();
  const target = e.composedPath()[0];
  const typing = isTextField(active) || isTextField(target);

  // Escape blurs text fields to re-enter "normal mode"
  if (e.key === "Escape" && typing && !contextProvider().native) {
    (isTextField(active) ? active : target).blur?.();
    document.activeElement?.blur?.();
    e.preventDefault();
    e.stopPropagation();
    return true;
  }

  // In a text field — let the keypress through
  return typing;
}

// ═══════════════════════════════════════════
// UI layer
// ═══════════════════════════════════════════

const ui = {
  host: null,
  root: null,
  cursor: null,
  showcmd: null,
  cursorTarget: null,
  cursorRects: null,
  frame: null,
  resizeObserver: null,
};

const UI_STYLE = `
  :host { all: initial; }
  .layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483646;
    font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif; color: #e6edf3; }
  /* Positioned in document coordinates, so scrolling moves it for free. */
  .cursor { position: absolute; top: 0; left: 0; display: none; pointer-events: none; box-sizing: border-box;
    border: 2px solid #58a6ff; border-radius: 10px; box-shadow: 0 0 0 3px rgba(88, 166, 255, 0.18);
    will-change: transform; transition: transform 70ms ease-out, width 70ms ease-out, height 70ms ease-out; }
  .cursor::before { content: ""; position: absolute; left: -2px; top: 6px; bottom: 6px; width: 4px;
    border-radius: 4px; background: #58a6ff; }
  .toast { position: fixed; right: 24px; bottom: 24px; padding: 9px 14px; border-radius: 999px;
    background: #111827; color: #fff; font-weight: 600; box-shadow: 0 10px 30px rgba(0,0,0,.35); }
  .toast.error { background: #8b1e1e; }
  .showcmd { position: fixed; right: 24px; bottom: 72px; display: none; padding: 4px 10px; border-radius: 6px;
    background: #111827; color: #9ecbff; font: 600 14px ui-monospace, SFMono-Regular, Menlo, monospace;
    box-shadow: 0 6px 20px rgba(0,0,0,.3); }
  .backdrop { position: fixed; inset: 0; background: rgba(1, 4, 9, 0.55); pointer-events: auto;
    display: flex; align-items: flex-start; justify-content: center; padding-top: 12vh; }
  .panel { width: min(640px, calc(100vw - 32px)); max-height: 70vh; display: flex; flex-direction: column;
    background: #0d1117; border: 1px solid #30363d; border-radius: 12px; overflow: hidden;
    box-shadow: 0 24px 60px rgba(0,0,0,.5); }
  .prompt { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-bottom: 1px solid #30363d; }
  .prompt-label { color: #58a6ff; font: 600 14px ui-monospace, SFMono-Regular, Menlo, monospace; white-space: nowrap; }
  .prompt input { flex: 1; min-width: 0; background: transparent; border: 0; outline: 0; color: #e6edf3;
    font: 15px ui-monospace, SFMono-Regular, Menlo, monospace; }
  .list { overflow-y: auto; padding: 6px; margin: 0; list-style: none; }
  .item { display: flex; align-items: baseline; gap: 10px; padding: 7px 10px; border-radius: 7px; cursor: pointer; }
  .item.active { background: #1f6feb; }
  .item-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .item-detail { margin-left: auto; color: #8b949e; font-size: 12px; white-space: nowrap; }
  .item.active .item-detail { color: #cfe3ff; }
  .item mark { background: none; color: #ffa657; font-weight: 700; }
  .item.active mark { color: #fff; text-decoration: underline; }
  .empty { padding: 10px 12px; color: #8b949e; }
  .footer { padding: 7px 14px; border-top: 1px solid #30363d; color: #8b949e; font-size: 12px; }
  .help { width: min(920px, calc(100vw - 32px)); max-height: 80vh; overflow-y: auto; padding: 18px 22px; }
  .help h2 { margin: 0 0 12px; font-size: 16px; }
  .help-grid { columns: 2 300px; column-gap: 28px; }
  .help-group { break-inside: avoid; margin-bottom: 14px; }
  .help-group h3 { margin: 0 0 6px; color: #58a6ff; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; }
  .help-row { display: flex; gap: 10px; padding: 2px 0; }
  .help-row kbd { min-width: 64px; color: #ffa657; font: 600 12.5px ui-monospace, SFMono-Regular, Menlo, monospace; }
  kbd { font: 600 12px ui-monospace, SFMono-Regular, Menlo, monospace; }
`;

function ensureUi() {
  if (ui.host?.isConnected) return ui;

  // A plain div, not a custom element: sites like Reddit hide undefined custom
  // elements (:not(:defined) { visibility: hidden }), and content scripts can't
  // call customElements.define. Inline !important styles beat page CSS.
  ui.host = document.createElement("div");
  ui.host.setAttribute("data-keybinds-ui", "");
  // Zero-size and absolutely positioned at the document origin: the cursor
  // inside uses document coordinates, the overlays inside .layer stay fixed.
  ui.host.style.cssText =
    "all: initial !important; position: absolute !important; top: 0 !important; left: 0 !important; width: 0 !important; height: 0 !important; overflow: visible !important; display: block !important; visibility: visible !important; pointer-events: none !important; z-index: 2147483646 !important;";
  ui.root = ui.host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = UI_STYLE;

  const layer = document.createElement("div");
  layer.className = "layer";

  ui.cursor = document.createElement("div");
  ui.cursor.className = "cursor";
  ui.showcmd = document.createElement("div");
  ui.showcmd.className = "showcmd";

  layer.append(ui.showcmd);
  ui.root.append(style, ui.cursor, layer);
  ui.layer = layer;
  document.documentElement.appendChild(ui.host);
  return ui;
}

function updateShowcmd() {
  if (!ui.host && !keyState.pending.length && !keyState.count) return;
  ensureUi();
  const text = `${keyState.count}${keyState.pending.join("")}`;
  ui.showcmd.textContent = text;
  ui.showcmd.style.display = text ? "block" : "none";
}

function showToast(message, kind = "ok") {
  ensureUi();
  ui.layer.querySelector(".toast")?.remove();

  const toast = document.createElement("div");
  toast.className = `toast ${kind === "error" ? "error" : ""}`;
  toast.textContent = message;
  ui.layer.appendChild(toast);
  window.setTimeout(() => toast.remove(), 1600);
}

// --- selection cursor ---

/**
 * Draws the cursor around `target`. `getRects(target)` may return several
 * rects (e.g. a comment's header + body without its replies); the cursor
 * covers their union.
 *
 * The cursor lives in document coordinates, so scrolling costs nothing. It is
 * redrawn only when something can move it: selection changes, window resizes,
 * the page or target resizing (ResizeObserver), or refreshCursor() calls from
 * the site script (e.g. after DOM mutations).
 */
function setCursor(target, getRects = (el) => [el.getBoundingClientRect()]) {
  ensureUi();
  ensureCursorObservers();

  if (ui.cursorTarget !== target) {
    if (ui.cursorTarget) ui.resizeObserver.unobserve(ui.cursorTarget);
    ui.resizeObserver.observe(target);
  }

  ui.cursorTarget = target;
  ui.cursorRects = getRects;
  drawCursor();
}

function clearCursor() {
  if (ui.cursorTarget) ui.resizeObserver?.unobserve(ui.cursorTarget);
  ui.cursorTarget = null;
  if (ui.cursor) ui.cursor.style.display = "none";
}

function getCursorTarget() {
  return ui.cursorTarget?.isConnected ? ui.cursorTarget : null;
}

/** Schedules a redraw on the next frame; repeated calls coalesce. */
function refreshCursor() {
  if (!ui.cursorTarget || ui.frame) return;
  ui.frame = requestAnimationFrame(() => {
    ui.frame = null;
    drawCursor();
  });
}

function ensureCursorObservers() {
  if (ui.resizeObserver) return;
  ui.resizeObserver = new ResizeObserver(refreshCursor);
  ui.resizeObserver.observe(document.body);
  window.addEventListener("resize", refreshCursor, { passive: true });
}

function drawCursor() {
  const target = getCursorTarget();
  if (!target) {
    clearCursor();
    return;
  }

  const rect = unionRect(ui.cursorRects(target));
  if (!rect) {
    ui.cursor.style.display = "none";
    return;
  }

  const pad = 4;
  const x = Math.round(rect.left + window.scrollX - pad);
  const y = Math.round(rect.top + window.scrollY - pad);
  const width = `${Math.round(rect.width + pad * 2)}px`;
  const height = `${Math.round(rect.height + pad * 2)}px`;
  const transform = `translate(${x}px, ${y}px)`;

  // Skip style writes when nothing moved, so redundant refreshes stay free.
  const style = ui.cursor.style;
  if (style.display !== "block") style.display = "block";
  if (style.transform !== transform) style.transform = transform;
  if (style.width !== width) style.width = width;
  if (style.height !== height) style.height = height;
}

function unionRect(rects) {
  const visible = rects.filter((rect) => rect && rect.width > 0 && rect.height > 0);
  if (!visible.length) return null;
  const top = Math.min(...visible.map((rect) => rect.top));
  const left = Math.min(...visible.map((rect) => rect.left));
  const bottom = Math.max(...visible.map((rect) => rect.bottom));
  const right = Math.max(...visible.map((rect) => rect.right));
  return {
    top,
    left,
    bottom,
    right,
    width: right - left,
    height: bottom - top,
  };
}

/**
 * Scrolls just enough to bring `rect` into view below a sticky header,
 * like vim's scrolloff. Items taller than the viewport align to the top.
 */
function scrollRectIntoView(rect, { topOffset = 0, margin = 40, smooth = true } = {}) {
  if (!rect) return;
  const viewTop = topOffset + margin;
  const viewBottom = window.innerHeight - margin;
  let delta = 0;

  if (rect.top < viewTop || rect.height > viewBottom - viewTop) {
    delta = rect.top - viewTop;
  } else if (rect.bottom > viewBottom) {
    delta = rect.bottom - viewBottom;
  }

  if (Math.abs(delta) > 1)
    window.scrollBy({ top: delta, behavior: smooth ? "smooth" : "instant" });
}

// --- modal overlays ---

function openModal(content, onKeydown) {
  ensureUi();
  const backdrop = document.createElement("div");
  backdrop.className = "backdrop";
  backdrop.appendChild(content);
  ui.layer.appendChild(backdrop);

  const previousFocus = getDeepActiveElement();
  const close = () => {
    backdrop.remove();
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    if (keyState.modal === handler) keyState.modal = null;
  };
  const handler = (e) => onKeydown(e, close);

  backdrop.addEventListener("mousedown", (e) => {
    if (e.target === backdrop) close();
  });
  keyState.modal = handler;
  resetPending();
  return close;
}

function showHelp(title = "Keyboard shortcuts") {
  const panel = document.createElement("div");
  panel.className = "panel help";

  const heading = document.createElement("h2");
  heading.textContent = title;

  const grid = document.createElement("div");
  grid.className = "help-grid";

  const groups = new Map();
  for (const binding of keyState.bindings) {
    if (!binding.desc || (binding.when && !binding.when(buildContext()))) continue;
    const name = binding.group || "Other";
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(binding);
  }

  for (const [name, bindings] of groups) {
    const group = document.createElement("div");
    group.className = "help-group";
    const h3 = document.createElement("h3");
    h3.textContent = name;
    group.appendChild(h3);

    for (const binding of bindings) {
      const row = document.createElement("div");
      row.className = "help-row";
      const kbd = document.createElement("kbd");
      kbd.textContent = binding.keys;
      const desc = document.createElement("span");
      desc.textContent = binding.desc;
      row.append(kbd, desc);
      group.appendChild(row);
    }
    grid.appendChild(group);
  }

  panel.append(heading, grid);

  openModal(panel, (e, close) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (["Escape", "?", "q", "Enter"].includes(e.key)) close();
    else if (e.key === "j") panel.scrollBy({ top: 60 });
    else if (e.key === "k") panel.scrollBy({ top: -60 });
  });
}

// --- fuzzy picker ---

/**
 * Opens a picker. `source(query)` returns (or resolves to) an array of
 * { label, detail?, value } items; it is called on every keystroke, so async
 * sources should be cheap or debounced by the caller. Resolves to the chosen
 * item, or null when cancelled.
 *
 * Keys: Enter picks, Esc cancels, Up/Down, Ctrl-n/Ctrl-p, Ctrl-j/Ctrl-k or
 * Tab/Shift-Tab move.
 */
function openPicker({
  label = ">",
  placeholder = "",
  initial = "",
  footer = "",
  source,
}) {
  return new Promise((resolve) => {
    const panel = document.createElement("div");
    panel.className = "panel";

    const prompt = document.createElement("div");
    prompt.className = "prompt";
    const labelEl = document.createElement("span");
    labelEl.className = "prompt-label";
    labelEl.textContent = label;
    const input = document.createElement("input");
    input.placeholder = placeholder;
    input.value = initial;
    input.spellcheck = false;
    input.autocomplete = "off";
    prompt.append(labelEl, input);

    const list = document.createElement("ul");
    list.className = "list";

    panel.append(prompt, list);
    if (footer) {
      const footerEl = document.createElement("div");
      footerEl.className = "footer";
      footerEl.textContent = footer;
      panel.appendChild(footerEl);
    }

    let items = [];
    let active = 0;
    let generation = 0;
    let done = false;

    const finish = (value, event) => {
      if (done) return;
      done = true;
      close();
      resolve(value ? { ...value, trusted: Boolean(event?.isTrusted) } : null);
    };

    const render = () => {
      list.replaceChildren();
      if (!items.length) {
        const empty = document.createElement("li");
        empty.className = "empty";
        empty.textContent = "No matches";
        list.appendChild(empty);
        return;
      }

      items.forEach((item, index) => {
        const li = document.createElement("li");
        li.className = `item ${index === active ? "active" : ""}`;
        const itemLabel = document.createElement("span");
        itemLabel.className = "item-label";
        appendHighlighted(itemLabel, item.label, input.value);
        li.appendChild(itemLabel);
        if (item.detail) {
          const detail = document.createElement("span");
          detail.className = "item-detail";
          detail.textContent = item.detail;
          li.appendChild(detail);
        }
        li.addEventListener("mousedown", (e) => {
          e.preventDefault();
          finish(item, e);
        });
        list.appendChild(li);
      });

      list.children[active]?.scrollIntoView({ block: "nearest" });
    };

    const refresh = async () => {
      const current = ++generation;
      const result = await source(input.value);
      if (current !== generation || done) return;
      items = result || [];
      active = Math.min(active, Math.max(0, items.length - 1));
      render();
    };

    const move = (delta) => {
      if (!items.length) return;
      list.children[active]?.classList.remove("active");
      active = (active + delta + items.length) % items.length;
      list.children[active]?.classList.add("active");
      list.children[active]?.scrollIntoView({ block: "nearest" });
    };

    input.addEventListener("input", () => {
      active = 0;
      refresh();
    });

    input.addEventListener("keydown", (e) => {
      if (e.isComposing) return;
      const ctrl = e.ctrlKey && !e.metaKey && !e.altKey;
      let handled = true;

      if (e.key === "Escape") finish(null);
      else if (e.key === "Enter") finish(items[active] || null, e);
      else if (
        e.key === "ArrowDown" ||
        (e.key === "Tab" && !e.shiftKey) ||
        (ctrl && ["n", "j"].includes(e.key))
      )
        move(1);
      else if (
        e.key === "ArrowUp" ||
        (e.key === "Tab" && e.shiftKey) ||
        (ctrl && ["p", "k"].includes(e.key))
      )
        move(-1);
      else handled = false;

      // Keep the page from seeing keys typed into the picker.
      e.stopPropagation();
      if (handled) e.preventDefault();
    });

    const close = openModal(panel, (e) => {
      // Keys that reached the window without passing through the input
      // (focus was lost): send them back to the input.
      if (e.key === "Escape") finish(null);
      else input.focus();
    });

    // Mouse dismissal goes through close() directly; resolve the promise too.
    panel.parentElement.addEventListener("mousedown", (e) => {
      if (e.target === panel.parentElement) finish(null);
    });

    input.focus();
    refresh();
  });
}

function appendHighlighted(container, text, query) {
  const positions = fuzzyMatch(text, query)?.positions || [];
  const marks = new Set(positions);
  let buffer = "";
  let marked = false;

  const flush = () => {
    if (!buffer) return;
    if (marked) {
      const mark = document.createElement("mark");
      mark.textContent = buffer;
      container.appendChild(mark);
    } else {
      container.appendChild(document.createTextNode(buffer));
    }
    buffer = "";
  };

  [...text].forEach((char, index) => {
    const isMarked = marks.has(index);
    if (isMarked !== marked) {
      flush();
      marked = isMarked;
    }
    buffer += char;
  });
  flush();
}

/**
 * Subsequence fuzzy match. Returns { score, positions } or null. Higher scores
 * favour prefix matches, word starts and consecutive characters.
 */
function fuzzyMatch(text, query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return { score: 0, positions: [] };

  const haystack = text.toLowerCase();
  const positions = [];
  let score = 0;
  let from = 0;
  let previous = -2;

  for (const char of needle) {
    if (char === " ") continue;
    const index = haystack.indexOf(char, from);
    if (index === -1) return null;
    positions.push(index);
    score += 1;
    if (index === previous + 1) score += 3;
    if (index === 0 || /[\s/_\-.]/.test(haystack[index - 1])) score += 2;
    previous = index;
    from = index + 1;
  }

  if (haystack.startsWith(needle)) score += 10;
  score -= haystack.length * 0.01;
  return { score, positions };
}

// --- clipboard ---

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the textarea fallback. Safari can be picky here.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.cssText = "position:fixed;left:-9999px;top:-9999px;opacity:0";
  document.body.appendChild(textarea);
  textarea.select();

  const copied = document.execCommand("copy");
  textarea.remove();

  if (!copied) throw new Error("document.execCommand('copy') returned false");
}

export {
  loadKeybinds,
  showToast,
  setCursor,
  clearCursor,
  refreshCursor,
  openPicker,
  showHelp,
  fuzzyMatch,
  copyText,
  getDeepActiveElement,
  resetPending,
};
