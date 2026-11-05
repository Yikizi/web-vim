// Deterministic DOM/keyboard integration checks in an isolated browser context.
import puppeteer from "puppeteer-core";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
const script = await readFile(
  new URL("../dist/extension/content.js", import.meta.url),
  "utf8",
);
const connected = Boolean(process.env.CDP_URL);
const executablePath =
  process.env.CHROME_PATH ||
  [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
  ].find(existsSync);
if (!connected && !executablePath)
  throw new Error(
    "Set CHROME_PATH to Chrome/Chromium, or CDP_URL to an isolated test browser.",
  );
const browser = connected
  ? await puppeteer.connect({ browserURL: process.env.CDP_URL })
  : await puppeteer.launch({
      executablePath,
      headless: true,
      args: process.env.CI ? ["--no-sandbox"] : [],
    });
const context = await browser.createBrowserContext();
const page = await context.newPage();
const failures = [];
let passed = 0,
  html = "";
page.on("pageerror", (e) => failures.push(e.message));
await page.setViewport({ width: 1280, height: 900 });
await page.setRequestInterception(true);
page.on("request", (r) =>
  r.respond({ status: 200, contentType: "text/html", body: html }),
);
const style =
  "<style>body{font:18px sans-serif;margin:30px}main{max-width:900px}a{color:#3870ce}li{padding:20px}ytd-rich-item-renderer{display:block;width:220px;height:100px;border:1px solid #aaa;padding:10px}#grid{display:grid;grid-template-columns:repeat(3,250px);gap:20px}shreddit-post,shreddit-comment{display:block;margin:16px;padding:12px;border:1px solid #aaa}summary{padding:12px}dialog{padding:35px}button,input{font:inherit}</style>";
