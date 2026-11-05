import {
  visible,
  label,
  rect,
  open,
  menuAction,
  snapshot,
  itemFromLink,
} from "../core/dom.js";
import { unavailable } from "../core/contract.js";
const selector =
  "ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer, yt-lockup-view-model";
const linkSelector =
  'a#video-title-link[href], a#video-title[href], a.yt-lockup-metadata-view-model__title[href], a[href*="/watch?"], a[href*="/shorts/"]';
const commentSelector = "ytd-comment-view-model, ytd-comment-renderer";
const firstVisible = (root, selector) =>
  [...root.querySelectorAll(selector)].find(visible);

function commentId(el) {
  const link = el.querySelector('a[href*="lc="]');
  const id = link && new URL(link.href).searchParams.get("lc");
  if (id) return id;
  if (el.getAttribute("data-comment-id")) return el.getAttribute("data-comment-id");
  // Some layouts omit permalinks. Use stable author/content, never an array index
  // or mutable vote count. Ambiguous duplicate IDs fail contract validation.
  const author = el.querySelector("#author-text")?.getAttribute("href") || "";
  const text = el.querySelector("#content-text")?.textContent || el.textContent;
  let hash = 2166136261;
  for (const char of `${author}:${text}`)
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `comment-${hash >>> 0}`;
}

function replyControls(el) {
  const thread = el.closest("ytd-comment-thread-renderer");
  return thread?.querySelector(commentSelector) === el ? thread : el;
}
function expandButton(el) {
  return firstVisible(
    replyControls(el),
    "#more-replies button, #more-replies-sub-thread button",
  );
}
function collapseButton(el) {
  return firstVisible(
    replyControls(el),
    "#less-replies button, #less-replies-sub-thread button, #collapse-button button",
  );
}

function commentsRegion() {
  const container = firstVisible(document, "ytd-comments");
  if (!container) return null;
  const elements = [...container.querySelectorAll(commentSelector)].filter(visible);
  const ids = new Map(elements.map((el) => [el, commentId(el)]));
  const items = elements.map((el) => {
    let parent = el.parentElement?.closest(commentSelector);
    // New YouTube threaded replies have their own nested thread renderer.
    // Walk outward until its root comment differs from the current node.
    for (
      let thread = el.closest("ytd-comment-thread-renderer");
      !parent && thread;
      thread = thread.parentElement?.closest("ytd-comment-thread-renderer")
    ) {
      const root = thread.querySelector(commentSelector);
      if (root !== el && ids.has(root)) parent = root;
    }
    const link = el.querySelector('a[href*="lc="]');
    const item = itemFromLink(el, link, ids.get(el));
    item.kind = "comment";
    item.label = label(el.querySelector("#content-text") || el);
    if (parent !== el && ids.has(parent)) item.parentId = ids.get(parent);
    if (firstVisible(el, "#like-button button")) item.actions.push("like");
    if (expandButton(el)) item.actions.push("expand");
    if (collapseButton(el)) item.actions.push("collapse");
    item.primaryAction = item.actions.includes("expand") ? "expand" : item.primaryAction;
    return item;
  });
  for (const item of items) {
    item.collapsed =
      item.actions.includes("expand") &&
      !items.some((other) => other.parentId === item.id);
  }
  // Selecting the placeholder lets core scrolling trigger YouTube's lazy loader.
  // Once comments arrive core replaces it with the first real comment.
  if (!items.length)
    items.push({
      id: "comments-loading",
      label: "Comments",
      element: container,
      rect: rect(container),
      actions: [],
    });
  return { id: "comments", label: "Comments", kind: "tree", items };
}

