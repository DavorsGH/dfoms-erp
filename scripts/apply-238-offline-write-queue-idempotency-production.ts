/**
 * Apply scripts/238_offline_write_queue_idempotency.sql to PRODUCTION.
 *
 * Pre-check: refuse if duplicate (tenant_id, staff_id, date) groups exist.
 * Post-check: verify constraint + client_op_id column/index.
 * Smoke: throwaway online-style attendance + expense insert/select/delete.
 *
 *   npx tsx scripts/apply-238-offline-write-queue-idempotency-production.ts
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadEnvForce } from "./lib/env";
import { connectPg } from "./lib/pg-connect";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const DAVORS_TENANT_ID = "00000001-0000-4000-8000-000000000001";

async function main() {
  const { client, envFile, candidateIndex } = await connectPg({
    requiredProjectRef: PRODUCTION_REF,
    envFiles: [".env.local.backup", ".env.local"],
  });
  console.log(`Connected via ${envFile} (candidate ${candidateIndex})`);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url.includes(PRODUCTION_REF)) {
    throw new Error(`Refusing: expected production ${PRODUCTION_REF}, got ${url}`);
  }

  try {
    // --- Fresh duplicate pre-check ---
    const dup = await client.query(`
      SELECT COUNT(*)::int AS groups
      FROM (
        SELECT 1
        FROM public.attendance_register
        GROUP BY tenant_id, staff_id, date
        HAVING COUNT(*) > 1
      ) d
    `);
    const groups = Number(dup.rows[0]?.groups ?? 0);
    console.log(`Pre-check duplicate (tenant_id, staff_id, date) groups: ${groups}`);
    if (groups > 0) {
      throw new Error(
        `Refusing migration: ${groups} duplicate (tenant_id, staff_id, date) group(s) exist.`,
      );
    }
    console.log("Pre-check PASS: no attendance duplicates for unique key.");

    const sql = readFileSync(
      resolve(process.cwd(), "scripts/238_offline_write_queue_idempotency.sql"),
      "utf8",
    );
    console.log("Applying 238_offline_write_queue_idempotency.sql on PRODUCTION …");
    await client.query(sql);

    const attendance = await client.query(`
      SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'public.attendance_register'::regclass
        AND conname = 'attendance_register_tenant_staff_date_key'
    `);
    if (!attendance.rows[0]) {
      throw new Error("Missing attendance_register_tenant_staff_date_key");
    }
    console.log("PASS attendance unique:", attendance.rows[0].def);

    const expenseCol = await client.query(`
      SELECT data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'expense_register'
        AND column_name = 'client_op_id'
    `);
    if (!expenseCol.rows[0]) {
      throw new Error("Missing expense_register.client_op_id");
    }
    console.log("PASS expense client_op_id column:", expenseCol.rows[0]);

    const expenseIdx = await client.query(`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'expense_register_client_op_id_key'
    `);
    if (!expenseIdx.rows[0]) {
      throw new Error("Missing expense_register_client_op_id_key");
    }
    console.log("PASS expense client_op_id unique index:", expenseIdx.rows[0].indexdef);
  } finally {
    await client.end();
  }

  // --- Online-style create smoke (service role, no client_op_id on expense) ---
  // Reload env for Supabase keys (connectPg already loaded one file).
  loadEnvForce(resolve(process.cwd(), envFile));
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!supabaseUrl.includes(PRODUCTION_REF) || !serviceKey) {
    throw new Error("Missing production service role for smoke test.");
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: employee, error: empErr } = await admin
    .from("employees")
    .select("staff_id")
    .eq("tenant_id", DAVORS_TENANT_ID)
    .limit(1)
    .maybeSingle();
  if (empErr || !employee?.staff_id) {
    throw new Error(`Smoke: need an employee: ${empErr?.message ?? "none"}`);
  }

  const stamp = Date.now();
  const attendanceId = randomUUID();
  // Use a far-future date unlikely to collide with real ops
  const smokeDate = "2099-01-02";

  const { error: attInsErr } = await admin.from("attendance_register").insert({
    id: attendanceId,
    tenant_id: DAVORS_TENANT_ID,
    date: smokeDate,
    staff_id: employee.staff_id,
    employment_type: null,
    project_assignment: null,
    clock_in: "08:00",
    clock_out: "17:00",
    hours_worked: 8,
    overtime_hours: 0,
    attendance_status: "Present",
  });
  if (attInsErr) {
    throw new Error(`Smoke attendance insert FAILED: ${attInsErr.message}`);
  }

  const { data: attRead, error: attReadErr } = await admin
    .from("attendance_register")
    .select("id, staff_id, date, attendance_status")
    .eq("id", attendanceId)
    .maybeSingle();
  if (attReadErr || !attRead) {
    throw new Error(`Smoke attendance read FAILED: ${attReadErr?.message ?? "missing"}`);
  }
  console.log("PASS online-style attendance insert+read:", attRead.id);

  // Unique constraint smoke: second insert same tenant/staff/date must fail
  const { error: attDupErr } = await admin.from("attendance_register").insert({
    id: randomUUID(),
    tenant_id: DAVORS_TENANT_ID,
    date: smokeDate,
    staff_id: employee.staff_id,
    attendance_status: "Present",
  });
  if (!attDupErr) {
    await admin.from("attendance_register").delete().eq("date", smokeDate).eq(
      "staff_id",
      employee.staff_id,
    );
    throw new Error("Smoke: expected unique violation on duplicate attendance, got success");
  }
  console.log("PASS unique constraint rejects duplicate attendance:", attDupErr.code ?? attDupErr.message);

  await admin.from("attendance_register").delete().eq("id", attendanceId);

  const expenseId = randomUUID();
  const receiptNo = `SMOKE-238-${stamp}`;
  const { error: expInsErr } = await admin.from("expense_register").insert({
    id: expenseId,
    tenant_id: DAVORS_TENANT_ID,
    date: smokeDate,
    expense_category: "Other",
    sub_category: null,
    description: "238 production smoke — delete me",
    vendor: "Smoke Test",
    price: 1,
    quantity: 1,
    amount: 1,
    payment_method: "Cash",
    approved_by: null,
    receipt_no: receiptNo,
    payment_status: "Paid",
    notes: "temporary 238 apply smoke",
    // intentionally omit client_op_id — mirrors normal online create
  });
  if (expInsErr) {
    throw new Error(`Smoke expense insert FAILED: ${expInsErr.message}`);
  }

  const { data: expRead, error: expReadErr } = await admin
    .from("expense_register")
    .select("id, receipt_no, client_op_id, amount")
    .eq("id", expenseId)
    .maybeSingle();
  if (expReadErr || !expRead) {
    throw new Error(`Smoke expense read FAILED: ${expReadErr?.message ?? "missing"}`);
  }
  if (expRead.client_op_id != null) {
    throw new Error("Smoke: online-style expense unexpectedly set client_op_id");
  }
  console.log("PASS online-style expense insert+read (client_op_id null):", expRead.id);

  await admin.from("expense_register").delete().eq("id", expenseId);
  console.log("PASS smoke rows cleaned up");
  console.log("DONE: 238 applied and verified on production");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
