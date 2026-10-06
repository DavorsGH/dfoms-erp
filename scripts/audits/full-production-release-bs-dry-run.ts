/**
 * Read-only production: BS check Jan–Dec 2026 BEFORE (origin/main code) vs AFTER (working tree).
 * Saves comparison + repair impact notes to scripts/audits/output/
 *
 * npx tsx scripts/audits/full-production-release-bs-dry-run.ts
 */
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT_DIR = resolve(process.cwd(), "scripts/audits/output");
const BEFORE_OUT = resolve(OUT_DIR, "bs-grid-before-origin-main.json");
const AFTER_OUT = resolve(OUT_DIR, "bs-grid-after-working-tree.json");
const COMPARE_OUT = resolve(OUT_DIR, "full-production-release-bs-dry-run.json");
const WORKTREE = resolve(process.cwd(), ".worktrees/origin-main-bs");
const TOL = 0.005;

type GridFile = {
  grid: Array<{
    tenant: string;
    tenantId: string;
    scope: string;
    maxAbsDiff?: number;
    error?: string;
    months?: Array<{ monthIndex: number; difference: number }>;
  }>;
};

function ensureOriginMainWorktree() {
  try {
    execSync(`git worktree add "${WORKTREE}" origin/main`, {
      cwd: process.cwd(),
      stdio: "pipe",
    });
    console.log(`Created worktree ${WORKTREE}`);
  } catch {
    console.log(`Using existing worktree ${WORKTREE}`);
  }
}

function runSnapshot(outPath: string, codeRoot: string) {
  execSync(
    `npx tsx scripts/audits/bs-grid-snapshot.ts --out "${outPath}" --code-root "${codeRoot}"`,
    {
      cwd: process.cwd(),
      stdio: "inherit",
      env: process.env,
    },
  );
}

function loadGrid(path: string): GridFile {
  return JSON.parse(readFileSync(path, "utf8")) as GridFile;
}

function compareGrids(before: GridFile, after: GridFile) {
  const afterByKey = new Map(
    after.grid.map((row) => [`${row.tenantId}:${row.scope}`, row]),
  );
  const comparison: Array<Record<string, unknown>> = [];
  let anyScopeWorse = false;

  for (const b of before.grid) {
    const key = `${b.tenantId}:${b.scope}`;
    const a = afterByKey.get(key);
    if (!a) {
      comparison.push({ ...b, status: "missing-after" });
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
    const beforeMax = b.maxAbsDiff ?? 0;
    const afterMax = a.maxAbsDiff ?? 0;
    const worse = afterMax > beforeMax + TOL;
    if (worse) anyScopeWorse = true;
    comparison.push({
      tenant: b.tenant,
      tenantId: b.tenantId,
      scope: b.scope,
      beforeMaxAbs: beforeMax,
      afterMaxAbs: afterMax,
      worse,
      before: b.months,
      after: a.months,
    });
  }

  return { comparison, anyScopeWorse };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  ensureOriginMainWorktree();

  console.log("\n=== BEFORE: origin/main code + production data ===");
  runSnapshot(BEFORE_OUT, WORKTREE);

  console.log("\n=== AFTER: working tree code + production data ===");
  runSnapshot(AFTER_OUT, process.cwd());

  const before = loadGrid(BEFORE_OUT);
  const after = loadGrid(AFTER_OUT);
  const { comparison, anyScopeWorse } = compareGrids(before, after);

  const payload = {
    generatedAt: new Date().toISOString(),
    fy: 2026,
    tolerance: TOL,
    beforePath: BEFORE_OUT,
    afterPath: AFTER_OUT,
    anyScopeWorse,
    comparison,
    repairScriptsReadOnlyImpact: {
      note: "Per-tenant BS deltas from data repairs require apply on staging; production remains read-only here.",
      repairs: [
        {
          id: "365_repair_links",
          path: "scripts/repairs/repair_stock_adjustment_register_links.sql",
          dependsOn: ["365_inventory_stock_adjustment_balancing.sql"],
        },
        {
          id: "367_wac_repair",
          path: "scripts/repairs/repair_recompute_fp_balance_wac_proposed.sql",
          dependsOn: ["367_finished_product_wac_restock_guard.sql"],
        },
        {
          id: "370_wac_recompute",
          path: "scripts/370_inventory_bu_wac_hygiene.sql",
          dependsOn: ["367_finished_product_wac_restock_guard.sql"],
          applyBlocked: "Do not apply 370 until approved",
        },
        {
          id: "371_zero_cogs",
          path: "scripts/371_zero_cogs_historical_repair.sql",
          dependsOn: ["369_create_product_sale_bu_scoped_cogs.sql", "370_inventory_bu_wac_hygiene.sql"],
        },
      ],
    },
  };

  writeFileSync(COMPARE_OUT, JSON.stringify(payload, null, 2));
  console.log(`\nanyScopeWorse=${anyScopeWorse}`);
  console.log(`Wrote ${COMPARE_OUT}`);
  if (anyScopeWorse) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
