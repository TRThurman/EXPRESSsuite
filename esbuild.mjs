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
  const assets = [
    ["node_modules/@asciidoctor/core/dist/browser/asciidoctor.min.js", "out/webview/vendor/asciidoctor.min.js"],
    ["node_modules/@asciidoctor/core/dist/css/asciidoctor.css", "out/webview/vendor/asciidoctor.css"],
    ["node_modules/@plurimath/plurimath/dist/index.js", "out/webview/vendor/plurimath.js"],
    ["node_modules/@plurimath/plurimath/dist/plurimath-opal.js", "out/webview/vendor/plurimath-opal.js"],
    ["node_modules/dompurify/dist/purify.min.js", "out/webview/vendor/dompurify.min.js"],
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

// Extension host bundles (Node CJS, vscode external)
const hostCtx = await esbuild.context({
  entryPoints: ["src/extension/main.ts", "src/language/main.ts"],
  outdir: "out",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  target: "ES2017",
  format: "cjs",
  loader: { ".ts": "ts" },
  external: ["vscode"],
  platform: "node",
  sourcemap: !minify,
  minify,
  plugins: [watchPlugin],
});

// Webview controllers (browser ESM, no externals)
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
