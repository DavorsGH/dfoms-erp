#!/usr/bin/env node
/**
 * Deep-compare two dashboard snapshot JSON files (exact equality).
 * metadata.generated_at is ignored (changes every capture).
 * Usage: node scripts/diff-dashboard-snapshots.mjs before.json after.json
 */
import { readFileSync } from "node:fs";

const COMPARABLE_METADATA_KEYS = [
  "tenant_id",
  "active_business_unit_id",
  "view_all_business_units",
  "month",
];

function usage() {
  console.error(
    "Usage: node scripts/diff-dashboard-snapshots.mjs <before.json> <after.json>",
  );
}

function loadJson(path) {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw);
}

function metadataField(doc, key) {
  const value = doc?.metadata?.[key];
  if (value === undefined) {
    return "(missing)";
  }
  return value;
}

function formatMetaCell(value) {
  if (value === "(missing)") {
    return value;
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  return String(value);
}

function printMetadataSideBySide(beforePath, afterPath, before, after) {
  const labelWidth = Math.max(beforePath.length, afterPath.length, 12);
  console.log("Snapshot metadata (comparison context):");
  console.log(
    `${"".padEnd(28)} ${beforePath.padEnd(labelWidth)}  ${afterPath}`,
  );
  for (const key of COMPARABLE_METADATA_KEYS) {
    const left = metadataField(before, key);
    const right = metadataField(after, key);
    console.log(
      `${key.padEnd(28)} ${formatMetaCell(left).padEnd(labelWidth)}  ${formatMetaCell(right)}`,
    );
  }
  console.log("");
}

function findMetadataMismatches(before, after) {
  const mismatches = [];
  for (const key of COMPARABLE_METADATA_KEYS) {
    const left = before?.metadata?.[key];
    const right = after?.metadata?.[key];
    if (!Object.is(left, right)) {
      mismatches.push({ key, before: left, after: right });
    }
  }
  return mismatches;
}

function cloneWithoutGeneratedAt(doc) {
  const copy = structuredClone(doc);
  if (copy?.metadata && typeof copy.metadata === "object") {
    delete copy.metadata.generated_at;
  }
  return copy;
}

function formatValue(value) {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  return String(value);
}

function diffValues(path, left, right, out) {
  if (Object.is(left, right)) {
    return;
  }

  const leftType = left === null ? "null" : typeof left;
  const rightType = right === null ? "null" : typeof right;

  if (leftType !== rightType) {
    out.push({
      path,
      before: left,
      after: right,
    });
    return;
  }

  if (Array.isArray(left)) {
    if (!Array.isArray(right) || left.length !== right.length) {
      out.push({ path, before: left, after: right });
      return;
    }
    for (let index = 0; index < left.length; index += 1) {
      diffValues(`${path}[${index}]`, left[index], right[index], out);
    }
    return;
  }

  if (leftType === "object") {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    if (leftKeys.join("\0") !== rightKeys.join("\0")) {
      out.push({ path, before: left, after: right });
      return;
    }
    for (const key of leftKeys) {
      diffValues(`${path}.${key}`, left[key], right[key], out);
    }
    return;
  }

  out.push({ path, before: left, after: right });
}

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) {
  usage();
  process.exit(2);
}

let before;
let after;
try {
  before = loadJson(beforePath);
  after = loadJson(afterPath);
} catch (error) {
  console.error(
    "Failed to read or parse JSON:",
    error instanceof Error ? error.message : error,
  );
  process.exit(2);
}

printMetadataSideBySide(beforePath, afterPath, before, after);

const metadataMismatches = findMetadataMismatches(before, after);
if (metadataMismatches.length > 0) {
  console.error(
    "Snapshots are not comparable: tenant_id, active_business_unit_id, view_all_business_units, and month must match.",
  );
  for (const { key, before: left, after: right } of metadataMismatches) {
    console.error(
      `  ${key}: before=${formatValue(left)} after=${formatValue(right)}`,
    );
  }
  process.exit(1);
}

const beforeForDiff = cloneWithoutGeneratedAt(before);
const afterForDiff = cloneWithoutGeneratedAt(after);

const differences = [];
diffValues("$", beforeForDiff, afterForDiff, differences);

if (differences.length === 0) {
  console.log("No differences (metadata.generated_at ignored).");
  process.exit(0);
}

console.log(`Found ${differences.length} difference(s):\n`);
for (const entry of differences) {
  console.log(entry.path);
  console.log(`  before: ${formatValue(entry.before)}`);
  console.log(`  after:  ${formatValue(entry.after)}`);
  console.log("");
}

process.exit(1);
