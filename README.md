# Web Vim

[![CI](https://github.com/Yikizi/web-vim/actions/workflows/ci.yml/badge.svg)](https://github.com/Yikizi/web-vim/actions/workflows/ci.yml)

An experimental WebExtension with one keyboard/navigation core and small site adapters. No hint labels or model call in the navigation path.

The adapters cover YouTube videos and comment threads, Reddit feeds/comment trees, DuckDuckGo view shortcuts, and a generic DOM fallback. This is the first extraction of the contract, **not yet a feature-complete replacement** for the original Reddit extension.

## Install

Requires Node.js 22+ and npm.

```sh
git clone https://github.com/Yikizi/web-vim.git
cd web-vim
npm ci
npm run build
```

Open your Chromium-based browser's extensions page, enable Developer mode, and load `dist/extension` as an unpacked extension. Disable overlapping keyboard extensions on the same sites. Reload existing tabs after installing or updating. Builds do not change your browser configuration.

Alternatively, download the `web-vim-extension` artifact from a successful [CI run](https://github.com/Yikizi/web-vim/actions), extract it, and load the folder containing `manifest.json`. This is an experimental unpacked extension, not a browser-store release.

## Develop and test

```sh
npm run hooks:install
npm run format
npm run check
```

Tests use a fresh headless Chrome/Chromium and intercepted fixtures. Set `CHROME_PATH` to your browser executable if needed, or `CDP_URL` to an isolated development browser. They do not contact the real sites or perform logged-in account actions.

See [CONTRIBUTING.md](CONTRIBUTING.md) for commit conventions, PR workflow and the agent-desktop setup used on Omarchy. The initial history captures the working prototype; future changes use focused commits and PRs.

## Native keyboard ownership

DuckDuckGo and its subdomains start in native mode: its own handlers retain `j/k`, `/`, `o`, `v`, `m`, digits, text input and Escape. Web Vim adds only `gi` (Images), `gn` (News), `gv` (Videos), `gm` (Maps), and `gw` (Web). Press the two letters in sequence within one second, outside a text field. These commands click the currently rendered view link for the same query; missing or ambiguous destinations fail without navigation.

On DuckDuckGo, `Ctrl-Esc` disables/re-enables these additions without taking over native navigation. Other sites retain the normal/passthrough toggle. Known native-site policy lives in `src/site-policies.js`, separate from DOM adapters and the site-independent core. Other native keyboard sites are not automatically detected yet.

## Keys

| Key         | Action                                                 |
| ----------- | ------------------------------------------------------ |
| `j` / `k`   | Down/up in a list or grid; scroll in an article        |
| `h` / `l`   | Grid left/right; tree parent/child; list back/open     |
| `o` / `O`   | Primary action / open link in new tab                  |
| `y`         | Copy the selected link                                 |
| `gg` / `G`  | First/last loaded item (`5G` selects item 5)           |
| `5j`        | Counted movement                                       |
| `]j` / `[j` | Next/previous tree sibling                             |
| `J` / `K`   | Next/previous region (Shift-j / Shift-k)               |
| `gs`        | Focus page search; choose if ambiguous                 |
| `f`         | Fuzzy-find an object by its own text; Enter selects it |
| `:`         | Search the selected object's available actions         |
| `?`         | Available keybindings                                  |
| `g?`        | Inspect adapter regions and contract failures          |
| `H` / `L`   | Browser back/forward                                   |
| `D` / `U`   | Half-page scroll (Shift-d / Shift-u)                   |
| `Esc`       | Leave text input or clear virtual selection            |
| `Ctrl-Esc`  | Toggle complete passthrough (also works in an editor)  |

Typing, IME composition and Alt/Meta shortcuts are left to their owners. Use the browser's `Ctrl-d` to bookmark, `Ctrl-u` for page source, and `Ctrl-f` for page-text search; `/` focuses search on YouTube and is otherwise left unbound. The virtual selection does not continuously steal native DOM focus. Focus is transferred for explicit focus/search actions.

YouTube adds `gh` (home), `gs` / `s` (subscriptions), `/` (search), `gc` (comments), `gv` (playing video), `u` (like/unlike the playing video or selected comment), `w` (Watch later), and `x` (Not interested). In comments, `j/k` traverses visible comments and replies; `l` expands and enters replies, and `h` returns to the parent. `gg/G` stay in the active section; `zz/zt/zb` align the selection. Counts and `?` use the common engine. Shorts links and routes continue to open in the normal video player; there is no Shorts-feed shortcut. Reddit adds `u/d` (vote), `s` (save), `x` (hide), `r` (reply), and `za/zc/zo` (toggle/collapse/expand). Menu actions report execution, not account-state confirmation. Their availability depends on the actual page and login state.

## Contract

See [the type definition](src/core/contract.d.ts) and [runtime validator](src/core/contract.js).

An adapter has four responsibilities:

1. `matches()` chooses its supported site.
2. `read()` returns a versioned page snapshot: regions, stable item IDs, labels, geometry, relationships and named capabilities.
3. `execute(action, item, {guard})` performs a capability for the supplied item and returns an explicit result.
4. Optional shortcuts map keys to item capabilities, declared `pageActions`, or a named region; the core registers and filters them. Page actions also work without a selection. An optional pure `redirect()` returns a destination for the core to apply.

Adapters do not install listeners, maintain a selection, navigate a grid/tree, or render overlays. Adapter DOM reads may supply a smaller own-content rectangle for a tree node, excluding its children. DOM-specific execution is allowed; input routing and navigation policy remain in the core.

The validator checks version, page identity, unique region/item IDs, connected unique elements per region, grid geometry, advertised primary actions, and tree parent existence/cycles. Invalid snapshots cannot run item actions. `g?` remains available to explain the failure.

A valid shape does **not** prove semantic correctness. Adapter acceptance also requires browser scenarios, e.g. selecting video `v2` then opening must navigate to `v=v2`. Account mutations need outcome evidence from a logged-in test before they can be declared confirmed.

### Action lifecycle

- `executed`: input dispatched; outcome not verified.
- `confirmed`: observed outcome, with an evidence string.
- `unavailable`: no usable/unambiguous target.
- `stale`: page, target or selection changed while waiting.
- `failed`: execution error or invalid adapter result.

Only one action can be in flight. After every await and immediately before a delayed click, adapters call `guard()`. The core checks route, selected identity, connected element and current adapter mapping. A held/repeated command cannot enqueue a second mutation. DOM changes invalidate snapshots; UI shadow-root changes do not.

### Ownership

```text
keyboard / counts / modes
            |
       command routing
            |
selection + regions + navigation + action lifecycle
            |
      adapter contract v1
       /      |       |       \
 YouTube    Reddit   DDG    generic
```

Selection is stored by page/region/item identity, not index or element reference. A DOM replacement resolves to the new element. A deleted item falls to the next available row; a collapsed descendant returns to a surviving ancestor. Page restoration waits for asynchronously loaded identities. Dialogs temporarily replace the active page model and restore its selection when closed.

`src/core/keyboard-ui.js` is adapted from Mattias's established Reddit engine at commit `6c02ac460608ffc54cc4d1d1f1105976fba90f69`. YouTube adapter behavior was informed by `Yikizi/yt-vim-keybinds` at `2fb44cf7df88305187223c4c24f63dcb4174c676`. Originals remain untouched.

## Current boundaries

- Generic discovery prefers main content, groups semantic rows/cards, and treats long prose as an article with searchable headings. It is heuristic. Anonymous controls and duplicate links have weaker identity than site-specific IDs.
- The browser suite covers rerendering, deletion, column persistence, tree traversal/collapse, route/dialog restoration, fuzzy pickers, shadow-root input, passthrough, invalid adapters and stale async actions.
- The original Reddit's subreddit/search/sort pickers, media/gallery controls, bulk folding, and explicit load-more behavior have not been migrated. YouTube comments now have a tree region; playlist panels and explicit load-more controls still need coverage. These remain migration work, not silently claimed parity.
- No Jev integration yet. Its future input should be observed region/control candidates; its output should be constrained data validated by this contract. No generated JavaScript execution.
- No iframe coordination, closed-shadow traversal, canvas navigation, browser chrome integration or OS pointer layer. The DOM fallback is not a full accessibility-tree implementation.
- Snapshot invalidation is currently per adapter, not incremental per region. The grid algorithm handles regular rows; irregular masonry layouts need more fixtures.
- Selection memory uses tab sessionStorage and contains IDs/URLs. No browsing data is sent to a model or service.

## License

[MIT](LICENSE) © 2026 Mattias Linholm.
