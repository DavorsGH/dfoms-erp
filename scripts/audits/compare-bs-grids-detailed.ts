import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const TOL = 0.005;
const before = JSON.parse(
  readFileSync(resolve("scripts/audits/output/bs-grid-before-origin-main.json"), "utf8"),
) as {
  grid: Array<{
    tenant: string;
    tenantId: string;
    scope: string;
    maxAbsDiff?: number;
    months?: Array<{ monthIndex: number; difference: number; isBalanced: boolean }>;
    error?: string;
  }>;
};
const after = JSON.parse(
  readFileSync(resolve("scripts/audits/output/bs-grid-after-working-tree.json"), "utf8"),
) as typeof before;

const afterBy = new Map(after.grid.map((r) => [`${r.tenantId}:${r.scope}`, r]));
let anyScopeWorse = false;
const comparison: Array<Record<string, unknown>> = [];
const monthChanges: Array<Record<string, unknown>> = [];

for (const b of before.grid) {
  const key = `${b.tenantId}:${b.scope}`;
  const a = afterBy.get(key);
  if (!a || b.error || a.error) {
    comparison.push({
      tenant: b.tenant,
      scope: b.scope,
      status: "error-or-missing",
      beforeError: b.error,
      afterError: a?.error,
    });
    continue;
  }
  const beforeMax = Number(b.maxAbsDiff) || 0;
  const afterMax = Number(a.maxAbsDiff) || 0;
  const worse = afterMax > beforeMax + TOL;
  if (worse) anyScopeWorse = true;

  comparison.push({
    tenant: b.tenant,
    scope: b.scope,
    beforeMaxAbs: beforeMax,
    afterMaxAbs: afterMax,
    worse,
  });

  for (const bm of b.months ?? []) {
    const am = (a.months ?? []).find((m) => m.monthIndex === bm.monthIndex);
    if (!am) continue;
    const delta = Math.round((am.difference - bm.difference) * 100) / 100;
    if (Math.abs(delta) >= TOL || bm.isBalanced !== am.isBalanced) {
      monthChanges.push({
        tenant: b.tenant,
        scope: b.scope,
        monthIndex: bm.monthIndex,
        beforeDiff: bm.difference,
        afterDiff: am.difference,
        delta,
        beforeBalanced: bm.isBalanced,
        afterBalanced: am.isBalanced,
      });
    }
  }
}

writeFileSync(
  resolve("scripts/audits/output/full-production-release-bs-dry-run.json"),
  JSON.stringify({ anyScopeWorse, comparison, monthChanges }, null, 2),
);
console.log("anyScopeWorse", anyScopeWorse);
console.log(
  "worse scopes:",
  comparison.filter((c) => c.worse).map((c) => `${c.tenant} | ${c.scope}`),
);
console.log("month-level changes:", monthChanges.length);
for (const row of monthChanges.slice(0, 40)) {
  console.log(JSON.stringify(row));
}
