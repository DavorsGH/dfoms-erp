/**
 * Staging: employee notification inbox API (list, mark read, isolation).
 *
 * Usage: npx tsx scripts/test-employee-notifications-inbox-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const DAVORS = "00000001-0000-4000-8000-000000000001";
const CAANTA = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";
const PASSWORD = "Notif-Inbox-7Kx9!";

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    process.env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function createUser(
  admin: SupabaseClient,
  opts: {
    tenantId: string;
    email: string;
    role: string;
    employeeId?: string | null;
  },
) {
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email: opts.email,
    password: PASSWORD,
    email_confirm: true,
  });
  assert(!authError && authData.user, authError?.message ?? "auth create failed");
  const authUid = authData.user!.id;

  const { error: insertError } = await admin.from("user_accounts").insert({
    auth_uid: authUid,
    email: opts.email,
    role: opts.role,
    is_active: true,
    tenant_id: opts.tenantId,
    employee_id: opts.employeeId ?? null,
  });
  assert(!insertError, insertError?.message ?? "user_accounts insert failed");
  return authUid;
}

async function signInAs(url: string, anon: string, email: string) {
  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  assert(!error && data.session, error?.message ?? "sign-in failed");
  return createClient(url, anon, {
    global: {
      headers: { Authorization: `Bearer ${data.session!.access_token}` },
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function main() {
  loadEnvForce(resolve(process.cwd(), ".env.staging.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const anon =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    "";
  assert(url.includes("wieflwbfdmjtsdnwbfii"), "Refusing non-staging");
  assert(serviceKey && anon, "Missing staging keys");

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  const stamp = Date.now().toString(36);
  const emailA = `notif.a.${stamp}@test.davors`;
  const emailB = `notif.b.${stamp}@test.davors`;
  const emailCaanta = `notif.caanta.${stamp}@test.davors`;

  const cleanup = {
    authUids: [] as string[],
    notificationIds: [] as string[],
  };

  try {
    const uidA = await createUser(admin, {
      tenantId: DAVORS,
      email: emailA,
      role: "employee",
    });
    const uidB = await createUser(admin, {
      tenantId: DAVORS,
      email: emailB,
      role: "employee",
    });
    const uidCaanta = await createUser(admin, {
      tenantId: CAANTA,
      email: emailCaanta,
      role: "employee",
    });
    cleanup.authUids.push(uidA, uidB, uidCaanta);

    const { data: notifA, error: notifAErr } = await admin
      .from("employee_notifications")
      .insert({
        tenant_id: DAVORS,
        recipient_user_id: uidA,
        announcement_id: null,
        title: `Inbox A ${stamp}`,
        body: `Body for employee A ${stamp}`,
      })
      .select("id, read_at, title")
      .single();
    assert(!notifAErr && notifA, notifAErr?.message ?? "notif A missing");
    cleanup.notificationIds.push(notifA.id);

    const { data: notifB, error: notifBErr } = await admin
      .from("employee_notifications")
      .insert({
        tenant_id: DAVORS,
        recipient_user_id: uidB,
        announcement_id: null,
        title: `Inbox B ${stamp}`,
        body: `Body for employee B ${stamp}`,
      })
      .select("id")
      .single();
    assert(!notifBErr && notifB, notifBErr?.message ?? "notif B missing");
    cleanup.notificationIds.push(notifB.id);

    const clientA = await signInAs(url, anon, emailA);
    const clientB = await signInAs(url, anon, emailB);
    const clientCaanta = await signInAs(url, anon, emailCaanta);

    // A lists own only
    const { data: listA, error: listAErr } = await clientA
      .from("employee_notifications")
      .select("id, title, read_at")
      .order("created_at", { ascending: false });
    assert(!listAErr, listAErr?.message ?? "list A failed");
    assert(
      (listA ?? []).some((r) => r.id === notifA.id),
      "A should see own notification",
    );
    assert(
      !(listA ?? []).some((r) => r.id === notifB.id),
      "A must not see B notification",
    );
    console.log("OK employee A sees only own notification");

    // B cannot see A's
    const { data: listB } = await clientB
      .from("employee_notifications")
      .select("id")
      .eq("id", notifA.id);
    assert((listB ?? []).length === 0, "B must not see A's notification by id");
    console.log("OK same-tenant employee B cannot see A's notification");

    // Caanta cannot see Davors
    const { data: listC } = await clientCaanta
      .from("employee_notifications")
      .select("id")
      .eq("id", notifA.id);
    assert((listC ?? []).length === 0, "Caanta must not see Davors notification");
    console.log("OK cross-tenant isolation holds for inbox");

    // Mark read as A
    assert(notifA.read_at == null, "A notification should start unread");
    const now = new Date().toISOString();
    const { data: marked, error: markErr } = await clientA
      .from("employee_notifications")
      .update({ read_at: now })
      .eq("id", notifA.id)
      .select("id, read_at")
      .single();
    assert(!markErr && marked?.read_at, markErr?.message ?? "mark read failed");
    console.log("OK mark-as-read via recipient session");

    // Persist check
    const { data: reloaded } = await clientA
      .from("employee_notifications")
      .select("id, read_at")
      .eq("id", notifA.id)
      .maybeSingle();
    assert(reloaded?.read_at, "read_at should persist after reload");
    console.log("OK read_at persists");

    // B cannot mark A's as read
    const { data: sneaky, error: sneakyErr } = await clientB
      .from("employee_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", notifA.id)
      .select("id");
    assert(
      !sneakyErr || (sneaky ?? []).length === 0,
      "B update of A's row should not return rows",
    );
    assert((sneaky ?? []).length === 0, "B must not update A's notification");
    console.log("OK mark-read is own-inbox only");

    // Mark-all-read: add another unread for A then clear
    const { data: notifA2, error: notifA2Err } = await admin
      .from("employee_notifications")
      .insert({
        tenant_id: DAVORS,
        recipient_user_id: uidA,
        announcement_id: null,
        title: `Inbox A2 ${stamp}`,
        body: `Second body ${stamp}`,
      })
      .select("id")
      .single();
    assert(!notifA2Err && notifA2, notifA2Err?.message ?? "notif A2 missing");
    cleanup.notificationIds.push(notifA2.id);

    const { error: markAllErr } = await clientA
      .from("employee_notifications")
      .update({ read_at: new Date().toISOString() })
      .is("read_at", null);
    assert(!markAllErr, markAllErr?.message ?? "mark all failed");

    const { count: unreadLeft } = await clientA
      .from("employee_notifications")
      .select("id", { count: "exact", head: true })
      .is("read_at", null);
    assert((unreadLeft ?? 0) === 0, `expected 0 unread, got ${unreadLeft}`);
    console.log("OK mark-all-read clears own unread only");

    console.log("\nALL INBOX STAGING CHECKS PASSED");
  } finally {
    for (const id of cleanup.notificationIds) {
      await admin.from("employee_notifications").delete().eq("id", id);
    }
    for (const authUid of cleanup.authUids) {
      await admin.from("user_accounts").delete().eq("auth_uid", authUid);
      await admin.auth.admin.deleteUser(authUid);
    }
    console.log("OK cleaned smoke rows");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
