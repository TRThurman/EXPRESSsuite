//@ts-check
import * as esbuild from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const watch = process.argv.includes("--watch");
const minify = process.argv.includes("--minify");

const success = watch ? "Watch build succeeded" : "Build succeeded";

function getTime() {
  const date = new Date();
  return `[${`${padZeroes(date.getHours())}:${padZeroes(date.getMinutes())}:${padZeroes(date.getSeconds())}`}] `;
}

function padZeroes(i) {
  return i.toString().padStart(2, "0");
}

async function copyAsset(src, dst) {
  await mkdir(dirname(dst), { recursive: true });
  await copyFile(src, dst);
}

async function copyVendorAssets() {
  // Plurimath/Opal and Asciidoctor.js need to be loaded as native ESM in the
  // webview; bundling via esbuild breaks Opal's runtime module loader (TypeError
  // "r2 is not a function" inside Opal.modules.parser). Webview controllers
  // load these via dynamic import() against the copied vendor URIs at runtime.
  const assets = [
    ["node_modules/@asciidoctor/core/dist/browser/asciidoctor.js", "out/webview/vendor/asciidoctor.js"],
    ["node_modules/@asciidoctor/core/dist/css/asciidoctor.css", "out/webview/vendor/asciidoctor.css"],
    ["node_modules/@plurimath/plurimath/dist/index.js", "out/webview/vendor/plurimath/index.js"],
    ["node_modules/@plurimath/plurimath/dist/plurimath-opal.js", "out/webview/vendor/plurimath/plurimath-opal.js"],
    ["node_modules/dompurify/dist/purify.es.mjs", "out/webview/vendor/dompurify.mjs"],
  ];
  for (const [src, dst] of assets) {
    await copyAsset(src, dst);
  }
  console.log(getTime() + `Copied ${assets.length} vendor assets to out/webview/vendor/`);
}

const watchPlugin = {
  name: "watch-plugin",
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length === 0) {
        console.log(getTime() + success);
      }
    });
  },
};

// Extension host bundles (Node CJS, vscode + math renderers external).
// - mathjax v4 uses runtime path resolution for dynamic component loading;
//   bundling breaks that.
// - @plurimath/plurimath ships an Opal-compiled blob that bloats the bundle
//   from <1 MB to >4 MB and slows extension load; better to load from
//   node_modules at runtime.
// Both are loaded from node_modules at runtime — works in dev host and in
// packaged .vsix because vsce includes node_modules of declared dependencies.
const hostCtx = await esbuild.context({
  entryPoints: [
    "src/extension/main.ts",
    "src/language/main.ts",
    "src/extension/workers/plurimath-worker.ts",
  ],
  outdir: "out",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  target: "ES2017",
  format: "cjs",
  loader: { ".ts": "ts" },
  external: ["vscode", "mathjax", "@plurimath/plurimath"],
  platform: "node",
  sourcemap: !minify,
  minify,
  plugins: [watchPlugin],
});

// Webview controllers (browser ESM). Vendors are NOT bundled — they're loaded
// via dynamic import() against webview-vendor URIs at runtime. esbuild leaves
// runtime-string import() expressions as-is, so the browser fetches the ESM.
const webviewCtx = await esbuild.context({
  entryPoints: [
    "src/webview/description-preview.ts",
    "src/webview/expressg-preview.ts",
    "src/webview/math-playground.ts",
  ],
  outdir: "out/webview",
  bundle: true,
  target: "ES2020",
  format: "esm",
  loader: { ".ts": "ts" },
  platform: "browser",
  sourcemap: !minify,
  minify,
  plugins: [watchPlugin],
});

await copyVendorAssets();

if (watch) {
  await Promise.all([hostCtx.watch(), webviewCtx.watch()]);
} else {
  await Promise.all([hostCtx.rebuild(), webviewCtx.rebuild()]);
  hostCtx.dispose();
  webviewCtx.dispose();
}
