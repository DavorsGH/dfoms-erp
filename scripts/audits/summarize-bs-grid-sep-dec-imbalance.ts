/**
 * Read bs-grid-after JSON: list tenant/scopes with material imbalance Sep–Dec 2026.
 * Material = any month !isBalanced OR |difference| >= 0.05
 *
 * npx tsx scripts/audits/summarize-bs-grid-sep-dec-imbalance.ts [path-to-grid.json]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const TOL = 0.05;
const SEP_DEC = [8, 9, 10, 11];

type GridFile = {
  grid: Array<{
    tenant: string;
    scope: string;
    months?: Array<{ monthIndex: number; difference: number; isBalanced?: boolean }>;
  }>;
};

const path =
  process.argv[2] ??
  resolve(process.cwd(), "scripts/audits/output/bs-grid-after-working-tree.json");

const data = JSON.parse(readFileSync(path, "utf8")) as GridFile;

const material: Array<{
  tenant: string;
  scope: string;
  months: Array<{ monthIndex: number; difference: number; isBalanced: boolean }>;
}> = [];

for (const row of data.grid) {
  const hits = (row.months ?? []).filter((m) => {
    if (!SEP_DEC.includes(m.monthIndex)) return false;
    const abs = Math.abs(m.difference);
    const balanced = m.isBalanced ?? abs < TOL;
    return !balanced || abs >= TOL;
  });
  if (hits.length) {
    material.push({
      tenant: row.tenant,
      scope: row.scope,
      months: hits.map((m) => ({
        monthIndex: m.monthIndex,
        difference: m.difference,
        isBalanced: m.isBalanced ?? Math.abs(m.difference) < TOL,
      })),
    });
  }
}

console.log(`Grid: ${path}`);
console.log(`Material imbalance Sep–Dec 2026 (|diff| >= ${TOL} or !isBalanced): ${material.length} scopes\n`);
for (const row of material) {
  console.log(`${row.tenant} / ${row.scope}`);
  for (const m of row.months) {
    console.log(
      `  month ${m.monthIndex + 1}: diff=${m.difference} isBalanced=${m.isBalanced}`,
    );
  }
}
