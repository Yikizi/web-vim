// Repeatable local CPU/heap experiment. Never attaches to a personal browser.
import puppeteer from "puppeteer-core";
import { readFile, writeFile, mkdir } from "node:fs/promises";
const browser = await puppeteer.connect({
  browserURL: process.env.CDP_URL || "http://127.0.0.1:9223",
});
const context = await browser.createBrowserContext();
const page = await context.newPage();
const script = await readFile(
  process.env.PROFILE_SCRIPT || new URL("../dist/extension/content.js", import.meta.url),
  "utf8",
);
const out = process.env.PROFILE_OUT || "/tmp/web-vim-profile/current";
await mkdir(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const youtube = process.env.PROFILE_FIXTURE === "youtube";
const rows = Array.from({ length: 1000 }, (_, i) =>
  youtube
    ? `<ytd-rich-item-renderer><a id="video-title-link" href="/watch?v=video${i}"><strong>Video ${i}</strong><span> Description</span></a><span class="status">Ready</span></ytd-rich-item-renderer>`
    : `<li><a href="/item/${i}"><strong>Item ${i}</strong><span> Description</span></a><span class="status">Ready</span></li>`,
).join("");
const html = `<style>body{font:16px sans-serif}li{height:80px;padding:8px}.busy{color:#333}#grid{display:grid;grid-template-columns:repeat(4,260px);gap:16px}ytd-rich-item-renderer{display:block;height:180px;padding:8px}</style><input type="search"><main>${youtube ? '<div id="grid">' : "<ul>"}${rows}${youtube ? "</div>" : "</ul>"}</main>`;
const cdp = await page.createCDPSession();
await cdp.send("Performance.enable");
async function metrics() {
  return Object.fromEntries(
    (await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]),
  );
}
async function heap() {
  await cdp.send("HeapProfiler.collectGarbage");
  return (await metrics()).JSHeapUsedSize;
}
async function phase(name, fn) {
  const before = await metrics();
  const revision = await page.evaluate(
    () => globalThis.__webVim?.inspect().revision || 0,
  );
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.start");
  const result = await fn();
  const { profile } = await cdp.send("Profiler.stop");
  await writeFile(`${out}/${name}.cpuprofile`, JSON.stringify(profile));
  const after = await metrics();
  const counts = new Map();
  for (const id of profile.samples || []) counts.set(id, (counts.get(id) || 0) + 1);
  const hot = profile.nodes
    .map((n) => ({
      function: n.callFrame.functionName || "(anonymous)",
      samples: counts.get(n.id) || 0,
      url: n.callFrame.url,
    }))
    .sort((a, b) => b.samples - a.samples)
    .slice(0, 12);
  return {
    taskMs: +(1000 * (after.TaskDuration - before.TaskDuration)).toFixed(2),
    scriptMs: +(1000 * (after.ScriptDuration - before.ScriptDuration)).toFixed(2),
    layoutMs: +(1000 * (after.LayoutDuration - before.LayoutDuration)).toFixed(2),
    reads:
      (await page.evaluate(() => globalThis.__webVim?.inspect().revision || 0)) -
      revision,
    ...result,
    hot,
  };
}
try {
  await page.setViewport({ width: 1280, height: 900 });
  await page.setRequestInterception(true);
  page.on("request", (r) =>
    r.respond({ status: 200, contentType: "text/html", body: html }),
  );
  await page.goto(youtube ? "https://www.youtube.com/" : "https://profile.web-vim.test/");
  await sleep(200);
  const baselineHeap = await heap();
  const startup = await phase("startup", () =>
    page.evaluate(script + "\n//# sourceURL=web-vim-profile.js"),
  );
  const loadedHeap = await heap();
  const idle = await phase("idle", () => sleep(2000));
  const churn = await phase("churn", async () => {
    await page.evaluate(() => {
      window.churnTimer = setInterval(
        () => document.querySelector(".status").classList.toggle("busy"),
        120,
      );
    });
    await sleep(2400);
    await page.evaluate(() => clearInterval(window.churnTimer));
    await sleep(150);
  });
  const navigation = await phase("navigation", async () => {
    const durations = [];
    for (let i = 0; i < 40; i++) {
      durations.push(
        await page.evaluate(() => {
          const start = performance.now();
          document.dispatchEvent(
            new KeyboardEvent("keydown", { key: "j", bubbles: true, cancelable: true }),
          );
          return performance.now() - start;
        }),
      );
      await sleep(20);
    }
    durations.sort((a, b) => a - b);
    return { handlerMedianMs: durations[20], handlerP95Ms: durations[38] };
  });
  // Rerender and reopen/close the picker repeatedly; collect only after quiescence.
  const retained = [];
  for (let i = 0; i < 20; i++) {
    await page.evaluate(() => {
      const main = document.querySelector("main");
      main.replaceWith(main.cloneNode(true));
    });
    await sleep(150);
    await page.keyboard.press(":");
    await page.keyboard.press("Escape");
    if (i === 4 || i === 19) retained.push(await heap());
  }
  const report = {
    fixture: `${youtube ? "YouTube grid" : "Generic list"}: 1000 items / 5000+ elements; 1280x900; 2s idle; 2.4s class mutations; 40 j presses`,
    startup,
    idle,
    churn,
    navigation,
    heap: {
      baselineBytes: baselineHeap,
      loadedBytes: loadedHeap,
      extensionDeltaBytes: loadedHeap - baselineHeap,
      after5Cycles: retained[0],
      after20Cycles: retained[1],
    },
  };
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} finally {
  await context.close();
  await browser.disconnect();
}
