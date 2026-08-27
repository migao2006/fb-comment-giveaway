import { build, context } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
const watch = process.argv.includes("--watch");

const options = {
  entryPoints: [resolve(root, "src/bookmarklet.ts")],
  bundle: true,
  minify: true,
  format: "iife",
  target: ["safari15", "firefox115"],
  outfile: resolve(dist, "bookmarklet.js"),
  legalComments: "none",
  charset: "utf8"
};

async function prepare() {
  await rm(dist, { recursive: true, force: true });
  await mkdir(resolve(dist, "assets"), { recursive: true });
  await cp(resolve(root, "site"), dist, { recursive: true });
}

async function finalize() {
  const source = (await readFile(resolve(dist, "bookmarklet.js"), "utf8")).trim();
  const bookmarklet = `javascript:${source}`;
  const assetVersion = createHash("sha256").update(bookmarklet).digest("hex").slice(0, 12);
  await writeFile(resolve(dist, "bookmarklet.txt"), `${bookmarklet}\n`, "utf8");
  await writeFile(
    resolve(dist, "assets/install.js"),
    `globalThis.FB_COMMENT_GIVEAWAY_BOOKMARKLET=${JSON.stringify(bookmarklet)};\n`,
    "utf8"
  );
  const indexPath = resolve(dist, "index.html");
  const index = await readFile(indexPath, "utf8");
  await writeFile(
    indexPath,
    index
      .replace("./assets/install.js", `./assets/install.js?v=${assetVersion}`)
      .replace("./bookmarklet.txt", `./bookmarklet.txt?v=${assetVersion}`),
    "utf8"
  );
}

await prepare();

if (watch) {
  const ctx = await context({
    ...options,
    plugins: [{
      name: "refresh-installer",
      setup(plugin) {
        plugin.onEnd(async (result) => {
          if (result.errors.length === 0) await finalize();
        });
      }
    }]
  });
  await ctx.watch();
  console.log("Watching bookmarklet sources…");
} else {
  await build(options);
  await finalize();
  const bytes = Buffer.byteLength(await readFile(resolve(dist, "bookmarklet.txt"), "utf8"));
  console.log(`Built dist/ (${bytes.toLocaleString()} byte bookmarklet)`);
}
