/**
 * Caanta maternity leave: balances, submit, overlap, approve (authenticated).
 *
 * npx tsx scripts/staging-only/prove-maternity-caanta-as-user.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { maternityEndDateFromStart } from "../../app/dashboard/self-service/maternity-leave-form-utils";

config({ path: resolve(process.cwd(), ".env.staging.local") });

const CAANTA = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";
const APP_URL = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

async function sessionCookie(client: SupabaseClient): Promise<string> {
  const { data } = await client.auth.getSession();
  const session = data.session;
  if (!session) throw new Error("No session");
  const cookieProject = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(".")[0];
  return `sb-${cookieProject}-auth-token=${encodeURIComponent(
    JSON.stringify({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at,
      expires_in: session.expires_in,
      token_type: "bearer",
      user: session.user,
    }),
  )}`;
}

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: matType } = await admin
    .from("leave_types")
    .select("id")
    .eq("tenant_id", CAANTA)
    .eq("type_name", "Maternity Leave")
    .maybeSingle();
  if (!matType?.id) throw new Error("Maternity Leave type missing on Caanta");

  const { data: policy } = await admin
    .from("leave_entitlement_policy")
    .select("entitled_days")
    .eq("tenant_id", CAANTA)
    .eq("position", "__DEFAULT__")
    .eq("employment_type", "__ALL__")
    .eq("leave_type", "Maternity Leave")
    .maybeSingle();
  if (Number(policy?.entitled_days) !== 84) {
    throw new Error(`Expected default maternity policy 84, got ${policy?.entitled_days}`);
  }

  const stamp = Date.now();

  const hrEmail = `r1.mat.hr.${stamp}@test.davors`;
  const hrPassword = `R1MatHr-${stamp}!Aa9`;
  const { data: hrUser, error: hrErr } = await admin.auth.admin.createUser({
    email: hrEmail,
    password: hrPassword,
    email_confirm: true,
  });
  if (hrErr || !hrUser.user) throw hrErr ?? new Error("hr user");

  await admin.from("user_accounts").insert({
    auth_uid: hrUser.user.id,
    email: hrEmail,
    tenant_id: CAANTA,
    role: "hr",
    is_active: true,
  });

  await admin.from("leave_approver_config").insert({
    tenant_id: CAANTA,
    approver_user_account_id: hrUser.user.id,
    effective_from: new Date().toISOString().slice(0, 10),
    notes: "Release 1 maternity proof",
  });

  const email = `r1.mat.${stamp}@test.davors`;
  const password = `R1Mat-${stamp}!Aa9`;

  const { data: empRow } = await admin
    .from("employees")
    .select("employee_id, position, employment_type")
    .eq("tenant_id", CAANTA)
    .limit(1)
    .maybeSingle();
  if (!empRow?.employee_id) throw new Error("No Caanta employee");

  const { data: userData, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { portal: "staff" },
  });
  if (userErr || !userData.user) throw userErr ?? new Error("createUser");

  await admin.from("user_accounts").insert({
    auth_uid: userData.user.id,
    email,
    tenant_id: CAANTA,
    role: "employee",
    is_active: true,
    employee_id: empRow.employee_id,
  });

  const employeeClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
  await employeeClient.auth.signInWithPassword({ email, password });

  const year = new Date().getFullYear();
  const { error: balErr } = await employeeClient.rpc("ensure_my_leave_balances_for_year", {
    p_year: year,
  });
  if (balErr) throw balErr;

  const { data: balances } = await admin
    .from("employee_leave_balances")
    .select("*, leave_types(type_name)")
    .eq("employee_id", empRow.employee_id)
    .eq("year", year);
  const matBal = (balances ?? []).find(
    (b) => (b.leave_types as { type_name?: string })?.type_name === "Maternity Leave",
  );
  const annBal = (balances ?? []).find(
    (b) => (b.leave_types as { type_name?: string })?.type_name === "Annual Leave",
  );
  if (!matBal) throw new Error("Maternity balance row not created");
  if (Number(matBal.entitled_days) !== 84) {
    throw new Error(`Maternity entitled_days expected 84, got ${matBal.entitled_days}`);
  }

  const start = `${year}-11-03`;
  const end84 = maternityEndDateFromStart(start);

  const cookie = await sessionCookie(employeeClient);
  const submitRes = await fetch(`${APP_URL}/api/leave/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      leave_type_id: matType.id,
      start_date: start,
      end_date: end84,
      reason: "Release 1 maternity proof",
    }),
  });
  const submitPayload = (await submitRes.json()) as { error?: string; requestId?: string };
  if (!submitRes.ok) throw new Error(submitPayload.error ?? "submit failed");

  const overlapRes = await fetch(`${APP_URL}/api/leave/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      leave_type_id: matType.id,
      start_date: start,
      end_date: end84,
      reason: "overlap test",
    }),
  });
  const overlapPayload = (await overlapRes.json()) as { error?: string };
  if (overlapRes.ok) {
    throw new Error("Expected overlap rejection");
  }
  if (!overlapPayload.error?.includes("overlap")) {
    throw new Error(`Unexpected overlap error: ${overlapPayload.error}`);
  }

  const hrClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
  await hrClient.auth.signInWithPassword({ email: hrEmail, password: hrPassword });
  const hrCookie = await sessionCookie(hrClient);

  const approveRes = await fetch(`${APP_URL}/api/leave/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: hrCookie },
    body: JSON.stringify({ request_id: submitPayload.requestId }),
  });
  const approvePayload = (await approveRes.json()) as { error?: string };
  if (!approveRes.ok) throw new Error(approvePayload.error ?? "approve failed");

  const { data: afterBalances } = await admin
    .from("employee_leave_balances")
    .select("*, leave_types(type_name)")
    .eq("employee_id", empRow.employee_id)
    .eq("year", year);
  const matAfter = (afterBalances ?? []).find(
    (b) => (b.leave_types as { type_name?: string })?.type_name === "Maternity Leave",
  );
  const annAfter = (afterBalances ?? []).find(
    (b) => (b.leave_types as { type_name?: string })?.type_name === "Annual Leave",
  );
  if (!matAfter || Number(matAfter.days_used) <= 0) {
    throw new Error("Maternity days_used not incremented after approval");
  }
  if (annBal && annAfter && Number(annAfter.days_used) !== Number(annBal.days_used)) {
    throw new Error("Annual leave days_used changed — maternity must use separate balance");
  }

  const { data: listed } = await admin
    .from("leave_requests")
    .select("id, status, leave_types(type_name)")
    .eq("employee_id", empRow.employee_id)
    .eq("id", submitPayload.requestId)
    .maybeSingle();
  if (listed?.status !== "Approved") {
    throw new Error(`Expected Approved status, got ${listed?.status}`);
  }

  console.log("PASS: Caanta maternity policy 84, separate balance, overlap message, approve flow.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
