/**
 * Staging smoke: employee announcement send (multi-channel, skips, Hubtel/Resend).
 *
 * Usage: npx tsx scripts/test-employee-announcement-send-staging.ts
 */
import Module from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const DAVORS = "00000001-0000-4000-8000-000000000001";
const PASSWORD = "Announcements-Send-7Kx9!";

const originalLoad = (
  Module as unknown as { _load: (...args: unknown[]) => unknown }
)._load;
(Module as unknown as { _load: (...args: unknown[]) => unknown })._load =
  function (request: unknown, parent: unknown, isMain: unknown) {
    if (request === "server-only") {
      return {};
    }
    return originalLoad(request, parent, isMain);
  };

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

function mask(value: string | undefined): string {
  const v = (value ?? "").trim();
  if (!v) return "MISSING";
  if (v.length < 8) return `PRESENT (short len=${v.length})`;
  return `PRESENT (len=${v.length}, prefix=${v.slice(0, 4)}…)`;
}

async function main() {
  loadEnvForce(resolve(process.cwd(), ".env.staging.local"));

  const { runAnnouncementSend, previewAnnouncementAudience } = await import(
    "../utils/employee-announcement-send"
  );
  const { loadAnnouncementEmployees } = await import(
    "../utils/employee-announcements-audience"
  );

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  assert(url.includes("wieflwbfdmjtsdnwbfii"), "Refusing non-staging");
  assert(serviceKey, "SUPABASE_SERVICE_ROLE_KEY missing");

  console.log("RESEND_API_KEY:", mask(process.env.RESEND_API_KEY));
  console.log("HUBTEL_CLIENT_ID:", mask(process.env.HUBTEL_CLIENT_ID));
  console.log("HUBTEL_CLIENT_SECRET:", mask(process.env.HUBTEL_CLIENT_SECRET));

  const hubtelConfigured = Boolean(
    (process.env.HUBTEL_CLIENT_ID ?? "").trim() &&
      (process.env.HUBTEL_CLIENT_SECRET ?? "").trim(),
  );
  const resendConfigured = Boolean((process.env.RESEND_API_KEY ?? "").trim());

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const stamp = Date.now();
  const cleanup = {
    authUids: [] as string[],
    employeeIds: [] as string[],
    announcementIds: [] as string[],
    templateIds: [] as string[],
    notificationIds: [] as string[],
  };

  try {
    const { data: positionRows } = await admin
      .from("positions")
      .select("position_title")
      .limit(5);
    const positionA =
      (positionRows ?? []).map((r) => String(r.position_title ?? "").trim()).find(Boolean) ??
      null;
    const positionB =
      (positionRows ?? [])
        .map((r) => String(r.position_title ?? "").trim())
        .filter((title) => title && title !== positionA)[0] ?? positionA;

    const fullEmpId = `ANNC-FULL-${stamp}`;
    const emailOnlyEmpId = `ANNC-EM-${stamp}`;
    const posEmpId = `ANNC-POS-${stamp}`;

    const { error: empsErr } = await admin.from("employees").insert([
      {
        tenant_id: DAVORS,
        employee_id: fullEmpId,
        staff_id: `SF${stamp}`.slice(0, 20),
        full_name: `Full Channel ${stamp}`,
        email: `annc.full.${stamp}@davorsfacilities.com`,
        phone: "0244999001",
        employment_status: "Active",
        employment_type: "Full-Time",
        shift: "Morning",
        position: positionA,
      },
      {
        tenant_id: DAVORS,
        employee_id: emailOnlyEmpId,
        staff_id: `SE${stamp}`.slice(0, 20),
        full_name: `Email Only ${stamp}`,
        email: `annc.email.${stamp}@davorsfacilities.com`,
        phone: null,
        employment_status: "Active",
        employment_type: "Part-Time",
        shift: "Afternoon",
        position: positionB,
      },
      {
        tenant_id: DAVORS,
        employee_id: posEmpId,
        staff_id: `SPOS${stamp}`.slice(0, 20),
        full_name: `Position Only ${stamp}`,
        email: null,
        phone: null,
        employment_status: "Active",
        employment_type: "Casual",
        shift: "Night",
        position: positionA,
      },
    ]);
    assert(!empsErr, `employees insert: ${empsErr?.message}`);
    cleanup.employeeIds.push(fullEmpId, emailOnlyEmpId, posEmpId);
    console.log("OK created 3 smoke employees", { positionA, positionB });

    const loginEmail = `annc.login.${stamp}@example.com`;
    const { data: authData, error: authErr } =
      await admin.auth.admin.createUser({
        email: loginEmail,
        password: PASSWORD,
        email_confirm: true,
      });
    assert(!authErr && authData.user, authErr?.message ?? "auth create failed");
    const authUid = authData.user!.id;
    cleanup.authUids.push(authUid);

    const { error: uaErr } = await admin.from("user_accounts").insert({
      auth_uid: authUid,
      email: loginEmail,
      role: "employee",
      is_active: true,
      tenant_id: DAVORS,
      employee_id: fullEmpId,
    });
    assert(!uaErr, `user_accounts: ${uaErr?.message}`);
    console.log("OK linked full employee to user_accounts");

    const { data: template, error: tmplErr } = await admin
      .from("employee_message_templates")
      .insert({
        tenant_id: DAVORS,
        name: `Send Smoke Template ${stamp}`,
        channel: "both",
        subject: "Hello {{employee_name}}",
        body: "Hi {{employee_name}} ({{staff_id}}), staging announcement smoke.",
        is_active: true,
      })
      .select("id")
      .single();
    assert(!tmplErr && template, tmplErr?.message ?? "template missing");
    cleanup.templateIds.push(template.id);

    async function nextCode() {
      const { data, error } = await admin.rpc("generate_next_code", {
        p_tenant_id: DAVORS,
        p_entity_type: "ANNC",
        p_padding: 4,
      });
      assert(!error && data, error?.message ?? "empty code");
      return data as string;
    }

    const multiCode = await nextCode();
    const { data: multiAnn, error: multiErr } = await admin
      .from("employee_announcements")
      .insert({
        tenant_id: DAVORS,
        announcement_code: multiCode,
        name: `Multi Channel Smoke ${stamp}`,
        template_id: template.id,
        channels: ["email", "sms", "in_app"],
        subject: null,
        body: null,
        audience_filter: {
          type: "individual",
          value: [fullEmpId, emailOnlyEmpId],
        },
        status: "draft",
        total_recipients: 0,
      })
      .select("id")
      .single();
    assert(!multiErr && multiAnn, multiErr?.message ?? "multi ann missing");
    cleanup.announcementIds.push(multiAnn.id);

    const preview = await previewAnnouncementAudience(admin as SupabaseClient, {
      tenantId: DAVORS,
      announcementId: multiAnn.id,
    });
    console.log("Audience preview:", preview);
    assert(preview.employeeCount === 2, `expected 2 employees, got ${preview.employeeCount}`);
    assert(preview.pendingCount === 4, `expected 4 pending, got ${preview.pendingCount}`);
    assert(
      preview.skippedNoContactCount === 1,
      `expected 1 no-contact, got ${preview.skippedNoContactCount}`,
    );
    assert(
      preview.skippedNoLoginCount === 1,
      `expected 1 no-login, got ${preview.skippedNoLoginCount}`,
    );
    console.log("OK preview counts for multi-channel individual audience");

    const sendResult = await runAnnouncementSend(admin as SupabaseClient, {
      tenantId: DAVORS,
      announcementId: multiAnn.id,
    });
    console.log("Send result:", sendResult);
    assert(sendResult.status === "sent", `expected sent, got ${sendResult.status}`);

    const { data: recipients } = await admin
      .from("employee_announcement_recipients")
      .select("employee_id, channel, status, error_detail")
      .eq("announcement_id", multiAnn.id)
      .eq("tenant_id", DAVORS);

    const fullRows = (recipients ?? []).filter((r) => r.employee_id === fullEmpId);
    assert(fullRows.length === 3, `full employee expected 3 rows, got ${fullRows.length}`);
    for (const channel of ["email", "sms", "in_app"] as const) {
      assert(
        fullRows.some((r) => r.channel === channel),
        `missing ${channel} row for full employee`,
      );
    }

    const fullEmail = fullRows.find((r) => r.channel === "email");
    if (resendConfigured) {
      assert(
        fullEmail?.status === "sent" || fullEmail?.status === "failed",
        `email status unexpected: ${fullEmail?.status} ${fullEmail?.error_detail}`,
      );
      if (fullEmail?.status === "sent") {
        console.log("OK Resend email delivered (sent)");
      } else {
        console.log(
          "WARN Resend configured but email failed:",
          fullEmail?.error_detail,
        );
      }
    } else {
      assert(fullEmail?.status === "failed", "without Resend expected failed");
      assert(
        String(fullEmail?.error_detail ?? "").includes("RESEND"),
        `expected RESEND error, got ${fullEmail?.error_detail}`,
      );
      console.log("OK Resend missing — email failed gracefully");
    }

    const fullSms = fullRows.find((r) => r.channel === "sms");
    if (!hubtelConfigured) {
      assert(fullSms?.status === "failed", `SMS expected failed, got ${fullSms?.status}`);
      assert(
        String(fullSms?.error_detail ?? "").includes("HUBTEL"),
        `expected HUBTEL error, got ${fullSms?.error_detail}`,
      );
      console.log("OK Hubtel placeholder — SMS failed gracefully per-recipient");
    } else {
      // Staging may have placeholder-looking Hubtel IDs that still "call" the API.
      assert(
        fullSms?.status === "sent" || fullSms?.status === "failed",
        `SMS unexpected ${fullSms?.status}`,
      );
      console.log(
        `OK Hubtel path invoked — SMS status=${fullSms?.status}` +
          (fullSms?.error_detail ? ` detail=${fullSms.error_detail}` : ""),
      );
    }

    const fullInApp = fullRows.find((r) => r.channel === "in_app");
    assert(fullInApp?.status === "sent", `in_app expected sent, got ${fullInApp?.status}`);

    const { data: notifs } = await admin
      .from("employee_notifications")
      .select("id, recipient_user_id, title, body, announcement_id")
      .eq("announcement_id", multiAnn.id)
      .eq("tenant_id", DAVORS);
    assert((notifs ?? []).length === 1, `expected 1 notification, got ${notifs?.length}`);
    assert(notifs![0].recipient_user_id === authUid, "notification auth_uid mismatch");
    cleanup.notificationIds.push(notifs![0].id);
    console.log("OK full employee: 3 recipient rows + 1 notification");

    const emailOnlyRows = (recipients ?? []).filter(
      (r) => r.employee_id === emailOnlyEmpId,
    );
    assert(emailOnlyRows.length === 3, "email-only employee should have 3 channel rows");
    assert(
      emailOnlyRows.find((r) => r.channel === "sms")?.status === "skipped_no_contact",
      "sms should be skipped_no_contact",
    );
    assert(
      emailOnlyRows.find((r) => r.channel === "in_app")?.status ===
        "skipped_no_login",
      "in_app should be skipped_no_login",
    );
    const emailOnlyEmail = emailOnlyRows.find((r) => r.channel === "email");
    assert(
      emailOnlyEmail?.status === "sent" || emailOnlyEmail?.status === "failed",
      `email-only email channel unexpected ${emailOnlyEmail?.status}`,
    );
    console.log("OK email-only employee: email attempted, sms/in_app skipped");

    // Position filter (only if we have a real positions lookup title)
    if (positionA) {
      const posCode = await nextCode();
      const { data: posAnn, error: posAnnErr } = await admin
        .from("employee_announcements")
        .insert({
          tenant_id: DAVORS,
          announcement_code: posCode,
          name: `Position Filter Smoke ${stamp}`,
          template_id: null,
          channels: ["in_app"],
          subject: null,
          body: "Position filter body for {{employee_name}}",
          audience_filter: { type: "position", value: positionA },
          status: "draft",
          total_recipients: 0,
        })
        .select("id")
        .single();
      assert(!posAnnErr && posAnn, posAnnErr?.message ?? "pos ann missing");
      cleanup.announcementIds.push(posAnn.id);

      const posPreview = await previewAnnouncementAudience(
        admin as SupabaseClient,
        {
          tenantId: DAVORS,
          announcementId: posAnn.id,
        },
      );
      assert(
        posPreview.employeeCount >= 2,
        `position filter expected >=2, got ${posPreview.employeeCount}`,
      );
      console.log(
        `OK position audience narrowed to ${positionA} (${posPreview.employeeCount} employees)`,
      );

      const posSend = await runAnnouncementSend(admin as SupabaseClient, {
        tenantId: DAVORS,
        announcementId: posAnn.id,
      });
      assert(posSend.status === "sent", posSend.message);

      const { data: posRecipients } = await admin
        .from("employee_announcement_recipients")
        .select("employee_id, status")
        .eq("announcement_id", posAnn.id);
      const posEmpIds = new Set((posRecipients ?? []).map((r) => r.employee_id));
      assert(posEmpIds.has(fullEmpId), "full emp in position audience");
      assert(posEmpIds.has(posEmpId), "pos emp in position audience");
      if (positionB && positionB !== positionA) {
        assert(!posEmpIds.has(emailOnlyEmpId), "email-only should be excluded");
      }
      assert(
        (posRecipients ?? []).find((r) => r.employee_id === posEmpId)?.status ===
          "skipped_no_login",
        "pos emp without login should skip",
      );
      console.log("OK position filter send resolved correct employee set");
    } else {
      console.log("SKIP position filter — no positions lookup rows on staging");
    }

    for (const [type, value, expectIncludes] of [
      ["shift", "Morning", fullEmpId],
      ["employment_type", "Part-Time", emailOnlyEmpId],
    ] as const) {
      const loaded = await loadAnnouncementEmployees(admin as SupabaseClient, DAVORS, {
        type,
        value,
      });
      assert(
        loaded.some((e) => e.employee_id === expectIncludes),
        `${type}=${value} should include ${expectIncludes}`,
      );
      console.log(`OK ${type} audience includes expected employee`);
    }

    // Filtered OR-union: positionA ∪ named email-only employee (deduped)
    {
      const { normalizeAudienceFilter } = await import(
        "../utils/employee-announcements-types"
      );
      const legacy = normalizeAudienceFilter({
        type: "individual",
        value: [emailOnlyEmpId],
      });
      assert(
        legacy?.type === "filtered" &&
          legacy.employee_ids.includes(emailOnlyEmpId),
        "legacy individual must map to filtered.employee_ids",
      );
      console.log("OK legacy individual → filtered mapping");

      const unionFilter = {
        type: "filtered" as const,
        positions: positionA ? [positionA] : [],
        shifts: [] as string[],
        employment_types: [] as string[],
        employee_ids: [emailOnlyEmpId],
      };
      const unionLoaded = await loadAnnouncementEmployees(
        admin as SupabaseClient,
        DAVORS,
        unionFilter,
      );
      const unionIds = new Set(unionLoaded.map((e) => e.employee_id));
      assert(unionIds.has(emailOnlyEmpId), "union must include named individual");
      if (positionA) {
        assert(unionIds.has(fullEmpId), "union must include position match");
        assert(unionIds.has(posEmpId), "union must include position-only emp");
      }
      assert(
        unionIds.size === unionLoaded.length,
        "union load must be de-duplicated",
      );

      const unionCode = await nextCode();
      const { data: unionAnn, error: unionErr } = await admin
        .from("employee_announcements")
        .insert({
          tenant_id: DAVORS,
          announcement_code: unionCode,
          name: `Filtered Union Smoke ${stamp}`,
          template_id: null,
          channels: ["in_app"],
          subject: null,
          body: "Union body for {{employee_name}} ({{staff_id}})",
          audience_filter: unionFilter,
          status: "draft",
          total_recipients: 0,
        })
        .select("id")
        .single();
      assert(!unionErr && unionAnn, unionErr?.message ?? "union ann missing");
      cleanup.announcementIds.push(unionAnn.id);

      const unionSend = await runAnnouncementSend(admin as SupabaseClient, {
        tenantId: DAVORS,
        announcementId: unionAnn.id,
      });
      assert(unionSend.status === "sent", unionSend.message);

      const { data: unionRecipients } = await admin
        .from("employee_announcement_recipients")
        .select(
          "id, employee_id, channel, status, sent_at, error_detail",
        )
        .eq("announcement_id", unionAnn.id)
        .eq("tenant_id", DAVORS);
      const sentEmpIds = new Set(
        (unionRecipients ?? []).map((r) => r.employee_id),
      );
      assert(sentEmpIds.has(emailOnlyEmpId), "union send includes named emp");
      for (const id of sentEmpIds) {
        assert(unionIds.has(id), `unexpected recipient ${id} outside union`);
      }

      // Recipients payload shape (mirrors View modal API)
      const { data: empRows } = await admin
        .from("employees")
        .select("employee_id, full_name, staff_id")
        .eq("tenant_id", DAVORS)
        .in("employee_id", [...sentEmpIds]);
      assert(
        (empRows ?? []).length === sentEmpIds.size,
        "employee join for view modal",
      );
      const sample = empRows?.[0];
      assert(sample?.full_name, "sample employee name for message preview");
      const previewBody = `Union body for {{employee_name}} ({{staff_id}})`.replace(
        "{{employee_name}}",
        sample!.full_name,
      ).replace("{{staff_id}}", sample!.staff_id);
      assert(
        previewBody.includes(sample!.full_name),
        "message preview substitution",
      );
      console.log(
        `OK filtered OR-union send (${sentEmpIds.size} employees) + view preview sample`,
      );
    }

    console.log("\nALL STAGING SEND CHECKS PASSED");
  } finally {
    for (const id of cleanup.notificationIds) {
      await admin.from("employee_notifications").delete().eq("id", id);
    }
    for (const id of cleanup.announcementIds) {
      await admin
        .from("employee_announcement_recipients")
        .delete()
        .eq("announcement_id", id);
      await admin
        .from("employee_notifications")
        .delete()
        .eq("announcement_id", id);
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
      await admin
        .from("employees")
        .delete()
        .eq("tenant_id", DAVORS)
        .eq("employee_id", employeeId);
    }
    console.log("OK cleaned smoke rows");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
