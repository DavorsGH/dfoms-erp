import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "app");

const replacements = [
  ["{loading ? <LoadingLabel>Saving…</LoadingLabel>", '{loading ? "Saving…"'],
  ["{loading ? <LoadingLabel>Adding…</LoadingLabel>", '{loading ? "Adding…"'],
  ["{loading ? <LoadingLabel>Creating…</LoadingLabel>", '{loading ? "Creating…"'],
  ["{loading ? <LoadingLabel>Updating…</LoadingLabel>", '{loading ? "Updating…"'],
  ["{loading ? <LoadingLabel>Signing in…</LoadingLabel>", '{loading ? "Signing in…"'],
  [
    '{photoUploading ? <LoadingLabel>Uploading…</LoadingLabel>',
    '{photoUploading ? "Uploading…"',
  ],
  [
    "{loadingConfig ? <LoadingLabel>Saving…</LoadingLabel>",
    '{loadingConfig ? "Saving…"',
  ],
  ["? <LoadingLabel>Saving…</LoadingLabel>", '? "Saving…"'],
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

function stripImport(source) {
  return source
    .replace(
      /^import \{ LoadingLabel \} from "@\/components\/company-logo-loader";\r?\n\r?\n/m,
      "",
    )
    .replace(
      /^import \{ LoadingLabel \} from "@\/components\/company-logo-loader";\r?\n/m,
      "",
    );
}

let updatedCount = 0;

for (const filePath of walk(root)) {
  let source = fs.readFileSync(filePath, "utf8");
  if (!source.includes("LoadingLabel")) {
    continue;
  }

  let changed = false;

  for (const [from, to] of replacements) {
    if (source.includes(from)) {
      source = source.split(from).join(to);
      changed = true;
    }
  }

  if (changed) {
    source = stripImport(source);
    fs.writeFileSync(filePath, source);
    updatedCount += 1;
    console.log(`Updated ${path.relative(root, filePath)}`);
  }
}

console.log(`Done. Updated ${updatedCount} files.`);
