# Performance investigation — 2026-11-06

The reported symptoms were slow YouTube keyboard navigation and slow first page loads. These turned out to need separate measurements. Raw, non-account-specific results are in [performance-results.json](performance-results.json).

## Navigation and memory

An intercepted YouTube grid fixture contained 1,000 cards and over 5,000 elements at 1280×900. Forty `j` keydown events were dispatched 20 ms apart. CPU sampling and Chromium performance metrics were collected; key-handler timings measure synchronous dispatch, not input-to-screen latency. The fixture is deliberately larger than the first screen of a real feed.

| Measurement                              |   Before |    After |
| ---------------------------------------- | -------: | -------: |
| Key-handler median                       |  42.7 ms |   6.2 ms |
| Key-handler p95                          |  82.8 ms |  12.7 ms |
| Full snapshot reads during 40 keys       |       35 |        1 |
| Full reads during 2.4 s of class changes |       16 |        0 |
| Post-GC JS heap added at startup         | 0.59 MiB | 0.60 MiB |
| Heap after 5 replace/open/close cycles   | 2.02 MiB | 2.07 MiB |
| Heap after 20 cycles                     | 2.06 MiB | 2.11 MiB |

CPU samples identified repeated adapter discovery, selectors, geometry and labels as the navigation cost. Previously each scroll dirtied the semantic snapshot, and the next key rebuilt it. Attribute changes also triggered full reads after 80 ms, even without user input. Now scrolling updates geometry only; style/text changes invalidate lazily, and ignored input does not read the page. Structural changes still refresh selection and release old DOM references. The picker changes only the active row on arrow/Tab movement instead of rebuilding all result rows.

There was no large or clearly growing retained-heap leak in this short experiment. This is not a browser RSS measurement or proof that longer sessions cannot leak. Site JavaScript, DOM/native allocations, media, other extensions and multiple tabs need separate accounting.

## First page loads

Twenty-four live loads: four public pages, three treatments (no Web Vim, previous build, candidate), two passes in reversed treatment order. Each navigation cleared the disposable browser's HTTP cache/cookies and bypassed site service workers. Browser/OS DNS, existing connections, server caches and the machine's other activity were not reset. Helium's built-in uBlock remained present in every treatment. These are cold HTTP-cache measurements, not fresh OS boot or the user's signed-in profile.

The table shows median `load` event time for the two samples per treatment. A `load` event is not the same as the page feeling ready; YouTube continues rendering afterward.

| Page              | No Web Vim | Before |  After | Candidate extension startup |
| ----------------- | ---------: | -----: | -----: | --------------------------: |
| YouTube search    |     3.09 s | 2.96 s | 2.98 s |                      3.3 ms |
| DuckDuckGo search |     1.30 s | 1.33 s | 1.26 s |                      5.2 ms |
| GitHub repository |     1.86 s | 1.55 s | 1.84 s |                     15.2 ms |
| Wikipedia article |     0.89 s | 0.77 s | 0.64 s |                     23.3 ms |

YouTube's observed largest-contentful-paint time was 4.48 s without Web Vim, 4.54 s before and 4.30 s after. Without Web Vim it still accumulated about 3.84 s of JavaScript execution and 3.27 s in tasks longer than 50 ms. Its document response began roughly 62 ms after the request. Separate command-line HTTP probes received initial responses from the four hosts in 91–190 ms, including connection setup; those probes do not fetch subresources or execute page scripts.

These samples support a substantial navigation fix, but do **not** show Web Vim causing multi-second first-load delays. YouTube's client-side work is a much larger observed cost than the extension startup. Small treatment differences are not statistically established speedups: sample count is small, live pages vary, and GitHub/Wikipedia server response times differed between samples. Gigabit throughput alone cannot eliminate main-thread script execution. No network, browser-cache or system power settings were changed.

### YouTube consent control

The empty-cookie YouTube runs displayed its consent dialog. To separate that first-visit UI from ordinary search rendering, six further YouTube loads used the disposable profile's saved **Reject all** consent choice, while still clearing HTTP cache and bypassing service workers. All six recorded zero visible dialogs. No account was signed in.

| YouTube, consent already handled | No Web Vim | Before |  After |
| -------------------------------- | ---------: | -----: | -----: |
| Load event                       |     3.34 s | 3.46 s | 3.19 s |
| Observed LCP                     |     4.72 s | 4.93 s | 4.62 s |
| Whole-page JavaScript time       |     4.11 s | 4.07 s | 3.88 s |

The candidate's own initial execution took 4.1–4.2 ms. The main conclusion remains: multi-second initial rendering persists without Web Vim. The additional small-sample differences should not be presented as a statistically established load-time improvement.

`PROFILE_URLS` accepts a JSON array to restrict the page-load experiment. `PROFILE_COOKIES` optionally points to a local cookie JSON exported from the disposable profile so consent can be held constant. Cookie files are local test inputs and must not be committed or shared.

## Reproduce

Use an isolated browser, never a personal profile. On this Omarchy machine launch it through `agent-desktop`; for example:

```sh
agent-desktop run /opt/helium-browser-bin/helium --headless \
  --user-data-dir=/tmp/web-vim-benchmark-browser \
  --remote-debugging-port=9337 --no-first-run about:blank
npm run build
CDP_URL=http://127.0.0.1:9337 PROFILE_FIXTURE=youtube \
  PROFILE_OUT=/tmp/web-vim-profile/after node scripts/profile.mjs
```

For the baseline, save an earlier build's `content.js` and set `PROFILE_SCRIPT=/absolute/path/before.js`. `PROFILE_FIXTURE` defaults to a generic list; `youtube` uses the YouTube grid adapter. CPU profiles and a JSON report are written under `PROFILE_OUT` and can be opened in DevTools.

For page-load comparisons:

```sh
PROFILE_BROWSER_URL=http://127.0.0.1:9337 \
  PROFILE_BASELINE=/absolute/path/before.js \
  PROFILE_OUT=/tmp/web-vim-profile/loads node scripts/profile-load.mjs
```

This script installs/uninstalls temporary Web Vim builds and clears HTTP cache/cookies in that disposable browser. It verifies that the extension actually ran before accepting an enabled sample. Chromium must support `Extensions.loadUnpacked`; do not launch it with `--disable-extensions`. It records navigation timings, observed LCP, long tasks, JS/layout time and the extension's isolated-world startup duration. Heap values in live-page results are **whole-renderer JS heap**, not memory attributable to Web Vim.

`test/extension.mjs` separately checks real browser outcomes (detach, pin/mute, bookmarks, zoom, duplicate/restore, downloads) with the unpacked extension. Set `CDP_EXTENSION_URL` to another disposable browser; this test creates and closes tabs and creates/removes its own bookmark. Regular `npm run check` runs deterministic fixtures and worker unit tests without depending on real sites.
