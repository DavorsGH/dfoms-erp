/**
 * Staging tests for contract/project deactivate + soft-archive (script 242).
 *
 *   npx tsx scripts/test-242-projects-is-archived-staging.ts --env-file .env.staging.local
 */
import { createClient } from "@supabase/supabase-js";
import { assert, loadEnvFromArgv } from "./lib/env";
import { connectPg } from "./lib/pg-connect";
import {
  getProjectDeleteErrorMessage,
  PROJECT_DELETE_BLOCKED_BY_EMPLOYEES_MESSAGE,
} from "../utils/project-delete-errors";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const DAVORS = "00000001-0000-4000-8000-000000000001";

type Check = { step: string; pass: boolean; detail: string };
const checks: Check[] = [];

function record(step: string, pass: boolean, detail: string) {
  checks.push({ step, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${step}: ${detail}`);
}

async function main() {
  loadEnvFromArgv(process.argv.slice(2));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  assert(url.includes(STAGING_REF), "staging Supabase required");
  assert(key, "SUPABASE_SERVICE_ROLE_KEY required");

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { client: db } = await connectPg({
    requiredProjectRef: STAGING_REF,
    envFiles: [".env.staging.local"],
  });

  const stamp = Date.now().toString(36).toUpperCase();
  const withEmpCode = `P242WE${stamp}`;
  const noEmpCode = `P242NE${stamp}`;
  const withEmpId = crypto.randomUUID();
  const noEmpId = crypto.randomUUID();
  let employeeId: string | null = null;

  try {
    const col = await db.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'is_archived'
    `);
    record("projects.is_archived exists", col.rows.length === 1, "column check");

    await db.query(
      `
      INSERT INTO projects (id, tenant_id, project_code, project_name, is_archived)
      VALUES
        ($1, $2, $3, $4, false),
        ($5, $2, $6, $7, false)
      `,
      [
        withEmpId,
        DAVORS,
        withEmpCode,
        `${withEmpCode} With Employees`,
        noEmpId,
        noEmpCode,
        `${noEmpCode} No Employees`,
      ],
    );

    employeeId = `E242${stamp}`;
    await db.query(
      `
      INSERT INTO employees (
        employee_id, tenant_id, staff_id, full_name, employment_type, employment_status, contract_project
      ) VALUES ($1, $2, $3, $4, 'Permanent', 'Active', $5)
      `,
      [employeeId, DAVORS, `S242${stamp}`, `Test Emp ${stamp}`, withEmpCode],
    );

    // Attempt hard-delete with employees → should fail with FK
    const { error: blockedDelete } = await admin
      .from("projects")
      .delete()
      .eq("id", withEmpId)
      .eq("tenant_id", DAVORS);

    record(
      "hard-delete with employees blocked by FK",
      Boolean(blockedDelete),
      blockedDelete?.message ?? "unexpected success",
    );
    record(
      "friendly FK message for employees constraint",
      getProjectDeleteErrorMessage(blockedDelete) ===
        PROJECT_DELETE_BLOCKED_BY_EMPLOYEES_MESSAGE,
      getProjectDeleteErrorMessage(blockedDelete),
    );

    // Deactivate instead
    const { error: archiveError } = await admin
      .from("projects")
      .update({ is_archived: true })
      .eq("id", withEmpId)
      .eq("tenant_id", DAVORS);
    record("deactivate succeeds", !archiveError, archiveError?.message ?? "ok");

    const archived = await db.query(
      `SELECT is_archived FROM projects WHERE id = $1`,
      [withEmpId],
    );
    record(
      "is_archived true after deactivate",
      archived.rows[0]?.is_archived === true,
      String(archived.rows[0]?.is_archived),
    );

    // Active-only lookup excludes archived
    const { data: activeOnly } = await admin
      .from("projects")
      .select("project_code")
      .eq("tenant_id", DAVORS)
      .eq("is_archived", false)
      .in("project_code", [withEmpCode, noEmpCode]);
    const activeCodes = (activeOnly ?? []).map((r) => r.project_code);
    record(
      "archived hidden from active dropdown query",
      !activeCodes.includes(withEmpCode) && activeCodes.includes(noEmpCode),
      JSON.stringify(activeCodes),
    );

    // Main list still includes archived
    const { data: allList } = await admin
      .from("projects")
      .select("project_code, is_archived")
      .eq("tenant_id", DAVORS)
      .in("project_code", [withEmpCode, noEmpCode]);
    record(
      "main list still includes deactivated project",
      (allList ?? []).some(
        (r) => r.project_code === withEmpCode && r.is_archived === true,
      ),
      JSON.stringify(allList),
    );

    // Reactivate
    const { error: reactivateError } = await admin
      .from("projects")
      .update({ is_archived: false })
      .eq("id", withEmpId)
      .eq("tenant_id", DAVORS);
    record("reactivate succeeds", !reactivateError, reactivateError?.message ?? "ok");

    const { data: afterReactivate } = await admin
      .from("projects")
      .select("project_code")
      .eq("tenant_id", DAVORS)
      .eq("is_archived", false)
      .eq("project_code", withEmpCode);
    record(
      "reactivated appears in active dropdown query",
      (afterReactivate ?? []).length === 1,
      JSON.stringify(afterReactivate),
    );

    // Hard-delete with no employees succeeds
    const { error: freeDelete } = await admin
      .from("projects")
      .delete()
      .eq("id", noEmpId)
      .eq("tenant_id", DAVORS);
    record(
      "hard-delete with no employees succeeds",
      !freeDelete,
      freeDelete?.message ?? "deleted",
    );
    const gone = await db.query(`SELECT 1 FROM projects WHERE id = $1`, [noEmpId]);
    record("no-employee project removed", gone.rows.length === 0, `rows=${gone.rows.length}`);
  } finally {
    // Cleanup remaining seed
    if (employeeId) {
      await db.query(`DELETE FROM employees WHERE employee_id = $1`, [employeeId]);
    }
    await db.query(`DELETE FROM projects WHERE id = ANY($1::uuid[])`, [
      [withEmpId, noEmpId],
    ]);
    await db.end();
  }

  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
  if (failed.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
