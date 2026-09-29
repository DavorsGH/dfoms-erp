/**
 * Next.js 16 registers proxy.ts as /_middleware with runtime nodejs but does not
 * copy export const config.regions into functions-config-manifest.json.
 * Vercel uses that manifest for Node middleware region pinning.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const manifestPath = join(root, ".next", "server", "functions-config-manifest.json");
const vercelPath = join(root, "vercel.json");

function warn(message) {
  console.warn(`[patch-middleware-regions] WARNING: ${message}`);
  process.exit(0);
}

let regions;
try {
  if (!existsSync(vercelPath)) {
    warn("vercel.json not found; skipping middleware region patch.");
  }
  const vercel = JSON.parse(readFileSync(vercelPath, "utf8"));
  if (!Array.isArray(vercel.regions) || vercel.regions.length === 0) {
    warn('vercel.json has no "regions" array; skipping middleware region patch.');
  }
  regions = vercel.regions;
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  warn(`could not read or parse vercel.json (${detail}); skipping middleware region patch.`);
}

if (!existsSync(manifestPath)) {
  warn(
    ".next/server/functions-config-manifest.json not found; skipping middleware region patch.",
  );
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  warn(
    `could not parse functions-config-manifest.json (${detail}); skipping middleware region patch.`,
  );
}

const entry = manifest.functions?.["/_middleware"];
if (!entry) {
  warn('functions-config-manifest.json has no "/_middleware" entry; skipping middleware region patch.');
}

if (entry.runtime !== "nodejs") {
  console.warn(
    `[patch-middleware-regions] WARNING: unexpected /_middleware runtime "${entry.runtime}" (expected nodejs); applying regions anyway.`,
  );
}

entry.regions = regions;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `patch-middleware-function-regions: set /_middleware regions to ${regions.join(",")}`,
);