async function load(url, body) {
  html = "<!doctype html><title>Web Vim fixture</title>" + style + body;
  await page.goto(url);
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  // Evaluation returns no DOM handle that can become stale during a route redirect.
  await page.evaluate(script);
}
const state = () => page.evaluate(() => __webVim.inspect());
async function keys(...keys) {
  for (const key of keys) {
    const parts = key.split("+");
    for (const mod of parts.slice(0, -1)) await page.keyboard.down(mod);
    await page.keyboard.press(parts.at(-1));
    for (const mod of parts.slice(0, -1).reverse()) await page.keyboard.up(mod);
  }
  await new Promise((r) => setTimeout(r, 120));
}
async function check(name, fn) {
  await fn();
  passed++;
  console.log("✓ " + name);
}
async function settle() {
  await new Promise((r) => setTimeout(r, 220));
}
try {
  await load(
    "https://duckduckgo.com/?q=test",
    `<input id="search" type="search"><main><ul><li><a href="/one">One</a></li><li><a href="/two">Two</a></li></ul></main><script>
    window.nativeKeys=[];window.nativeIndex=0;
    document.addEventListener('keydown',e=>{
      if(e.target.tagName==='INPUT')return;
      window.nativeKeys.push(e.key);
      if(e.key==='j')window.nativeIndex++;
      if(e.key==='k')window.nativeIndex--;
    });
  </script>`,
  );
  await keys("j", "j", "k", "3", "f", ":", "?");
  await check(
    "DuckDuckGo native handlers receive keys without extension interception",
    async () => {
      assert.equal((await state()).mode, "native");
      assert.deepEqual(
        await page.evaluate(() => [window.nativeIndex, window.nativeKeys]),
        [1, ["j", "j", "k", "3", "f", ":", "?"]],
      );
      assert.equal((await state()).selection.item, null);
      assert.equal(await page.$("[data-keybinds-ui]"), null);
    },
  );
  await page.focus("#search");
  await page.keyboard.type("jk");
  await keys("Escape");
  await check("native mode also preserves page ownership of input Escape", async () =>
    assert.equal(await page.evaluate(() => document.activeElement.id), "search"),
  );
  await page.evaluate(() => document.activeElement.blur());
  await keys("Control+Escape", "j");
  await check(
    "native site toggle disables additions without taking native keys",
    async () => {
      assert.equal((await state()).mode, "passthrough");
      assert.equal((await state()).selection.item, null);
      assert.equal(await page.evaluate(() => window.nativeIndex), 2);
    },
  );
  await keys("Control+Escape", "j");
  await check("toggling back keeps native handling", async () => {
    assert.equal((await state()).mode, "native");
    assert.equal(await page.evaluate(() => window.nativeIndex), 3);
  });

  const searchFixture = `<input id="search" type="search"><nav>
    <a href="/?q=thinkpad&ia=web">All</a>
    <a href="/?q=thinkpad&ia=images&iax=images">Images</a>
    <a href="/?q=thinkpad&ia=news&iar=news">News</a>
    <a href="/?q=thinkpad&ia=videos&iax=videos">Videos</a>
    <a href="/?q=thinkpad&iaxm=maps">Maps</a>
    </nav><script>window.nativeKeys=[];document.addEventListener('keydown',e=>{if(e.target.tagName!=='INPUT')window.nativeKeys.push([e.key,e.defaultPrevented]);});</script>`;
  for (const [key, parameter, view] of [
    ["i", "ia", "images"],
    ["n", "ia", "news"],
    ["v", "ia", "videos"],
    ["m", "iaxm", "maps"],
    ["w", "ia", "web"],
  ]) {
    await load(
      "https://duckduckgo.com/?q=thinkpad&ia=" + (view === "web" ? "images" : "web"),
      searchFixture,
    );
    await keys("g", key);
    await page.waitForFunction(
      (view) => new URL(location.href).searchParams.get(view[0]) === view[1],
      {},
      [parameter, view],
    );
    await check(
      "g" + key + " opens the observed " + view + " tab and retains the query",
      async () => {
        assert.equal(new URL(page.url()).searchParams.get(parameter), view);
        assert.equal(new URL(page.url()).searchParams.get("q"), "thinkpad");
      },
    );
  }
  await load("https://duckduckgo.com/?q=thinkpad&ia=web", searchFixture);
  await keys("g", "j", "/", "o", "v", "m", "3");
  await check(
    "unmatched sequence continuation and native shortcuts pass through untouched",
    async () =>
      assert.deepEqual(
        await page.evaluate(() => window.nativeKeys),
        ["j", "/", "o", "v", "m", "3"].map((k) => [k, false]),
      ),
  );
  await page.focus("#search");
  await page.keyboard.type("gi gn gv gm gw");
  await check("search typing and Escape stay native", async () => {
    assert.equal(await page.$eval("#search", (el) => el.value), "gi gn gv gm gw");
    assert.equal(new URL(page.url()).searchParams.get("ia"), "web");
    await keys("Escape");
    assert.equal(await page.evaluate(() => document.activeElement.id), "search");
  });
  await page.evaluate(() => document.activeElement.blur());
  await keys("g");
  await new Promise((r) => setTimeout(r, 1100));
  await keys("i");
  await check("expired prefix does not trigger navigation", async () =>
    assert.equal(new URL(page.url()).searchParams.get("ia"), "web"),
  );
  await keys("Control+Escape", "g", "i");
  await check("passthrough disables the added view commands", async () =>
    assert.equal(new URL(page.url()).searchParams.get("ia"), "web"),
  );
  await keys("Control+Escape");
  await page.evaluate(() => document.querySelector('a[href*="ia=images"]').remove());
  await settle();
  await keys("g", "i");
  await check("missing view link fails safely", async () => {
    assert.equal(new URL(page.url()).searchParams.get("ia"), "web");
    assert.equal((await state()).lastResult.status, "unavailable");
  });
  await load(
    "https://www.youtube.com/",
    '<input type="search" placeholder="Search YouTube"><main><div id="grid">' +
      Array.from(
        { length: 9 },
        (_, n) =>
          `<ytd-rich-item-renderer><a id="video-title-link" href="/watch?v=v${n}">Video ${n}</a><button aria-label="More actions">…</button></ytd-rich-item-renderer>`,
      ).join("") +
      "</div></main>",
  );
  await check("YouTube adapter satisfies contract", async () => {
    assert.equal((await state()).adapter, "youtube");
    assert.deepEqual((await state()).errors, []);
  });
  await keys("j", "l");
  await check("horizontal grid move", async () =>
    assert.equal((await state()).selection.item, "v1"),
  );
  await keys("j");
  await check("vertical grid move keeps column", async () =>
    assert.equal((await state()).selection.item, "v4"),
  );
  await page.evaluate(() => {
    document.body.style.height = "0px";
    document.body.style.overflowY = "scroll";
  });
  await settle();
  await check(
    "selection frame remains visible when root body is zero-height with scroll overflow",
    async () => {
      const cursor = await page.evaluate(() => {
        const el = document
          .querySelector("[data-keybinds-ui]")
          .shadowRoot.querySelector(".cursor");
        return {
          display: getComputedStyle(el).display,
          width: el.getBoundingClientRect().width,
          height: el.getBoundingClientRect().height,
        };
      });
      assert.equal(cursor.display, "block");
      assert.ok(cursor.width > 200 && cursor.height > 90);
    },
  );
  await page.evaluate(() => {
    document.body.style.removeProperty("height");
    document.body.style.removeProperty("overflow-y");
  });
  await settle();
  await keys("2", "k");
  await check("counted movement clamps", async () =>
    assert.equal((await state()).selection.item, "v1"),
  );
  await page.evaluate(() => {
    const a = document.querySelectorAll("ytd-rich-item-renderer")[1];
    a.replaceWith(a.cloneNode(true));
  });
  await settle();
  await check("rerender preserves selected video", async () =>
    assert.equal((await state()).selection.item, "v1"),
  );
  await page.evaluate(() =>
    document.querySelectorAll("ytd-rich-item-renderer")[1].remove(),
  );
  await settle();
  await check("deletion selects next video", async () =>
    assert.equal((await state()).selection.item, "v2"),
  );
  await keys("/");
  await page.keyboard.type("jkl");
  await check("typing does not trigger navigation", async () => {
    assert.equal(await page.$eval("input", (e) => e.value), "jkl");
    assert.equal((await state()).selection.item, "v2");
  });
  await keys("Escape");
  await keys("Control+Escape", "j");
  await check("passthrough does not navigate", async () =>
    assert.equal((await state()).selection.item, "v2"),
  );
  await keys("Control+Escape");
  await page.evaluate(() => {
    window.triggerCount = 0;
    window.actionCount = 0;
    for (const button of document.querySelectorAll("button"))
      button.onclick = () => {
        window.triggerCount++;
        setTimeout(() => {
          const popup = document.createElement("ytd-popup-container");
          popup.innerHTML = '<div role="menuitem">Watch later</div>';
          popup.querySelector("div").onclick = () => window.actionCount++;
          document.body.append(popup);
        }, 300);
      };
  });
  await keys("w", "w", "l");
  await new Promise((r) => setTimeout(r, 450));
  await check(
    "async action cancels when selection changes and repeats do not double execute",
    async () => {
      assert.deepEqual(
        await page.evaluate(() => [window.triggerCount, window.actionCount]),
        [1, 0],
      );
      assert.equal((await state()).lastResult.status, "stale");
    },
  );
  await page.evaluate(() => document.querySelector("ytd-popup-container").remove());
  await keys("h");
  await page.evaluate(() =>
    document.querySelector("main").addEventListener("click", (e) => {
      const a = e.target.closest("a");
      if (a) {
        e.preventDefault();
        history.pushState({}, "", a.href);
        document.querySelector("main").innerHTML = "<h1>Video detail</h1>";
      }
    }),
  );
  await keys("o");
  await check("open follows selected video URL", async () =>
    assert.equal(new URL(page.url()).searchParams.get("v"), "v2"),
  );

  await load(
    "https://www.youtube.com/watch?v=fixture",
    `
    <style>ytd-watch-metadata,ytd-comments,ytd-comment-thread-renderer,ytd-comment-view-model,ytd-comment-replies-renderer{display:block}
    ytd-comment-view-model{height:150px;padding:15px;border:1px solid #999;margin:10px} [hidden]{display:none!important}</style>
    <div hidden><ytd-comments><ytd-comment-view-model data-comment-id="hidden">Hidden</ytd-comment-view-model></ytd-comments>
    <ytd-watch-metadata><like-button-view-model><button onclick="window.badLike=true">Hidden like</button></like-button-view-model></ytd-watch-metadata></div>
    <input type="search" name="search_query">
    <ytd-watch-metadata><h1>Playing video</h1><like-button-view-model><button aria-pressed="false" onclick="this.setAttribute('aria-pressed',this.getAttribute('aria-pressed')!=='true')">Like video</button></like-button-view-model></ytd-watch-metadata>
    <ytd-comments>
      <ytd-comment-thread-renderer>
        <ytd-comment-view-model data-comment-id="a"><div id="content-text">First comment</div><div id="like-button"><button aria-pressed="false" onclick="this.setAttribute('aria-pressed',this.getAttribute('aria-pressed')!=='true')">Like comment</button></div><div id="reply-button-end"><button onclick="window.compose=true">Reply</button></div></ytd-comment-view-model>
        <div id="more-replies-sub-thread"><button onclick="setTimeout(()=>{document.querySelector('#replies').hidden=false;this.parentElement.hidden=true;document.querySelector('#less-replies-sub-thread').hidden=false},100)">Show replies</button></div>
        <div id="less-replies-sub-thread" hidden><button onclick="document.querySelector('#replies').hidden=true;this.parentElement.hidden=true;document.querySelector('#more-replies-sub-thread').hidden=false">Hide replies</button></div>
        <ytd-comment-replies-renderer id="replies" hidden><ytd-comment-thread-renderer><ytd-comment-view-model data-comment-id="reply"><div id="content-text">Child comment</div><div id="like-button"><button aria-pressed="false" onclick="this.setAttribute('aria-pressed','true')">Like reply</button></div></ytd-comment-view-model></ytd-comment-thread-renderer></ytd-comment-replies-renderer>
      </ytd-comment-thread-renderer>
      <ytd-comment-thread-renderer><ytd-comment-view-model data-comment-id="b"><div id="content-text">Second comment</div></ytd-comment-view-model></ytd-comment-thread-renderer>
    </ytd-comments>`,
  );
  await keys("u");
  await check(
    "YouTube u likes the playing video without requiring selection",
    async () => {
      assert.equal(
        await page.evaluate(() =>
          [...document.querySelectorAll("like-button-view-model button")]
            .at(-1)
            .getAttribute("aria-pressed"),
        ),
        "true",
      );
      assert.equal(await page.evaluate(() => !!window.badLike), false);
      assert.equal((await state()).lastResult.status, "confirmed");
    },
  );
  await keys("g", "c");
  await check("gc enters visible comments and excludes hidden duplicates", async () => {
    assert.deepEqual((await state()).errors, []);
    assert.deepEqual((await state()).selection, { region: "comments", item: "a" });
  });
  await keys("u");
  await check("u targets the selected comment", async () =>
    assert.equal(
      await page.$eval('[data-comment-id="a"] #like-button button', (e) =>
        e.getAttribute("aria-pressed"),
      ),
      "true",
    ),
  );
  await keys("u");
  await check("u toggles a comment like off", async () =>
    assert.equal(
      await page.$eval('[data-comment-id="a"] #like-button button', (e) =>
        e.getAttribute("aria-pressed"),
      ),
      "false",
    ),
  );
  await keys("l");
  await settle();
  await check(
    "l expands replies and enters the child without opening a composer",
    async () => {
      assert.equal((await state()).selection.item, "reply");
      assert.equal(await page.evaluate(() => !!window.compose), false);
    },
  );
  await keys("h");
  await check("h returns from reply to its parent", async () =>
    assert.equal((await state()).selection.item, "a"),
  );
  await keys("h", "j");
  await check("h collapses replies and j skips hidden descendants", async () =>
    assert.equal((await state()).selection.item, "b"),
  );
  await keys("g", "g", "G");
  await check("gg/G stay in the comments region", async () =>
    assert.equal((await state()).selection.item, "b"),
  );
  await keys("g", "v");
  await check("gv returns to playing video", async () =>
    assert.equal((await state()).selection.region, "player"),
  );
  await keys("g", "s");
  await check("YouTube gs navigates to subscriptions", async () =>
    assert.equal(new URL(page.url()).pathname, "/feed/subscriptions"),
  );
  await load(
    "https://www.youtube.com/feed/subscriptions",
    "<main>No loaded videos</main>",
  );
  await keys("g", "h");
  await check("gh works even when there is no selected item or video grid", async () =>
    assert.equal(new URL(page.url()).pathname, "/"),
  );
  await load("https://www.youtube.com/shorts/short123", "<main>Short</main>");
  await settle();
  await check("Shorts routes redirect to the normal player", async () => {
    assert.equal(new URL(page.url()).pathname, "/watch");
    assert.equal(new URL(page.url()).searchParams.get("v"), "short123");
  });

  await load(
    "https://www.reddit.com/r/test/comments/post/title",
    '<main><shreddit-post id="post" permalink="/r/test/comments/post/title"><a href="/r/test/comments/post/title">Post</a></shreddit-post><shreddit-comment thingid="a"><details open><summary>Comment A</summary><p>Body A</p><shreddit-comment thingid="child"><details open><summary>Reply</summary><p>Child body</p></details></shreddit-comment></details></shreddit-comment><shreddit-comment thingid="b"><details open><summary>Comment B</summary><p>Body B</p></details></shreddit-comment></main>',
  );
  await check("Reddit tree contract", async () =>
    assert.deepEqual((await state()).errors, []),
  );
  await keys("j", "l");
  await check("tree enters first comment", async () =>
    assert.equal((await state()).selection.item, "a"),
  );
  await keys("l");
  await check("tree enters child", async () =>
    assert.equal((await state()).selection.item, "child"),
  );
  await keys("h", "]", "j");
  await check("sibling motion skips descendants", async () =>
    assert.equal((await state()).selection.item, "b"),
  );
  await keys("[", "j", "z", "a", "j");
  await check("collapsed descendants are skipped", async () =>
    assert.equal((await state()).selection.item, "b"),
  );
  await keys("k", "l");
  await check("child motion expands collapsed item", async () => {
    assert.equal(
      await page.$eval('shreddit-comment[thingid="a"] > details', (e) => e.open),
      true,
    );
    assert.equal((await state()).lastResult.status, "confirmed");
  });

  await load(
    "https://unknown.example/feed",
    '<main><h1>Unknown results</h1><ul><li><a href="/one">First result</a></li><li><a href="/two">Second result</a></li><li><a href="/three">Third result</a></li></ul></main><nav><a href="/settings">Settings</a></nav>',
  );
  await check("unknown site gets sensible list regions", async () => {
    assert.equal((await state()).adapter, "generic");
    assert.deepEqual((await state()).errors, []);
    assert.equal((await state()).regions[0].items.length, 3);
  });
  await keys("j", "j");
  const before = (await state()).selection;
  await page.evaluate(() => {
    const d = document.createElement("dialog");
    d.innerHTML = '<button id="close">Close dialog</button>';
    document.body.append(d);
    d.querySelector("button").onclick = () => d.close();
    d.showModal();
  });
  await settle();
  await keys("j", "o");
  await settle();
  await check("dialog exit restores underlying selection", async () =>
    assert.deepEqual((await state()).selection, before),
  );
  await keys("f");
  await page.keyboard.type("Third");
  await keys("Enter");
  await check("text picker selects without labels", async () =>
    assert.equal((await state()).selection.item, "https://unknown.example/three"),
  );
  await keys(":");
  await check("action palette advertises selected capabilities", async () =>
    assert.match(
      await page.evaluate(
        () => document.querySelector("[data-keybinds-ui]").shadowRoot.textContent,
      ),
      /openNew/,
    ),
  );
  await keys("Escape");
  await keys("g", "?");
  await check("contract diagnostics render", async () =>
    assert.match(
      await page.evaluate(
        () => document.querySelector("[data-keybinds-ui]").shadowRoot.textContent,
      ),
      /Contract v1/,
    ),
  );
  await keys("Escape");
  await keys("Shift+KeyJ");
  await check("region switch selects navigation", async () =>
    assert.equal((await state()).selection.item, "https://unknown.example/settings"),
  );
  await keys("Shift+KeyK");
  await check("Shift-k returns to previous region with one chord", async () =>
    assert.equal((await state()).selection.region, "main"),
  );
  await keys("Shift+KeyJ");
  await page.screenshot({ path: join(tmpdir(), "web-vim-fixture.png") });
  // Same document route restoration, including an empty loading state.
  await page.evaluate(() => {
    window.saved = document.querySelector("main").innerHTML;
    history.pushState({}, "", "/detail");
    document.querySelector("main").innerHTML = "<h1>Detail</h1>";
  });
  await settle();
  await page.evaluate(() => {
    history.back();
  });
  await new Promise((r) => setTimeout(r, 500));
  await page.evaluate(() => {
    document.querySelector("main").innerHTML = window.saved;
  });
  await settle();
  await check("SPA back restores previous region and selection", async () =>
    assert.equal((await state()).selection.item, "https://unknown.example/settings"),
  );
  await page.evaluate(() => {
    const host = document.createElement("div");
    host.id = "editor";
    host.attachShadow({ mode: "open" }).innerHTML = "<input>";
    document.body.append(host);
    host.shadowRoot.querySelector("input").focus();
  });
  await page.keyboard.type("jkl");
  await check("shadow-root input is protected", async () =>
    assert.equal(
      await page.evaluate(
        () => document.querySelector("#editor").shadowRoot.querySelector("input").value,
      ),
      "jkl",
    ),
  );
  await keys("Escape");
  await load(
    "https://www.reddit.com/r/test/",
    '<main><shreddit-post id="same"><a href="/one">One</a></shreddit-post><shreddit-post id="same"><a href="/two">Two</a></shreddit-post></main>',
  );
  await check("invalid adapter fails closed", async () => {
    assert.match((await state()).errors.join(), /duplicate/);
    await keys("j", "o");
    assert.equal((await state()).selection.item, null);
  });
  await keys("g", "?");
  await check("broken adapter is inspectable from keyboard", async () =>
    assert.match(
      await page.evaluate(
        () => document.querySelector("[data-keybinds-ui]").shadowRoot.textContent,
      ),
      /duplicate/,
    ),
  );
  await load(
    "https://unknown.example/article",
    '<nav><a href="/home">Home</a></nav><main><h1>Long article</h1>' +
      Array.from(
        { length: 12 },
        (_, n) =>
          '<h2 id="section' +
          n +
          '">Section ' +
          n +
          "</h2><p>" +
          "Article content with useful prose. ".repeat(12) +
          "</p>",
      ).join("") +
      "</main>",
  );
  await check("generic article starts in main content, not navigation", async () => {
    assert.equal((await state()).selection.region, "main");
    assert.equal((await state()).regions[0].kind, "article");
  });
  await keys("j");
  await check("article j scrolls instead of selecting inline links", async () =>
    assert.ok(
      await page.evaluate(() => scrollY > 0),
      JSON.stringify(
        await page.evaluate(() => ({
          state: __webVim.inspect(),
          scroll: scrollY,
          height: document.documentElement.scrollHeight,
          viewport: innerHeight,
          focus: document.activeElement?.tagName,
        })),
      ),
    ),
  );
  const beforeHalfPage = await page.evaluate(() => scrollY);
  await keys("Shift+KeyD");
  await check("Shift-d scrolls down half a page", async () => {
    const distance = await page.evaluate((before) => scrollY - before, beforeHalfPage);
    assert.ok(distance > 300 && distance < 600, `Scrolled ${distance}px`);
  });
  await keys("Shift+KeyU");
  await check("Shift-u scrolls back up half a page", async () =>
    assert.ok(Math.abs((await page.evaluate(() => scrollY)) - beforeHalfPage) < 2),
  );
  await keys("g");
  await check(
    "Ctrl-d and Ctrl-u remain uncancelled browser shortcuts, including after a prefix",
    async () => {
      const result = await page.evaluate(() => {
        const before = scrollY,
          received = [];
        const listener = (e) => received.push([e.key, e.defaultPrevented]);
        document.addEventListener("keydown", listener);
        const allowed = ["d", "u"].map((key) =>
          document.dispatchEvent(
            new KeyboardEvent("keydown", {
              key,
              ctrlKey: true,
              bubbles: true,
              cancelable: true,
            }),
          ),
        );
        document.removeEventListener("keydown", listener);
        return { allowed, received, moved: scrollY !== before };
      });
      assert.deepEqual(result, {
        allowed: [true, true],
        received: [
          ["d", false],
          ["u", false],
        ],
        moved: false,
      });
    },
  );
  await keys("f");
  await page.keyboard.type("Section 8");
  await keys("Enter");
  await check("article headings can be selected by text", async () =>
    assert.equal((await state()).selection.item, "section8"),
  );
  await page.evaluate(() => {
    const main = document.querySelector("main");
    main.replaceWith(main.cloneNode(true));
  });
  await settle();
  await check(
    "generic region and heading identity survive whole-region rerender",
    async () => {
      assert.equal((await state()).selection.region, "main");
      assert.equal((await state()).selection.item, "section8");
    },
  );
  await check("no runtime errors", async () => assert.deepEqual(failures, []));
  console.log(`${passed} browser checks passed`);
} finally {
  await context.close();
  if (connected) await browser.disconnect();
  else await browser.close();
}
