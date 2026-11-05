import { keyboardPolicy } from "./site-policies.js";
import { start } from "./core/runtime.js";
import duckduckgo from "./adapters/duckduckgo.js";
import youtube from "./adapters/youtube.js";
import reddit from "./adapters/reddit.js";
import generic, { genericRegions } from "./adapters/generic.js";
if (!globalThis.__webVim)
  globalThis.__webVim = start([duckduckgo, youtube, reddit, generic], {
    fallback: generic,
    policy: keyboardPolicy(location.href),
    readDialog: genericRegions,
  });
