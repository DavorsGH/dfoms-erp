/**
 * Staging: employee announcements RLS isolation (script 127).
 *
 * Usage: npx tsx scripts/test-employee-announcements-isolation-staging.ts
 *
 * Confirms:
 * 1. Employee A sees only own employee_notifications (not Employee B, same tenant).
 * 2. Caanta user cannot see Davors announcements/templates/recipients/notifications.
 * 3. HR can INSERT notifications + manage announcements, but cannot SELECT other
 *    employees' inbox rows.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const DAVORS = "00000001-0000-4000-8000-000000000001";
const CAANTA = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";
const PASSWORD = "Announcements-Iso-7Kx9!";
const stamp = Date.now().toString(36);

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

type Cleanup = {
  authUids: string[];
  notificationIds: string[];
  recipientIds: string[];
  announcementIds: string[];
  templateIds: string[];
  employeeIds: string[];
};

const cleanup: Cleanup = {
  authUids: [],
  notificationIds: [],
  recipientIds: [],
  announcementIds: [],
  templateIds: [],
  employeeIds: [],
};

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
  cleanup.authUids.push(authUid);

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
  const { error } = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  assert(!error, error?.message ?? `sign-in failed for ${email}`);
  return client;
}

async function ensureEmployee(
  admin: SupabaseClient,
  tenantId: string,
  label: string,
) {
  const { data: empCode, error: empErr } = await admin.rpc("generate_next_code", {
    p_tenant_id: tenantId,
    p_entity_type: "EMP",
    p_padding: 4,
  });
  assert(!empErr && empCode, empErr?.message ?? "EMP allocate failed");

  const { data: staffRaw, error: staffErr } = await admin.rpc("generate_next_code", {
    p_tenant_id: tenantId,
    p_entity_type: "STAFF",
    p_padding: 4,
  });
  assert(!staffErr && staffRaw, staffErr?.message ?? "STAFF allocate failed");

  const { data: inserted, error: insErr } = await admin
    .from("employees")
    .insert({
      tenant_id: tenantId,
      employee_id: empCode,
      staff_id: String(staffRaw),
      full_name: `Announcements Iso ${label} ${stamp}`,
      employment_type: "Permanent",
      employment_status: "Active",
    })
    .select("employee_id")
    .single();
  assert(!insErr && inserted, insErr?.message ?? "employee insert failed");
  cleanup.employeeIds.push(inserted.employee_id);
  return inserted.employee_id as string;
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

  // Tables must exist
  for (const table of [
    "employee_message_templates",
    "employee_announcements",
    "employee_announcement_recipients",
    "employee_notifications",
  ]) {
    const { error } = await admin.from(table).select("id").limit(0);
    assert(
      !error,
      `Table ${table} missing or not exposed — apply script 127 first: ${error?.message}`,
    );
  }
  console.log("PASS tables exist via PostgREST");

  const empAEmail = `ann.emp.a.${stamp}@test.davors`;
  const empBEmail = `ann.emp.b.${stamp}@test.davors`;
  const hrEmail = `ann.hr.${stamp}@test.davors`;
  const caantaEmail = `ann.caanta.${stamp}@test.davors`;

  try {
    const empAId = await ensureEmployee(admin, DAVORS, "A");
    const empBId = await ensureEmployee(admin, DAVORS, "B");

    const empAUid = await createUser(admin, {
      tenantId: DAVORS,
      email: empAEmail,
      role: "employee",
      employeeId: empAId,
    });
    const empBUid = await createUser(admin, {
      tenantId: DAVORS,
      email: empBEmail,
      role: "employee",
      employeeId: empBId,
    });
    const hrUid = await createUser(admin, {
      tenantId: DAVORS,
      email: hrEmail,
      role: "hr",
    });
    await createUser(admin, {
      tenantId: CAANTA,
      email: caantaEmail,
      role: "hr",
    });
    console.log("PASS created employees + users (Davors A/B/HR, Caanta HR)");

    const { data: template, error: tplErr } = await admin
      .from("employee_message_templates")
      .insert({
        tenant_id: DAVORS,
        name: `Iso template ${stamp}`,
        channel: "email",
        subject: "Iso subject",
        body: "Iso body",
        created_by: hrUid,
        is_active: true,
      })
      .select("id")
      .single();
    assert(!tplErr && template, tplErr?.message ?? "template insert failed");
    cleanup.templateIds.push(template.id);

    const { data: announcement, error: annErr } = await admin
      .from("employee_announcements")
      .insert({
        tenant_id: DAVORS,
        announcement_code: `ANNC-ISO-${stamp}`.slice(0, 40),
        name: `Iso announcement ${stamp}`,
        template_id: template.id,
        channels: ["in_app", "email"],
        subject: "Iso subject",
        body: "Iso body",
        audience_filter: { type: "all" },
        status: "sent",
        created_by: hrUid,
        total_recipients: 2,
        sent_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    assert(!annErr && announcement, annErr?.message ?? "announcement insert failed");
    cleanup.announcementIds.push(announcement.id);

    for (const [employeeId, channel] of [
      [empAId, "in_app"],
      [empBId, "in_app"],
      [empAId, "email"],
    ] as const) {
      const { data: rec, error: recErr } = await admin
        .from("employee_announcement_recipients")
        .insert({
          tenant_id: DAVORS,
          announcement_id: announcement.id,
          employee_id: employeeId,
          channel,
          status: "sent",
          sent_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      assert(!recErr && rec, recErr?.message ?? "recipient insert failed");
      cleanup.recipientIds.push(rec.id);
    }

    const { data: notifA, error: nAErr } = await admin
      .from("employee_notifications")
      .insert({
        tenant_id: DAVORS,
        recipient_user_id: empAUid,
        announcement_id: announcement.id,
        title: `For A ${stamp}`,
        body: "Body A",
      })
      .select("id")
      .single();
    assert(!nAErr && notifA, nAErr?.message ?? "notif A insert failed");
    cleanup.notificationIds.push(notifA.id);

    const { data: notifB, error: nBErr } = await admin
      .from("employee_notifications")
      .insert({
        tenant_id: DAVORS,
        recipient_user_id: empBUid,
        announcement_id: announcement.id,
        title: `For B ${stamp}`,
        body: "Body B",
      })
      .select("id")
      .single();
    assert(!nBErr && notifB, nBErr?.message ?? "notif B insert failed");
    cleanup.notificationIds.push(notifB.id);
    console.log("PASS seeded template/announcement/recipients/notifications");

    // --- 1. Employee A inbox privacy ---
    const empAClient = await signInAs(url, anon, empAEmail);
    const { data: aSeen, error: aErr } = await empAClient
      .from("employee_notifications")
      .select("id, recipient_user_id, title");
    assert(!aErr, aErr?.message ?? "Employee A notifications read failed");
    const aIds = new Set((aSeen ?? []).map((r) => r.id));
    assert(aIds.has(notifA.id), "Employee A cannot see own notification");
    assert(!aIds.has(notifB.id), "LEAK: Employee A saw Employee B notification");
    assert(
      (aSeen ?? []).every((r) => r.recipient_user_id === empAUid),
      "LEAK: Employee A saw foreign recipient_user_id",
    );
    console.log(
      `PASS (1) Employee A inbox: ${aSeen?.length ?? 0} own row(s), not B's`,
    );

    // Mark own as read
    const { error: markErr } = await empAClient
      .from("employee_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", notifA.id);
    assert(!markErr, markErr?.message ?? "mark-as-read failed");
    console.log("PASS (1) Employee A can mark own notification read");

    // Cannot mark B's
    const { data: markB, error: markBErr } = await empAClient
      .from("employee_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", notifB.id)
      .select("id");
    assert(!markBErr, markBErr?.message ?? "mark B unexpected error");
    assert(
      (markB ?? []).length === 0,
      "LEAK: Employee A updated Employee B notification",
    );
    console.log("PASS (1) Employee A cannot update B's notification");

    // --- 2. Cross-tenant ---
    const caantaClient = await signInAs(url, anon, caantaEmail);

    for (const [table, ownId] of [
      ["employee_announcements", announcement.id],
      ["employee_message_templates", template.id],
      ["employee_announcement_recipients", cleanup.recipientIds[0]],
      ["employee_notifications", notifA.id],
    ] as const) {
      const { data, error } = await caantaClient.from(table).select("id");
      assert(!error, `Caanta ${table}: ${error?.message}`);
      const ids = new Set((data ?? []).map((r) => r.id));
      assert(
        !ids.has(ownId),
        `LEAK: Caanta saw Davors ${table} row ${ownId}`,
      );
      console.log(`PASS (2) Caanta cannot see Davors ${table}`);
    }

    // --- 3. HR manage but no inbox browse ---
    const hrClient = await signInAs(url, anon, hrEmail);

    const { data: hrAnn, error: hrAnnErr } = await hrClient
      .from("employee_announcements")
      .select("id, name")
      .eq("id", announcement.id);
    assert(!hrAnnErr, hrAnnErr?.message ?? "HR announcements read failed");
    assert((hrAnn ?? []).length === 1, "HR cannot see own-tenant announcement");
    console.log("PASS (3) HR can read announcements (admin sent list)");

    const { data: hrRecipients, error: hrRecErr } = await hrClient
      .from("employee_announcement_recipients")
      .select("id")
      .eq("announcement_id", announcement.id);
    assert(!hrRecErr, hrRecErr?.message ?? "HR recipients read failed");
    assert(
      (hrRecipients ?? []).length >= 2,
      "HR cannot see announcement recipients",
    );
    console.log("PASS (3) HR can read delivery recipients");

    const { data: hrInbox, error: hrInboxErr } = await hrClient
      .from("employee_notifications")
      .select("id, recipient_user_id, title");
    assert(!hrInboxErr, hrInboxErr?.message ?? "HR notifications read failed");
    const hrIds = new Set((hrInbox ?? []).map((r) => r.id));
    assert(
      !hrIds.has(notifA.id) && !hrIds.has(notifB.id),
      "LEAK: HR browsed employee inbox notifications",
    );
    assert(
      (hrInbox ?? []).every((r) => r.recipient_user_id === hrUid),
      "LEAK: HR saw non-self notification rows",
    );
    console.log(
      `PASS (3) HR cannot browse employee inboxes (saw ${hrInbox?.length ?? 0} self-only row(s))`,
    );

    // HR can INSERT a notification for employee A (send path).
    // Do not .select() the inserted row — HR has no SELECT on other users' inbox
    // (PostgREST return=representation would fail RLS even when INSERT WITH CHECK passes).
    const { error: hrInsErr } = await hrClient.from("employee_notifications").insert({
      tenant_id: DAVORS,
      recipient_user_id: empAUid,
      announcement_id: announcement.id,
      title: `HR sent ${stamp}`,
      body: "From HR",
    });
    assert(!hrInsErr, hrInsErr?.message ?? "HR insert notification failed");

    const { data: aAfterHr, error: aAfterErr } = await empAClient
      .from("employee_notifications")
      .select("id, title")
      .eq("title", `HR sent ${stamp}`);
    assert(!aAfterErr, aAfterErr?.message ?? "Employee A reread after HR insert failed");
    assert((aAfterHr ?? []).length === 1, "HR insert not visible to Employee A");
    cleanup.notificationIds.push(aAfterHr![0].id);
    console.log("PASS (3) HR can INSERT notifications (send path; verified via recipient)");

    // Employee cannot INSERT for someone else
    const { error: empInsErr } = await empAClient
      .from("employee_notifications")
      .insert({
        tenant_id: DAVORS,
        recipient_user_id: empBUid,
        title: "Should fail",
        body: "nope",
      });
    assert(empInsErr, "LEAK: employee was allowed to INSERT notification");
    console.log("PASS (3) Employee cannot INSERT notifications");

    console.log("\nALL PASS — employee announcements RLS isolation");
  } finally {
    for (const id of cleanup.notificationIds) {
      await admin.from("employee_notifications").delete().eq("id", id);
    }
    for (const id of cleanup.recipientIds) {
      await admin.from("employee_announcement_recipients").delete().eq("id", id);
    }
    for (const id of cleanup.announcementIds) {
      await admin.from("employee_announcements").delete().eq("id", id);
    }
    for (const id of cleanup.templateIds) {
      await admin.from("employee_message_templates").delete().eq("id", id);
    }
    for (const authUid of cleanup.authUids) {
      await admin.from("user_accounts").delete().eq("auth_uid", authUid);
      await admin.auth.admin.deleteUser(authUid);
    }
    for (const employeeId of cleanup.employeeIds) {
      await admin.from("employees").delete().eq("employee_id", employeeId);
    }
    console.log("Cleanup done");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
