import { unavailable } from "./contract.js";
export function visible(el) {
  if (!el?.isConnected || el.closest('[hidden], [inert], [aria-hidden="true"]'))
    return false;
  const r = el.getBoundingClientRect(),
    s = getComputedStyle(el);
  return r.width > 1 && r.height > 1 && s.visibility !== "hidden" && s.display !== "none";
}
export function label(el) {
  return (
    el?.getAttribute("aria-label") ||
    el?.getAttribute("title") ||
    el?.textContent ||
    ""
  )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}
export function rect(el) {
  const r = el.getBoundingClientRect();
  return {
    top: r.top,
    bottom: r.bottom,
    left: r.left,
    right: r.right,
    width: r.width,
    height: r.height,
  };
}
export function deepAll(root, selector) {
  const found = [...root.querySelectorAll(selector)];
  for (const el of root.querySelectorAll("*"))
    if (el.shadowRoot) found.push(...deepAll(el.shadowRoot, selector));
  return found;
}
export function url(href) {
  if (!href) return null;
  try {
    const u = new URL(href, location.href);
    return ["http:", "https:"].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}
export function open(item, newTab = false) {
  if (!item.href) return unavailable("No primary link");
  if (newTab) {
    const a = document.createElement("a");
    a.href = item.href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.click();
  } else if (item.link?.isConnected) item.link.click();
  else location.assign(item.href);
  return { status: "executed" };
}
export async function menuAction({
  trigger,
  roots,
  selector = '[role="menuitem"]',
  pattern,
  reject,
  guard,
}) {
  if (!trigger || !visible(trigger) || trigger.disabled)
    return unavailable("Menu unavailable");
  trigger.click();
  const until = Date.now() + 1500;
  while (Date.now() < until) {
    if (!guard()) return { status: "stale" };
    const candidates = roots()
      .flatMap((r) => deepAll(r, selector))
      .filter(
        (el) =>
          visible(el) &&
          !el.disabled &&
          el.getAttribute("aria-disabled") !== "true" &&
          pattern.test(label(el)) &&
          (!reject || !reject.test(label(el))),
      );
    const unique = candidates.filter(
      (el) => !candidates.some((other) => other !== el && el.contains(other)),
    );
    if (unique.length > 1) return unavailable("Ambiguous menu action");
    if (unique.length === 1) {
      unique[0].click();
      return { status: "executed" };
    }
    await new Promise((r) => setTimeout(r, 40));
  }
  return unavailable("Menu action not found");
}
export function snapshot(regions) {
  return { version: 1, pageKey: location.href, regions };
}
export function itemFromLink(element, link, id) {
  const href = url(link?.getAttribute("href"));
  return {
    id,
    element,
    label: label(link) || label(element),
    rect: rect(element),
    link,
    href,
    actions: href ? ["open", "openNew", "copy"] : [],
    primaryAction: href ? "open" : undefined,
  };
}
