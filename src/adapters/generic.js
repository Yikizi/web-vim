import { visible, label, rect, open, snapshot, itemFromLink } from "../core/dom.js";
import { unavailable } from "../core/contract.js";
const ids = new WeakMap();
let serial = 0;
function stable(el) {
  if (!ids.has(el)) ids.set(el, "node-" + ++serial);
  return el.id || ids.get(el);
}
export function genericRegions(root = document) {
  const regions = [],
    seen = new Set(),
    regionNames = new Map();
  const containers = [
    ...root.querySelectorAll(
      'main, [role="main"], nav, [role="navigation"], aside, article, [role="dialog"], dialog[open]',
    ),
  ]
    .filter(visible)
    .sort(
      (a, b) =>
        Number(b.matches('main, [role="main"]')) -
        Number(a.matches('main, [role="main"]')),
    );
  if (!containers.length) containers.push(root === document ? document.body : root);
  for (const container of containers) {
    const name =
      container.id || container.getAttribute("role") || container.tagName.toLowerCase();
    const occurrence = regionNames.get(name) || 0;
    regionNames.set(name, occurrence + 1);
    const regionId = name + (occurrence ? ":" + occurrence : "");
    const paragraphs = [...container.querySelectorAll("p")].filter(visible);
    if (
      container.matches('main, article, [role="main"]') &&
      paragraphs.length >= 6 &&
      paragraphs.reduce((n, p) => n + p.textContent.length, 0) > 1500
    ) {
      const headings = [...container.querySelectorAll("h1,h2,h3,h4")].filter(visible);
      regions.push({
        id: regionId,
        label: label(headings[0]) || "Article",
        kind: "article",
        items: headings.map((el, n) => ({
          id: el.id || label(el) + ":" + n,
          element: el,
          label: label(el),
          rect: rect(el),
          actions: [],
        })),
      });
      for (const el of container.querySelectorAll("*")) seen.add(el);
      continue;
    }

    const rows = [
      ...container.querySelectorAll('li, [role="listitem"], tr, [role="row"], article'),
    ].filter(
      (el) =>
        visible(el) &&
        !seen.has(el) &&
        !el.parentElement?.closest('li, [role="listitem"], tr, [role="row"]'),
    );
    const candidates =
      rows.length >= 2
        ? rows
        : [
            ...container.querySelectorAll(
              'a[href], button, input, select, textarea, [role="button"]',
            ),
          ].filter(visible);
    const items = [],
      occurrences = new Map();
    for (const el of candidates) {
      if (seen.has(el) || el.closest("[data-keybinds-ui]")) continue;
      const link = el.matches("a[href]") ? el : el.querySelector("a[href]");
      if (!link && !el.matches('button,input,select,textarea,[role="button"]')) continue;
      const key =
          link?.href || el.id || (label(el) ? el.tagName + ":" + label(el) : stable(el)),
        n = occurrences.get(key) || 0;
      occurrences.set(key, n + 1);
      const item = itemFromLink(el, link, key + (n ? ":" + n : ""));
      if (!link) {
        item.actions = [el.matches("input,textarea,select") ? "focus" : "activate"];
        item.primaryAction = item.actions[0];
        item.label ||= el.getAttribute("placeholder") || el.type || "Control";
      }
      if (item.actions.length) items.push(item);
      seen.add(el);
      for (const child of el.querySelectorAll("*")) seen.add(child);
    }
    const id = regionId;
    if (items.length)
      regions.push({
        id,
        label:
          label(container.querySelector("h1,h2")) ||
          container.getAttribute("aria-label") ||
          container.tagName.toLowerCase(),
        kind: "list",
        items,
      });
  }
  if (!regions.length)
    regions.push({ id: "article", label: "Page", kind: "article", items: [] });
  return regions;
}
export default {
  id: "generic",
  matches: () => true,
  read: () => snapshot(genericRegions()),
  execute(action, item) {
    if (action === "open" || action === "openNew")
      return open(item, action === "openNew");
    if (
      !visible(item.element) ||
      item.element.disabled ||
      item.element.getAttribute("aria-disabled") === "true"
    )
      return unavailable("Control unavailable");
    if (action === "focus") {
      item.element.focus();
      return { status: "executed" };
    }
    if (action === "activate") {
      item.element.click();
      return { status: "executed" };
    }
    return unavailable("Unsupported action");
  },
  shortcuts: [],
};
