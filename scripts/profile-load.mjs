// Cold-cache A/B page-load experiment. Requires a dedicated disposable browser.
// Loads/unloads only the two explicitly supplied Web Vim builds; clears that
// browser's HTTP cache/cookies. Never use a personal or shared agent profile.
import puppeteer from "puppeteer-core";
import { readFile, writeFile, mkdir, cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
if (!process.env.PROFILE_BROWSER_URL || !process.env.PROFILE_BASELINE)
  throw new Error(
    "Set PROFILE_BROWSER_URL (disposable browser) and PROFILE_BASELINE (before.js)",
  );
const out = process.env.PROFILE_OUT || "/tmp/web-vim-profile/loads";
await mkdir(out, { recursive: true });
const fixed = fileURLToPath(new URL("../dist/extension", import.meta.url));
for (const version of ["before", "after"]) {
  const path = `${out}/${version}-extension`;
  await mkdir(path, { recursive: true });
  if (version === "after") await cp(fixed, path, { recursive: true });
  else
    await writeFile(
      `${path}/manifest.json`,
      JSON.stringify({
        manifest_version: 3,
        name: "Web Vim load baseline",
        version: "0.1.0",
        permissions: ["clipboardWrite"],
        content_scripts: [
          {
            matches: ["http://*/*", "https://*/*"],
            js: ["content.js"],
            run_at: "document_idle",
          },
        ],
      }),
    );
  const source = await readFile(
    version === "before" ? process.env.PROFILE_BASELINE : `${fixed}/content.js`,
    "utf8",
  );
  await writeFile(
    `${path}/content.js`,
    `{const started=performance.now();\n${source}\nglobalThis.__webVimStartupMs=performance.now()-started;}`,
  );
}
const browser = await puppeteer.connect({ browserURL: process.env.PROFILE_BROWSER_URL });
const control = await browser.target().createCDPSession();
const urls = process.env.PROFILE_URLS
  ? JSON.parse(process.env.PROFILE_URLS)
  : [
      "https://www.youtube.com/results?search_query=vim+motions",
      "https://duckduckgo.com/?q=vim+motions",
      "https://github.com/Yikizi/web-vim",
      "https://en.wikipedia.org/wiki/Vim_(text_editor)",
    ];
const cookies = process.env.PROFILE_COOKIES
  ? JSON.parse(await readFile(process.env.PROFILE_COOKIES, "utf8"))
  : [];
const reports = [];
let installed;
try {
  for (let round = 0; round < 2; round++)
    for (const url of urls) {
      // Reverse treatment order on the second pass to reduce order/time bias.
      for (const version of round
        ? ["after", "before", "none"]
        : ["none", "before", "after"]) {
        if (installed) {
          await control.send("Extensions.uninstall", { id: installed });
          installed = null;
        }
        if (version !== "none")
          ({ id: installed } = await control.send("Extensions.loadUnpacked", {
            path: `${out}/${version}-extension`,
          }));
        const page = await browser.newPage();
        const cdp = await page.createCDPSession();
        const contexts = [];
        cdp.on("Runtime.executionContextCreated", ({ context }) =>
          contexts.push(context),
        );
        await cdp.send("Runtime.enable");
        await cdp.send("Performance.enable");
        await cdp.send("Network.enable");
        await cdp.send("Network.clearBrowserCache");
        await cdp.send("Network.clearBrowserCookies");
        if (cookies.length) await browser.defaultBrowserContext().setCookie(...cookies);
        await page.setCacheEnabled(false);
        await page.setBypassServiceWorker(true);
        await page.setViewport({ width: 1280, height: 900 });
        await page.evaluateOnNewDocument(() => {
          window.loadProbe = { longTasks: [], lcp: null };
          new PerformanceObserver((list) => {
            for (const e of list.getEntries())
              window.loadProbe.longTasks.push({
                start: e.startTime,
                duration: e.duration,
              });
          }).observe({ type: "longtask", buffered: true });
          new PerformanceObserver((list) => {
            for (const e of list.getEntries()) window.loadProbe.lcp = e.startTime;
          }).observe({ type: "largest-contentful-paint", buffered: true });
        });
        let error = null;
        try {
          await page.goto(url, { waitUntil: "load", timeout: 30000 });
        } catch (e) {
          error = e.message;
        }
        await new Promise((r) => setTimeout(r, 2000));
        const data = await page.evaluate(() => {
          const n = performance.getEntriesByType("navigation")[0];
          const resources = performance.getEntriesByType("resource");
          return {
            url: location.href,
            title: document.title,
            navigation: n?.toJSON(),
            probe: window.loadProbe,
            resources: resources.length,
            transferBytes: resources.reduce((sum, r) => sum + r.transferSize, 0),
            nodes: document.querySelectorAll("*").length,
            visibleDialogs: [
              ...document.querySelectorAll(
                'dialog[open], [role="dialog"][aria-modal="true"]',
              ),
            ].filter(
              (el) =>
                el.getBoundingClientRect().width > 1 &&
                getComputedStyle(el).visibility !== "hidden",
            ).length,
          };
        });
        let extension = null;
        for (const context of contexts.filter((c) => c.auxData?.type === "isolated")) {
          try {
            const value = await cdp.send("Runtime.evaluate", {
              contextId: context.id,
              expression:
                "globalThis.__webVim ? ({startupMs:globalThis.__webVimStartupMs,adapter:__webVim.inspect().adapter,revision:__webVim.inspect().revision,errors:__webVim.inspect().errors}) : null",
              returnByValue: true,
            });
            if (value.result.value) extension = value.result.value;
          } catch {}
        }
        if (version !== "none" && !extension)
          throw new Error(
            `Web Vim did not run for ${version} on ${url}; refusing an invalid A/B sample`,
          );
        const metrics = Object.fromEntries(
          (await cdp.send("Performance.getMetrics")).metrics.map((m) => [
            m.name,
            m.value,
          ]),
        );
        const n = data.navigation || {};
        const row = {
          preservedConsentCookies: Boolean(cookies.length),
          round,
          version,
          requestedUrl: url,
          ...data,
          error,
          extension,
          summary: {
            dnsMs: n.domainLookupEnd - n.domainLookupStart,
            tlsMs: n.secureConnectionStart ? n.connectEnd - n.secureConnectionStart : 0,
            ttfbMs: n.responseStart - n.requestStart,
            documentMs: n.responseEnd - n.responseStart,
            dclMs: n.domContentLoadedEventEnd,
            loadMs: n.loadEventEnd,
            lcpMs: data.probe?.lcp,
            longTaskMs: data.probe?.longTasks.reduce((n, t) => n + t.duration, 0),
            scriptMs: metrics.ScriptDuration * 1000,
            layoutMs: metrics.LayoutDuration * 1000,
            heapBytes: metrics.JSHeapUsedSize,
          },
        };
        reports.push(row);
        console.log(
          JSON.stringify({
            round,
            version,
            site: new URL(url).hostname,
            extension,
            ...row.summary,
          }),
        );
        await writeFile(`${out}/report.json`, JSON.stringify(reports, null, 2) + "\n");
        await page.close();
      }
    }
} finally {
  if (installed) await control.send("Extensions.uninstall", { id: installed });
  await browser.disconnect();
}
