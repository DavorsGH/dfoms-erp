import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "app");

const loadingTextReplacements = [
  ['{loading ? "Saving…"', '{loading ? <LoadingLabel>Saving…</LoadingLabel>'],
  ['{loading ? "Adding…"', '{loading ? <LoadingLabel>Adding…</LoadingLabel>'],
  ['{loading ? "Creating…"', '{loading ? <LoadingLabel>Creating…</LoadingLabel>'],
  ['{loading ? "Updating…"', '{loading ? <LoadingLabel>Updating…</LoadingLabel>'],
  ['{loading ? "Signing in…"', '{loading ? <LoadingLabel>Signing in…</LoadingLabel>'],
  ['{photoUploading ? "Uploading…"', '{photoUploading ? <LoadingLabel>Uploading…</LoadingLabel>'],
  ['{loadingConfig ? "Saving…"', '{loadingConfig ? <LoadingLabel>Saving…</LoadingLabel>'],
  ['? "Saving…"', '? <LoadingLabel>Saving…</LoadingLabel>'],
];

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
    } else if (entry.name.endsWith(".tsx")) {
      files.push(fullPath);
    }
  }

  return files;
}

function ensureImport(source) {
  const importLine =
    'import { LoadingLabel } from "@/components/company-logo-loader";\n';

  if (source.includes('from "@/components/company-logo-loader"')) {
    return source;
  }

  if (source.startsWith('"use client"')) {
    const newlineIndex = source.indexOf("\n");
    return `${source.slice(0, newlineIndex + 1)}\n${importLine}${source.slice(newlineIndex + 1)}`;
  }

  return `${importLine}${source}`;
}

let updatedCount = 0;

for (const filePath of walk(root)) {
  let source = fs.readFileSync(filePath, "utf8");
  let changed = false;

  for (const [from, to] of loadingTextReplacements) {
    if (source.includes(from)) {
      source = source.split(from).join(to);
      changed = true;
    }
  }

  if (changed) {
    source = ensureImport(source);
    fs.writeFileSync(filePath, source);
    updatedCount += 1;
    console.log(`Updated ${path.relative(root, filePath)}`);
  }
}

console.log(`Done. Updated ${updatedCount} files.`);
