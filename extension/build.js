// Optional build script using esbuild.
//
// The extension works WITHOUT this build step — content scripts inline their constants.
// Use this if you start refactoring and want shared/categories.js and shared/prompt.js
// to be properly imported everywhere without duplication.
//
// Usage:
//   npm install
//   npm run build       # one-shot build
//   npm run watch       # rebuild on file changes
//
// Output goes to dist/ — load THAT folder in Chrome, not extension/ directly.

const esbuild = require("esbuild");
const path = require("path");
const fs = require("fs");

const watch = process.argv.includes("--watch");

const sharedBanner = `/* Built by esbuild — edit src/, not dist/ */`;

// Files to bundle (entry points that use imports)
const entryPoints = [
  { in: "background/service-worker.js", out: "background/service-worker" },
  { in: "content/scanner.js",           out: "content/scanner" },
  { in: "options/options.js",           out: "options/options" },
  { in: "popup/popup.js",               out: "popup/popup" }
];

// Files to copy as-is
const staticFiles = [
  "manifest.json",
  "options/options.html",
  "popup/popup.html",
  "icons/icon16.png",
  "icons/icon48.png",
  "icons/icon128.png"
];

async function build() {
  // Clean dist
  fs.rmSync("dist", { recursive: true, force: true });
  fs.mkdirSync("dist", { recursive: true });

  // Bundle JS
  await esbuild.build({
    entryPoints: entryPoints.map(e => e.in),
    bundle: true,
    outdir: "dist",
    format: "esm",
    target: "chrome120",
    banner: { js: sharedBanner },
    minify: false,  // Keep readable for debugging
    sourcemap: "inline"
  });

  // Copy static files
  for (const file of staticFiles) {
    const dest = path.join("dist", file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(file, dest);
  }

  console.log("Build complete → dist/");
}

if (watch) {
  esbuild.context({
    entryPoints: entryPoints.map(e => e.in),
    bundle: true,
    outdir: "dist",
    format: "esm",
    target: "chrome120"
  }).then(ctx => {
    ctx.watch();
    console.log("Watching for changes...");
  });
} else {
  build().catch(e => { console.error(e); process.exit(1); });
}
