#!/usr/bin/env node
/**
 * Build the static Cloudflare Pages output.
 *
 * public/ (including the question data) is copied to dist/. Cloudflare Pages Functions stay
 * in functions/ at the project root; both Git integration and Wrangler pick
 * them up from there.
 */
import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");
const distDir = path.join(root, "dist");
const headersFile = path.join(root, "cloudflare", "_headers");

async function countFiles(directory) {
  let count = 0;
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) count += await countFiles(path.join(directory, entry.name));
    else count += 1;
  }
  return count;
}

async function main() {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });

  await cp(publicDir, distDir, {
    recursive: true,
    filter: (source) => !source.endsWith(".DS_Store"),
  });
  await cp(headersFile, path.join(distDir, "_headers"));

  const files = await countFiles(distDir);
  const info = await stat(distDir);
  console.log(`Cloudflare build complete: ${distDir}`);
  console.log(`  files: ${files}`);
  console.log(`  modified: ${info.mtime.toISOString()}`);
  console.log("  functions: ./functions/api/chat.js, ./functions/api/health.js");
  console.log("  build output: ./dist");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