async function toggleLike(element, isComment, guard) {
  const button = firstVisible(
    element,
    isComment
      ? "#like-button button"
      : "like-button-view-model button, #like-button button, #segmented-like-button button",
  );
  if (!button || button.disabled || button.getAttribute("aria-disabled") === "true")
    return unavailable("Like button unavailable");
  const before = button.getAttribute("aria-pressed");
  if (!guard()) return { status: "stale" };
  button.click();
  // A sign-in prompt is not a confirmed like. Only an observed toggle is.
  for (let i = 0; i < 12; i++) {
    if (!guard() || !button.isConnected) return { status: "stale" };
    const after = button.getAttribute("aria-pressed");
    if (
      ["true", "false"].includes(before) &&
      after !== before &&
      ["true", "false"].includes(after)
    ) {
      return {
        status: "confirmed",
        evidence: `${isComment ? "Comment" : "Video"} ${after === "true" ? "liked" : "like removed"}`,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return { status: "executed" };
}

export default {
  id: "youtube",
  matches: () => location.hostname === "www.youtube.com",
  pageActions: ["home", "subscriptions", "focusSearch", "like"],
  redirect() {
    const id = location.pathname.match(/^\/shorts\/([^/?#]+)/)?.[1];
    return id ? `/watch?v=${encodeURIComponent(id)}` : null;
  },
  read() {
    const groups = new Map();
    for (const el of document.querySelectorAll(selector)) {
      if (el.parentElement?.closest(selector) || !visible(el)) continue;
      const link = el.querySelector(linkSelector);
      if (!link) continue;
      const u = new URL(link.href),
        videoId = u.searchParams.get("v") || u.pathname.match(/\/shorts\/([^/]+)/)?.[1];
      if (!videoId) continue;
      const id = el.closest("#related")
        ? "recommendations"
        : el.closest("ytd-playlist-panel-renderer")
          ? "playlist"
          : "videos";
      if (!groups.has(id)) groups.set(id, []);
      const items = groups.get(id);
      const occurrence = items.filter((i) => i.videoId === videoId).length;
      const item = itemFromLink(el, link, videoId + (occurrence ? ":" + occurrence : ""));
      // Keyboard opens go straight to the normal player; direct/native Shorts
      // navigation is handled by the route policy above.
      if (u.pathname.startsWith("/shorts/")) {
        item.href = new URL(
          `/watch?v=${encodeURIComponent(videoId)}`,
          location.origin,
        ).href;
        item.link = null;
      }
      item.videoId = videoId;
      item.actions.push("watchLater", "hide");
      items.push(item);
    }
    const regions = [...groups].map(([id, items]) => ({
      id,
      label: id,
      kind: id === "videos" ? "grid" : "list",
      items,
    }));
    const player = firstVisible(document, "ytd-watch-metadata");
    if (player)
      regions.unshift({
        id: "player",
        label: "Playing video",
        kind: "list",
        items: [
          {
            id: "playing:" + (new URL(location.href).searchParams.get("v") || "current"),
            kind: "player",
            label: label(player.querySelector("h1") || player),
            element: player,
            rect: rect(player),
            actions: ["like"],
          },
        ],
      });
    const comments = commentsRegion();
    if (comments) regions.push(comments);
    return snapshot(regions);
  },
  async execute(action, item, { guard }) {
    if (!guard()) return { status: "stale" };
    if (action === "home" || action === "subscriptions") {
      location.assign(action === "home" ? "/" : "/feed/subscriptions");
      return { status: "executed" };
    }
    if (action === "focusSearch") {
      const input = firstVisible(
        document,
        "input[name='search_query'], input[type='search'], input#search",
      );
      if (!input) return unavailable("Search field unavailable");
      input.focus();
      return document.activeElement === input
        ? { status: "confirmed", evidence: "Search focused" }
        : { status: "executed" };
    }
    if (action === "like") {
      const isComment = item?.kind === "comment";
      const target = isComment
        ? item.element
        : firstVisible(document, "ytd-watch-metadata");
      if (!target) return unavailable("Open a video or select a comment first");
      return toggleLike(target, isComment, guard);
    }
    if (action === "expand" || action === "collapse") {
      const button =
        action === "expand" ? expandButton(item.element) : collapseButton(item.element);
      if (!button) return unavailable("Replies control unavailable");
      button.click();
      if (action === "collapse") return { status: "executed" };
      const thread = item.element.closest("ytd-comment-thread-renderer");
      for (let i = 0; i < 30; i++) {
        if (!guard()) return { status: "stale" };
        if (
          [...thread.querySelectorAll(commentSelector)].some(
            (el) => el !== item.element && visible(el),
          )
        )
          return { status: "confirmed", evidence: "Replies opened" };
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return { status: "executed" };
    }
    if (action === "open" || action === "openNew")
      return open(item, action === "openNew");
    if (action === "watchLater" || action === "hide") {
      const trigger =
        [...item.element.querySelectorAll("button, tp-yt-paper-icon-button")].find((el) =>
          /more actions|more options|action menu|rohkem|toiming/i.test(label(el)),
        ) ||
        item.element.querySelector(
          "ytd-menu-renderer button, yt-lockup-metadata-view-model button",
        );
      return menuAction({
        selector:
          '[role="menuitem"], ytd-menu-service-item-renderer, yt-list-item-view-model',
        trigger,
        roots: () => [...document.querySelectorAll("ytd-popup-container")],
        guard,
        pattern:
          action === "watchLater"
            ? /watch later|hiljem vaat/i
            : /not interested|ei ole huvitatud|^hide|^peida/i,
        reject: action === "watchLater" ? /remove|eemalda/i : null,
      });
    }
    return unavailable("Unsupported action");
  },
  shortcuts: [
    { keys: "gh", action: "home", scope: "page", label: "YouTube home" },
    { keys: "gs", action: "subscriptions", scope: "page", label: "Subscriptions" },
    { keys: "s", action: "subscriptions", scope: "page", label: "Subscriptions" },
    { keys: "/", action: "focusSearch", scope: "page", label: "Search YouTube" },
    { keys: "gc", region: "comments", label: "Browse comments" },
    { keys: "gv", region: "player", label: "Return to playing video" },
    {
      keys: "u",
      action: "like",
      scope: "page",
      label: "Like / unlike video or selected comment",
    },
    { keys: "w", action: "watchLater", label: "Watch later" },
    { keys: "x", action: "hide", label: "Not interested" },
  ],
};
