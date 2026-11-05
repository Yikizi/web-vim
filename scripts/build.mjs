import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const pkg = JSON.parse(await readFile(root + "package.json", "utf8"));
await mkdir(root + "dist/extension", { recursive: true });
await build({
  entryPoints: [root + "src/index.js"],
  bundle: true,
  format: "iife",
  target: "chrome120",
  outfile: root + "dist/extension/content.js",
  sourcemap: true,
});
await writeFile(
  root + "dist/extension/manifest.json",
  JSON.stringify(
    {
      manifest_version: 3,
      name: "Web Vim",
      version: pkg.version,
      description: "Semantic keyboard navigation with validated site adapters.",
      permissions: ["clipboardWrite"],
      content_scripts: [
        {
          matches: ["http://*/*", "https://*/*"],
          js: ["content.js"],
          run_at: "document_idle",
        },
      ],
    },
    null,
    2,
  ) + "\n",
);
console.log("Built dist/extension");
