import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const TOL = 0.005;
const before = JSON.parse(
  readFileSync(
    resolve("scripts/audits/output/bs-grid-before-origin-main.json"),
    "utf8",
  ),
) as { grid: Array<Record<string, unknown>> };
const after = JSON.parse(
  readFileSync(
    resolve("scripts/audits/output/bs-grid-after-working-tree.json"),
    "utf8",
  ),
) as { grid: Array<Record<string, unknown>> };

const afterBy = new Map(
  after.grid.map((r) => [`${r.tenantId}:${r.scope}`, r]),
);
let anyScopeWorse = false;
const comparison: Array<Record<string, unknown>> = [];

for (const b of before.grid) {
  const key = `${b.tenantId}:${b.scope}`;
  const a = afterBy.get(key);
  if (!a) {
    comparison.push({ tenant: b.tenant, scope: b.scope, status: "missing-after" });
    continue;
  }
  if (b.error || a.error) {
    comparison.push({
      tenant: b.tenant,
      scope: b.scope,
      beforeError: b.error,
      afterError: a.error,
    });
    continue;
  }
  const beforeMax = Number(b.maxAbsDiff) || 0;
  const afterMax = Number(a.maxAbsDiff) || 0;
  const worse = afterMax > beforeMax + TOL;
  if (worse) anyScopeWorse = true;
  comparison.push({
    tenant: b.tenant,
    tenantId: b.tenantId,
    scope: b.scope,
    beforeMaxAbs: beforeMax,
    afterMaxAbs: afterMax,
    worse,
  });
}

writeFileSync(
  resolve("scripts/audits/output/full-production-release-bs-dry-run.json"),
  JSON.stringify({ anyScopeWorse, comparison }, null, 2),
);
console.log("anyScopeWorse", anyScopeWorse);
console.log(
  "worse scopes:",
  comparison.filter((c) => c.worse).map((c) => `${c.tenant} | ${c.scope}`),
);
