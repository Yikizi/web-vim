// Keyboard ownership is separate from semantic DOM adapters. Known native
// keyboard sites keep their input vocabulary; only explicitly listed additions are intercepted.
export function keyboardPolicy(url) {
  const hostname = new URL(url).hostname;
  if (hostname === "duckduckgo.com" || hostname.endsWith(".duckduckgo.com")) {
    return {
      defaultMode: "native",
      supplementalKeys: ["gi", "gn", "gv", "gm", "gw"],
      reason: "DuckDuckGo owns keyboard navigation by default",
    };
  }
  return { defaultMode: "normal" };
}
