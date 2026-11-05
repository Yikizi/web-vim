import { snapshot, visible } from "../core/dom.js";
import { unavailable } from "../core/contract.js";

const views = { gi: "images", gn: "news", gv: "videos", gm: "maps", gw: "web" };
function viewOf(url) {
  if (url.searchParams.get("iaxm") === "maps") return "maps";
  return url.searchParams.get("ia");
}
export default {
  id: "duckduckgo",
  matches: () =>
    location.hostname === "duckduckgo.com" ||
    location.hostname.endsWith(".duckduckgo.com"),
  // Native navigation owns the results. Only page-level view actions are added.
  read: () => snapshot([]),
  pageActions: Object.values(views).map((view) => "view:" + view),
  execute(action, _item, { guard }) {
    const view = action.replace(/^view:/, "");
    if (!Object.values(views).includes(view)) return unavailable("Unknown search view");
    const current = new URL(location.href),
      query = current.searchParams.get("q");
    if (!query) return unavailable("Run a search first");
    const targets = [...document.querySelectorAll("a[href]")].filter((link) => {
      if (!visible(link) || link.getAttribute("aria-disabled") === "true") return false;
      const target = new URL(link.href);
      return (
        target.origin === current.origin &&
        target.searchParams.get("q") === query &&
        viewOf(target) === view
      );
    });
    const destinations = new Set(targets.map((link) => link.href));
    if (destinations.size !== 1)
      return unavailable(
        destinations.size ? "Ambiguous search view" : "Search view link unavailable",
      );
    if (!guard()) return { status: "stale" };
    targets[0].click();
    return { status: "executed" };
  },
  shortcuts: Object.entries(views).map(([keys, view]) => ({
    keys,
    action: "view:" + view,
    scope: "page",
    label: "Search view: " + view,
  })),
};
