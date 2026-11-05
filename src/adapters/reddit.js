import {
  visible,
  label,
  rect,
  open,
  menuAction,
  snapshot,
  itemFromLink,
  deepAll,
  url,
} from "../core/dom.js";
import { unavailable } from "../core/contract.js";
const selector =
  'shreddit-post, shreddit-comment, shreddit-profile-comment, [data-testid="search-post-with-content-preview"], [data-testid="sdui-post-unit"]';
function identity(el) {
  return el.getAttribute("thingid") || el.id || el.getAttribute("permalink");
}
function parent(el) {
  return el.parentElement?.closest("shreddit-comment");
}
function details(el) {
  return el.querySelector(":scope > details");
}
function owned(item, el) {
  let node = el;
  while (node) {
    if (node.matches?.("shreddit-comment")) return node === item.element;
    node = node.parentElement || node.getRootNode()?.host;
  }
  return !item.element.matches("shreddit-comment");
}
export default {
  id: "reddit",
  matches: () => location.hostname === "www.reddit.com",
  read() {
    const thread = /\/comments\//.test(location.pathname);
    const elements = [...document.querySelectorAll(selector)].filter(
      (el) =>
        visible(el) &&
        !el.closest("aside, #left-sidebar-container, #right-sidebar-container") &&
        !el.parentElement?.closest("details:not([open])") &&
        (thread || !el.parentElement?.closest(selector)),
    );
    const post = elements.find((el) => el.matches("shreddit-post"));
    const items = elements
      .map((el) => {
        const link = el.querySelector(
          'a[slot="full-post-link"], a[data-testid="post-title"], a[href*="/comments/"]',
        );
        const item = itemFromLink(el, link, identity(el) || link?.href);
        item.href = url(el.getAttribute("permalink")) || item.href;
        if (item.href) {
          item.actions = ["open", "openNew", "copy"];
          item.primaryAction = "open";
        }
        const comment = el.matches("shreddit-comment");
        if (comment) {
          item.parentId = identity(parent(el) || post || el);
          if (item.parentId === item.id) delete item.parentId;
          const d = details(el),
            r = rect(d || el),
            child = d?.open && d.querySelector("shreddit-comment");
          const bottom = child ? child.getBoundingClientRect().top : r.bottom;
          item.rect = { ...r, bottom, height: bottom - r.top };
          item.collapsed = Boolean(d && !d.open);
          if (d) item.actions.push("toggle", "expand", "collapse");
        }
        item.actions.push("upvote", "downvote", "save", "reply");
        if (!comment) item.actions.push("hide");
        return item;
      })
      .filter((i) => i.id);
    return snapshot([
      {
        id: thread ? "thread" : "feed",
        label: thread ? "Discussion" : "Posts",
        kind: thread ? "tree" : "list",
        items,
      },
    ]);
  },
  async execute(action, item, { guard }) {
    if (action === "open" || action === "openNew")
      return open(item, action === "openNew");
    if (["toggle", "collapse", "expand"].includes(action)) {
      const d = details(item.element);
      if (!d) return unavailable("No collapsible content");
      const desired = action === "toggle" ? !d.open : action === "expand";
      if (d.open !== desired) d.querySelector(":scope > summary")?.click();
      return d.open === desired
        ? { status: "confirmed", evidence: `details.open=${desired}` }
        : unavailable("Collapse did not change");
    }
    if (action === "upvote" || action === "downvote") {
      const button = deepAll(item.element, `button[${action}]`).find(
        (el) => owned(item, el) && visible(el),
      );
      if (!button) return unavailable("Vote button unavailable");
      const before = button.getAttribute("aria-pressed");
      button.click();
      await new Promise((r) => setTimeout(r, 150));
      if (!guard()) return { status: "stale" };
      return before !== button.getAttribute("aria-pressed")
        ? { status: "confirmed", evidence: "Vote state changed" }
        : { status: "executed" };
    }
    if (action === "reply") {
      const button = deepAll(item.element, "button").find(
        (el) => owned(item, el) && visible(el) && /^reply$/i.test(label(el)),
      );
      if (!button) return unavailable("Reply unavailable");
      button.click();
      return { status: "executed" };
    }
    if (action === "save" || action === "hide") {
      const trigger = deepAll(item.element, "button").find(
        (el) =>
          owned(item, el) &&
          visible(el) &&
          /more options|overflow|more actions/i.test(label(el)),
      );
      return menuAction({
        selector: '[role="menuitem"], faceplate-menu-item',
        trigger,
        roots: () => [document.body],
        guard,
        pattern:
          action === "save" ? /^(save|unsave)\b|remove from saved/i : /^(hide|unhide)\b/i,
      });
    }
    return unavailable("Unsupported action");
  },
  shortcuts: [
    { keys: "u", action: "upvote", label: "Upvote" },
    { keys: "d", action: "downvote", label: "Downvote" },
    { keys: "s", action: "save", label: "Save / unsave" },
    { keys: "x", action: "hide", label: "Hide" },
    { keys: "r", action: "reply", label: "Reply" },
    { keys: "za", action: "toggle", label: "Toggle collapse" },
    { keys: "zc", action: "collapse", label: "Collapse" },
    { keys: "zo", action: "expand", label: "Expand" },
  ],
};
