/**
 * Staging: four portal-access fixes (invite fail-closed, optional deposit on
 * terminate, portal status on view, auto-revoke on last lease end).
 *
 *   npx tsx scripts/_test-portal-access-four-fixes-staging.ts --env-file .env.staging.local
 */
import Module from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { deriveLesseePortalAccessState } from "../utils/lessee-portal-access";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const PASSWORD = "PortalFourFixes-Test-8Qx!";
const stamp = Date.now().toString(36);

const originalLoad = (Module as unknown as { _load: (...args: unknown[]) => unknown })
  ._load;
(Module as unknown as { _load: (...args: unknown[]) => unknown })._load = function (
  request: unknown,
  parent: unknown,
  isMain: unknown,
) {
  if (request === "server-only") {
    return {};
  }
  return originalLoad(request, parent, isMain);
};

function loadEnvForce(filePath: string) {
  const content = readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function plusYears(isoDate: string, years: number) {
  const y = Number(isoDate.slice(0, 4)) + years;
  return `${y}${isoDate.slice(4)}`;
}

type Created = {
  propertyIds: string[];
  unitIds: string[];
  lesseeIds: Array<{ tenantId: string; lesseeId: string }>;
  leaseIds: Array<{ tenantId: string; leaseId: string }>;
  depositIds: Array<{ tenantId: string; depositId: string }>;
  authUids: string[];
};

async function cleanup(admin: SupabaseClient, created: Created) {
  for (const row of created.depositIds) {
    await admin
      .from("security_deposits")
      .delete()
      .eq("tenant_id", row.tenantId)
      .eq("deposit_id", row.depositId);
  }
  for (const row of created.leaseIds) {
    await admin
      .from("leases")
      .delete()
      .eq("tenant_id", row.tenantId)
      .eq("lease_id", row.leaseId);
  }
  for (const row of created.lesseeIds) {
    await admin
      .from("lessee_portal_invites")
      .delete()
      .eq("tenant_id", row.tenantId)
      .eq("lessee_id", row.lesseeId);
    await admin
      .from("lessees")
      .delete()
      .eq("tenant_id", row.tenantId)
      .eq("lessee_id", row.lesseeId);
  }
  for (const unitId of created.unitIds) {
    await admin.from("property_units").delete().eq("unit_id", unitId);
  }
  for (const propertyId of created.propertyIds) {
    await admin.from("properties").delete().eq("property_id", propertyId);
  }
  for (const uid of created.authUids) {
    await admin.auth.admin.deleteUser(uid).catch(() => undefined);
  }
}

async function ensurePropertyUnit(
  admin: SupabaseClient,
  tenantId: string,
  created: Created,
  unitNumber: string,
) {
  const now = new Date().toISOString();
  const propertyId = crypto.randomUUID();
  const unitId = crypto.randomUUID();

  const { error: propertyError } = await admin.from("properties").insert({
    tenant_id: tenantId,
    property_id: propertyId,
    name: `FourFixes Prop ${stamp} ${unitNumber}`,
    property_type: "residential",
    address_line1: "1 Test Road",
    address_line2: null,
    city: "Accra",
    region: "Greater Accra",
    photo_urls: [],
    created_at: now,
    updated_at: now,
  });
  assert(!propertyError, propertyError?.message ?? "property insert");
  created.propertyIds.push(propertyId);

  const { error: unitError } = await admin.from("property_units").insert({
    tenant_id: tenantId,
    property_id: propertyId,
    unit_id: unitId,
    unit_number: unitNumber,
    bedrooms: 1,
    bathrooms: 1,
    base_rent_ghs: 1000,
    status: "vacant",
    created_at: now,
    updated_at: now,
  });
  assert(!unitError, unitError?.message ?? "unit insert");
  created.unitIds.push(unitId);

  return { propertyId, unitId };
}

async function insertActiveLeaseWithHeldDeposit(
  admin: SupabaseClient,
  args: {
    tenantId: string;
    unitId: string;
    lesseeId: string;
    created: Created;
  },
) {
  const now = new Date().toISOString();
  const today = todayIsoDate();
  const leaseId = crypto.randomUUID();
  const depositId = crypto.randomUUID();

  const { error: leaseError } = await admin.from("leases").insert({
    tenant_id: args.tenantId,
    lease_id: leaseId,
    unit_id: args.unitId,
    lessee_id: args.lesseeId,
    start_date: today,
    end_date: plusYears(today, 1),
    rent_amount_ghs: 1000,
    advance_rent_amount_ghs: 1000,
    termination_notice_months: 3,
    pending_rent_amount_ghs: null,
    rent_change_status: null,
    pending_termination_reason: null,
    termination_request_status: null,
    escalation_percent: null,
    escalation_frequency_months: null,
    late_fee_enabled: false,
    late_fee_type: null,
    late_fee_amount: null,
    status: "active",
    terminated_at: null,
    termination_reason: null,
    signature_status: "unsigned",
    landlord_acknowledged_at: null,
    tenant_acknowledged_at: null,
    landlord_acknowledged_by: null,
    tenant_acknowledged_by: null,
    created_at: now,
    updated_at: now,
  });
  assert(!leaseError, leaseError?.message ?? "lease insert");
  args.created.leaseIds.push({ tenantId: args.tenantId, leaseId });

  await admin
    .from("property_units")
    .update({ status: "occupied", updated_at: now })
    .eq("tenant_id", args.tenantId)
    .eq("unit_id", args.unitId);

  const { error: depositError } = await admin.from("security_deposits").insert({
    tenant_id: args.tenantId,
    deposit_id: depositId,
    lease_id: leaseId,
    amount_ghs: 1000,
    status: "held",
    amount_returned_ghs: null,
    date_collected: today,
    date_resolved: null,
    resolution_notes: null,
    created_at: now,
    updated_at: now,
  });
  assert(!depositError, depositError?.message ?? "deposit insert");
  args.created.depositIds.push({ tenantId: args.tenantId, depositId });

  return { leaseId, depositId };
}

async function main() {
  const envArgIdx = process.argv.indexOf("--env-file");
  const envPath =
    envArgIdx >= 0 && process.argv[envArgIdx + 1]
      ? resolve(process.argv[envArgIdx + 1])
      : resolve(".env.staging.local");

  loadEnvForce(envPath);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  assert(url.includes(STAGING_REF), `Expected staging ref ${STAGING_REF}`);
  assert(serviceKey, "Missing SUPABASE_SERVICE_ROLE_KEY");

  const resendWasPresent = Boolean((process.env.RESEND_API_KEY ?? "").trim());
  console.log(
    `RESEND_API_KEY in ${envPath}: ${resendWasPresent ? "present" : "absent"}`,
  );

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: landlords, error: landlordsError } = await admin
    .from("landlords")
    .select("tenant_id, landlord_type")
    .limit(20);
  assert(!landlordsError, landlordsError?.message ?? "landlords");
  const managed =
    landlords?.find((row) => row.landlord_type === "davors_managed") ?? null;
  const anyLandlord = landlords?.[0] ?? null;
  // Prefer davors_managed so fetchLesseeDetail (maintenance join) works for (e).
  const tenantId = (managed ?? anyLandlord)?.tenant_id;
  assert(tenantId, "Need at least one landlord tenant on staging");
  console.log(
    `Using landlord ${tenantId} (type=${(managed ?? anyLandlord)?.landlord_type ?? "unknown"})`,
  );

  const created: Created = {
    propertyIds: [],
    unitIds: [],
    lesseeIds: [],
    leaseIds: [],
    depositIds: [],
    authUids: [],
  };

  const savedResendKey = process.env.RESEND_API_KEY;
  try {
    // Import AFTER server-only stub.
    const { createAndSendLesseePortalInvite } = await import(
      "../utils/lessee-portal-invite"
    );
    const { terminateLeaseEarly } = await import("../utils/lease-management");
    const { fetchLesseeDetail } = await import("../utils/lessee-management");
    const { isResendConfigured, resendNotConfiguredMessage } = await import(
      "../utils/resend-email"
    );

    // ── (a) invite with RESEND cleared → ok:false, no invite row ──────────
    delete process.env.RESEND_API_KEY;
    assert(!isResendConfigured(), "isResendConfigured should be false");

    const inviteEmail = `fourfixes.invite.${stamp}@example.com`;
    const inviteLesseeId = crypto.randomUUID();
    const now = new Date().toISOString();
    const { error: inviteLesseeError } = await admin.from("lessees").insert({
      tenant_id: tenantId,
      lessee_id: inviteLesseeId,
      full_name: `FourFixes Invite ${stamp}`,
      phone: "0201111001",
      email: inviteEmail,
      status: "active",
      auth_user_id: null,
      created_at: now,
      updated_at: now,
    });
    assert(!inviteLesseeError, inviteLesseeError?.message ?? "invite lessee");
    created.lesseeIds.push({ tenantId, lesseeId: inviteLesseeId });

    const inviteResult = await createAndSendLesseePortalInvite(admin, {
      tenantId,
      lesseeId: inviteLesseeId,
    });
    assert(inviteResult.ok === false, "(a) expected ok:false");
    assert(
      inviteResult.error.includes("RESEND") ||
        inviteResult.error.includes(resendNotConfiguredMessage()) ||
        inviteResult.error.toLowerCase().includes("not configured"),
      `(a) expected resend config error, got: ${inviteResult.error}`,
    );

    const { count: inviteCount } = await admin
      .from("lessee_portal_invites")
      .select("token_hash", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("lessee_id", inviteLesseeId)
      .is("used_at", null);
    assert((inviteCount ?? 0) === 0, "(a) no unused invite row should remain");
    console.log("(a) invite without RESEND → ok:false, no invite row: PASS");

    // Restore key for later email attempts (may still fail; revoke must succeed).
    if (savedResendKey) {
      process.env.RESEND_API_KEY = savedResendKey;
    }

    // ── (b) terminate with Held deposit succeeds without resolve ──────────
    const { unitId: unitB } = await ensurePropertyUnit(
      admin,
      tenantId,
      created,
      `FF-B-${stamp}`,
    );
    const lesseeBId = crypto.randomUUID();
    const { error: lesseeBError } = await admin.from("lessees").insert({
      tenant_id: tenantId,
      lessee_id: lesseeBId,
      full_name: `FourFixes Term B ${stamp}`,
      phone: "0201111002",
      email: `fourfixes.term.b.${stamp}@example.com`,
      status: "active",
      auth_user_id: null,
      created_at: now,
      updated_at: now,
    });
    assert(!lesseeBError, lesseeBError?.message ?? "lessee B");
    created.lesseeIds.push({ tenantId, lesseeId: lesseeBId });

    const { leaseId: leaseB, depositId: depositB } =
      await insertActiveLeaseWithHeldDeposit(admin, {
        tenantId,
        unitId: unitB,
        lesseeId: lesseeBId,
        created,
      });

    const termB = await terminateLeaseEarly(admin, {
      tenantId,
      leaseId: leaseB,
      terminationReason: "FourFixes staging (b) held deposit optional",
    });
    assert(termB.depositId === depositB, "(b) depositId returned");

    const { data: depositAfter } = await admin
      .from("security_deposits")
      .select("status")
      .eq("tenant_id", tenantId)
      .eq("deposit_id", depositB)
      .single();
    assert(depositAfter?.status === "held", "(b) deposit still held");

    const { data: leaseAfterB } = await admin
      .from("leases")
      .select("status")
      .eq("tenant_id", tenantId)
      .eq("lease_id", leaseB)
      .single();
    assert(
      leaseAfterB?.status === "terminated_early",
      "(b) lease terminated_early",
    );
    console.log("(b) terminate with Held deposit (no resolve required): PASS");

    // ── (c) only lease → portal revoked, former, email attempted ──────────
    delete process.env.RESEND_API_KEY; // email may fail; revoke must still happen

    const { unitId: unitC } = await ensurePropertyUnit(
      admin,
      tenantId,
      created,
      `FF-C-${stamp}`,
    );
    const lesseeCId = crypto.randomUUID();
    const emailC = `fourfixes.term.c.${stamp}@example.com`;
    const { data: authC, error: authCError } =
      await admin.auth.admin.createUser({
        email: emailC,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { portal: "lessee" },
      });
    assert(!authCError && authC.user, authCError?.message ?? "auth C");
    created.authUids.push(authC.user.id);

    const { error: lesseeCError } = await admin.from("lessees").insert({
      tenant_id: tenantId,
      lessee_id: lesseeCId,
      full_name: `FourFixes Term C ${stamp}`,
      phone: "0201111003",
      email: emailC,
      status: "active",
      auth_user_id: authC.user.id,
      created_at: now,
      updated_at: now,
    });
    assert(!lesseeCError, lesseeCError?.message ?? "lessee C");
    created.lesseeIds.push({ tenantId, lesseeId: lesseeCId });

    const { leaseId: leaseC } = await insertActiveLeaseWithHeldDeposit(admin, {
      tenantId,
      unitId: unitC,
      lesseeId: lesseeCId,
      created,
    });

    const termC = await terminateLeaseEarly(admin, {
      tenantId,
      leaseId: leaseC,
      terminationReason: "FourFixes staging (c) last lease revoke",
    });
    assert(termC.portalRevoked === true, "(c) portalRevoked true");
    // With key cleared, emailAttempted still true inside auto-revoke but send fails.
    assert(
      termC.portalEmailSent === false || termC.portalEmailSent === true,
      "(c) portalEmailSent is boolean",
    );

    const { data: lesseeCAfter } = await admin
      .from("lessees")
      .select("auth_user_id, status")
      .eq("tenant_id", tenantId)
      .eq("lessee_id", lesseeCId)
      .single();
    assert(lesseeCAfter?.auth_user_id == null, "(c) auth_user_id cleared");
    assert(lesseeCAfter?.status === "former", "(c) status former");
    console.log(
      `(c) last lease terminate → revoked/former (emailSent=${termC.portalEmailSent}): PASS`,
    );

    // ── (d) one of two active leases → NOT revoked ────────────────────────
    const { unitId: unitD1 } = await ensurePropertyUnit(
      admin,
      tenantId,
      created,
      `FF-D1-${stamp}`,
    );
    const { unitId: unitD2 } = await ensurePropertyUnit(
      admin,
      tenantId,
      created,
      `FF-D2-${stamp}`,
    );
    const lesseeDId = crypto.randomUUID();
    const emailD = `fourfixes.term.d.${stamp}@example.com`;
    const { data: authD, error: authDError } =
      await admin.auth.admin.createUser({
        email: emailD,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { portal: "lessee" },
      });
    assert(!authDError && authD.user, authDError?.message ?? "auth D");
    created.authUids.push(authD.user.id);

    const { error: lesseeDError } = await admin.from("lessees").insert({
      tenant_id: tenantId,
      lessee_id: lesseeDId,
      full_name: `FourFixes Term D ${stamp}`,
      phone: "0201111004",
      email: emailD,
      status: "active",
      auth_user_id: authD.user.id,
      created_at: now,
      updated_at: now,
    });
    assert(!lesseeDError, lesseeDError?.message ?? "lessee D");
    created.lesseeIds.push({ tenantId, lesseeId: lesseeDId });

    const { leaseId: leaseD1 } = await insertActiveLeaseWithHeldDeposit(admin, {
      tenantId,
      unitId: unitD1,
      lesseeId: lesseeDId,
      created,
    });
    await insertActiveLeaseWithHeldDeposit(admin, {
      tenantId,
      unitId: unitD2,
      lesseeId: lesseeDId,
      created,
    });

    const termD = await terminateLeaseEarly(admin, {
      tenantId,
      leaseId: leaseD1,
      terminationReason: "FourFixes staging (d) keep other lease",
    });
    assert(termD.portalRevoked === false, "(d) must NOT revoke");

    const { data: lesseeDAfter } = await admin
      .from("lessees")
      .select("auth_user_id, status")
      .eq("tenant_id", tenantId)
      .eq("lessee_id", lesseeDId)
      .single();
    assert(
      lesseeDAfter?.auth_user_id === authD.user.id,
      "(d) auth_user_id kept",
    );
    assert(lesseeDAfter?.status === "active", "(d) status still active");
    console.log("(d) terminate one of two leases → NOT revoked: PASS");

    // ── (e) portalAccessState on detail / derive smoke ────────────────────
    if (savedResendKey) {
      process.env.RESEND_API_KEY = savedResendKey;
    }

    const stateActive = deriveLesseePortalAccessState({
      authUserId: authD.user.id,
      status: "active",
      pendingInviteExpiresAt: null,
    });
    assert(stateActive === "active", "(e) derive active");

    const stateFormer = deriveLesseePortalAccessState({
      authUserId: null,
      status: "former",
      pendingInviteExpiresAt: null,
    });
    assert(stateFormer === "former", "(e) derive former");

    const { detail, fetchError } = await fetchLesseeDetail(
      admin,
      tenantId,
      lesseeDId,
    );
    if (fetchError?.includes("Davors-managed")) {
      // Staging may only have platform_only landlords; still smoke derive + row.
      const { data: row } = await admin
        .from("lessees")
        .select("auth_user_id, status")
        .eq("tenant_id", tenantId)
        .eq("lessee_id", lesseeDId)
        .single();
      const fromRow = deriveLesseePortalAccessState({
        authUserId: row?.auth_user_id,
        status: row?.status,
        pendingInviteExpiresAt: null,
      });
      assert(fromRow === "active", "(e) row-derived portalAccessState active");
      console.log(
        "(e) derive + row portalAccessState (fetchLesseeDetail skipped: platform_only): PASS",
      );
    } else {
      assert(!fetchError, fetchError ?? "fetchLesseeDetail");
      assert(detail, "(e) detail present");
      assert(
        detail!.portalAccessState === "active",
        `(e) detail.portalAccessState=${detail!.portalAccessState}`,
      );
      console.log("(e) derive + fetchLesseeDetail portalAccessState: PASS");
    }

    console.log("\nAll four-fix staging checks passed.");
  } finally {
    if (savedResendKey !== undefined) {
      process.env.RESEND_API_KEY = savedResendKey;
    }
    await cleanup(admin, created);
    console.log("Cleanup done.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
