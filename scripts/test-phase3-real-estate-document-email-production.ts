/**
 * Phase 3 production tests: rent receipt, deposit receipt, tenancy agreement, manual payment receipt.
 *
 * Defaults to production credentials (.env.local.backup -> tvcurcnmasnocwdxzgvz).
 *
 *   npx tsx scripts/test-phase3-real-estate-document-email-production.ts --to david.avors@gmail.com
 *   npx tsx scripts/test-phase3-real-estate-document-email-production.ts --event all --to david.avors@gmail.com
 *   npx tsx scripts/test-phase3-real-estate-document-email-production.ts --seed-minimal --event all --to david.avors@gmail.com
 */
// @ts-nocheck
import Module from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
};

const DEFAULT_TO = "david.avors@gmail.com";
const PRODUCTION_ENV = ".env.local.backup";
const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const SEED_LANDLORD_NAME = "Phase 3 Prod Email Test Landlord";

function loadEnvForce(filePath) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    let value = trimmed.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[trimmed.slice(0, i).trim()] = value;
  }
}

function supabaseRef(url) {
  const m = /^https?:\/\/([^.]+)\.supabase\.co/.exec((url ?? "").trim());
  return m ? m[1] : "(invalid)";
}

function validateSupabaseEnv(envFile) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const looksPlaceholder =
    url.length < 20 ||
    !url.includes("supabase.co") ||
    /^[*x]+$/i.test(url.replace(/["']/g, ""));
  if (looksPlaceholder) {
    throw new Error(
      `${envFile} has an invalid or redacted NEXT_PUBLIC_SUPABASE_URL.`,
    );
  }
}

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : null;
}

async function withRealEstateEmails(admin, landlordTenantId, lesseeId, to, fn) {
  const [{ data: lessee, error: lesseeError }, { data: tenant, error: tenantError }] =
    await Promise.all([
      admin
        .from("lessees")
        .select("email")
        .eq("tenant_id", landlordTenantId)
        .eq("lessee_id", lesseeId)
        .maybeSingle(),
      admin.from("tenants").select("email").eq("id", landlordTenantId).maybeSingle(),
    ]);
  if (lesseeError) throw new Error(lesseeError.message);
  if (tenantError) throw new Error(tenantError.message);

  const originalLesseeEmail = lessee?.email ?? null;
  const originalLandlordEmail = tenant?.email ?? null;

  const updates = [];
  if (originalLesseeEmail !== to) {
    updates.push(
      admin
        .from("lessees")
        .update({ email: to })
        .eq("tenant_id", landlordTenantId)
        .eq("lessee_id", lesseeId),
    );
  }
  if (originalLandlordEmail !== to) {
    updates.push(
      admin.from("tenants").update({ email: to }).eq("id", landlordTenantId),
    );
  }
  if (updates.length > 0) {
    const results = await Promise.all(updates);
    for (const result of results) {
      if (result.error) throw new Error(result.error.message);
    }
  }

  try {
    await fn();
  } finally {
    if (originalLesseeEmail !== null && originalLesseeEmail !== to) {
      await admin
        .from("lessees")
        .update({ email: originalLesseeEmail })
        .eq("tenant_id", landlordTenantId)
        .eq("lessee_id", lesseeId);
    }
    if (originalLandlordEmail !== null && originalLandlordEmail !== to) {
      await admin
        .from("tenants")
        .update({ email: originalLandlordEmail })
        .eq("id", landlordTenantId);
    }
  }
}

async function savePdfCopy(label, buffer) {
  const outPath = resolve(`scripts/_phase3-prod-${label}.pdf`);
  writeFileSync(outPath, buffer);
  console.log(`  local PDF: ${outPath} (${buffer.length} bytes)`);
}

async function findPaidRentEntry(admin, landlordTenantId) {
  const explicit = argValue("--entry-id")?.trim();
  if (explicit) {
    const { data, error } = await admin
      .from("rent_ledger")
      .select(
        "entry_id, lease_id, period_start, period_end, amount_paid_ghs, payment_method, status",
      )
      .eq("tenant_id", landlordTenantId)
      .eq("entry_id", explicit)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error(`Rent entry ${explicit} not found.`);
    return data;
  }

  const { data, error } = await admin
    .from("rent_ledger")
    .select(
      "entry_id, lease_id, period_start, period_end, amount_paid_ghs, payment_method, status",
    )
    .eq("tenant_id", landlordTenantId)
    .gt("amount_paid_ghs", 0)
    .in("status", ["paid", "partial"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("No paid rent ledger entry found on production.");
  return data;
}

async function resolveLesseeForLease(admin, landlordTenantId, leaseId) {
  const { data, error } = await admin
    .from("leases")
    .select("lessee_id")
    .eq("tenant_id", landlordTenantId)
    .eq("lease_id", leaseId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const lesseeId = data?.lessee_id?.trim();
  if (!lesseeId) throw new Error(`Lease ${leaseId} has no lessee.`);
  return lesseeId;
}

async function resolveLandlordType(admin, landlordTenantId) {
  const { data } = await admin
    .from("landlords")
    .select("landlord_type")
    .eq("tenant_id", landlordTenantId)
    .maybeSingle();
  return data?.landlord_type === "davors_managed" ? "davors_managed" : "platform_only";
}

async function seedMinimalFixtures(admin, to, forcedLandlordTenantId = null) {
  let landlordTenantId = forcedLandlordTenantId?.trim() || null;
  if (!landlordTenantId) {
    const { data: existing } = await admin
      .from("tenants")
      .select("id")
      .eq("product_line", "real_estate_only")
      .eq("name", SEED_LANDLORD_NAME)
      .maybeSingle();
    landlordTenantId = existing?.id ?? null;
  }
  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  if (!landlordTenantId) {
    const { createPendingLandlordTenant } = await import("../utils/landlord-create.ts");
    const created = await createPendingLandlordTenant(admin, {
      name: SEED_LANDLORD_NAME,
      email: to,
      phone: "+233200000001",
      address: "Phase 3 test address, Accra",
    });
    if (!created.ok) throw new Error(created.error);
    landlordTenantId = created.tenantId;
    await admin
      .from("landlords")
      .update({ approval_status: "approved", updated_at: now })
      .eq("tenant_id", landlordTenantId);
    console.log(`Seeded landlord tenant: ${landlordTenantId}`);
  } else {
    console.log(`Reusing seeded landlord tenant: ${landlordTenantId}`);
  }

  let propertyId;
  let unitId;
  const { data: existingProperty } = await admin
    .from("properties")
    .select("property_id")
    .eq("tenant_id", landlordTenantId)
    .eq("name", "Phase 3 Test Property")
    .maybeSingle();

  if (existingProperty?.property_id) {
    propertyId = existingProperty.property_id;
    const { data: existingUnit } = await admin
      .from("property_units")
      .select("unit_id")
      .eq("tenant_id", landlordTenantId)
      .eq("property_id", propertyId)
      .limit(1)
      .maybeSingle();
    unitId = existingUnit?.unit_id ?? null;
  }

  if (!propertyId) {
    propertyId = crypto.randomUUID();
    const { error: propertyError } = await admin.from("properties").insert({
      tenant_id: landlordTenantId,
      property_id: propertyId,
      name: "Phase 3 Test Property",
      property_type: "residential",
      address_line1: "12 Test Lane",
      address_line2: "East Legon",
      city: "Accra",
      region: "Greater Accra",
      photo_urls: [],
      created_at: now,
      updated_at: now,
    });
    if (propertyError) throw new Error(propertyError.message);
  }

  if (!unitId) {
    unitId = crypto.randomUUID();
    const { error: unitError } = await admin.from("property_units").insert({
      tenant_id: landlordTenantId,
      property_id: propertyId,
      unit_id: unitId,
      unit_number: "P3-01",
      bedrooms: 2,
      bathrooms: 1,
      base_rent_ghs: 1500,
      status: "vacant",
      created_at: now,
      updated_at: now,
    });
    if (unitError) throw new Error(unitError.message);
  }

  let lesseeId;
  const { data: existingLessee } = await admin
    .from("lessees")
    .select("lessee_id")
    .eq("tenant_id", landlordTenantId)
    .eq("full_name", "Phase 3 Test Tenant")
    .maybeSingle();
  lesseeId = existingLessee?.lessee_id ?? null;

  if (!lesseeId) {
    lesseeId = crypto.randomUUID();
    const { error: lesseeError } = await admin.from("lessees").insert({
      tenant_id: landlordTenantId,
      lessee_id: lesseeId,
      auth_user_id: null,
      full_name: "Phase 3 Test Tenant",
      phone: "+233200000002",
      email: to,
      status: "active",
      private_notes: "Phase 3 production email test fixture",
      created_at: now,
      updated_at: now,
    });
    if (lesseeError) throw new Error(lesseeError.message);
  } else {
    await admin
      .from("lessees")
      .update({ email: to, updated_at: now })
      .eq("tenant_id", landlordTenantId)
      .eq("lessee_id", lesseeId);
  }

  let leaseId;
  const { data: existingLease } = await admin
    .from("leases")
    .select("lease_id")
    .eq("tenant_id", landlordTenantId)
    .eq("lessee_id", lesseeId)
    .limit(1)
    .maybeSingle();
  leaseId = existingLease?.lease_id ?? null;

  if (!leaseId) {
    leaseId = crypto.randomUUID();
    const depositIdNew = crypto.randomUUID();
    const startDate = today;
    const endDate = `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`;
    const { error: leaseError } = await admin.from("leases").insert({
      tenant_id: landlordTenantId,
      lease_id: leaseId,
      unit_id: unitId,
      lessee_id: lesseeId,
      start_date: startDate,
      end_date: endDate,
      rent_amount_ghs: 1500,
      advance_rent_amount_ghs: 1500,
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
    if (leaseError) throw new Error(leaseError.message);
    await admin
      .from("property_units")
      .update({ status: "occupied", updated_at: now })
      .eq("tenant_id", landlordTenantId)
      .eq("unit_id", unitId);
    const { error: depositError } = await admin.from("security_deposits").insert({
      tenant_id: landlordTenantId,
      deposit_id: depositIdNew,
      lease_id: leaseId,
      amount_ghs: 1500,
      status: "held",
      amount_returned_ghs: null,
      date_collected: today,
      date_resolved: null,
      resolution_notes: null,
      created_at: now,
      updated_at: now,
    });
    if (depositError) throw new Error(depositError.message);
    console.log(`Seeded lease ${leaseId}, deposit ${depositIdNew}`);
  }

  let depositId;
  const { data: existingDeposit } = await admin
    .from("security_deposits")
    .select("deposit_id")
    .eq("tenant_id", landlordTenantId)
    .eq("lease_id", leaseId)
    .eq("status", "held")
    .limit(1)
    .maybeSingle();
  depositId = existingDeposit?.deposit_id ?? null;

  let entryId;
  const { data: existingEntry } = await admin
    .from("rent_ledger")
    .select("entry_id")
    .eq("tenant_id", landlordTenantId)
    .eq("lease_id", leaseId)
    .gt("amount_paid_ghs", 0)
    .limit(1)
    .maybeSingle();
  entryId = existingEntry?.entry_id ?? null;

  if (!entryId) {
    entryId = crypto.randomUUID();
    const periodStart = `${today.slice(0, 8)}01`;
    const periodEnd = `${today.slice(0, 8)}28`;
    const { error: entryError } = await admin.from("rent_ledger").insert({
      tenant_id: landlordTenantId,
      entry_id: entryId,
      lease_id: leaseId,
      charge_type: "rent",
      description: null,
      period_start: periodStart,
      period_end: periodEnd,
      amount_due_ghs: 1500,
      amount_paid_ghs: 1500,
      credit_ghs: 0,
      status: "paid",
      verification_status: "verified",
      payment_method: "paystack_card",
      payment_date: `${today}T12:00:00.000Z`,
      notes: "Phase 3 production email test payment",
      created_at: now,
      updated_at: now,
    });
    if (entryError) throw new Error(entryError.message);
    console.log(`Seeded paid rent entry ${entryId}`);
  }

  await admin.from("tenants").update({ email: to, updated_at: now }).eq("id", landlordTenantId);

  const seedManifest = {
    landlordTenantId,
    propertyId,
    unitId,
    lesseeId,
    leaseId,
    depositId,
    entryId,
    seededAt: now,
  };
  writeFileSync(
    resolve("scripts/_phase3-prod-seed.json"),
    JSON.stringify(seedManifest, null, 2),
  );
  console.log("Seed manifest:", resolve("scripts/_phase3-prod-seed.json"));
  return seedManifest;
}

async function testRentReceiptPaystack(admin, ctx, to) {
  const entry = await findPaidRentEntry(admin, ctx.landlordTenantId);
  const lesseeId = await resolveLesseeForLease(admin, ctx.landlordTenantId, entry.lease_id);
  const amountGhs = Number(entry.amount_paid_ghs) || 0;
  const landlordType = await resolveLandlordType(admin, ctx.landlordTenantId);

  const { renderRentPaymentReceiptPdfBuffer } = await import(
    "../utils/rent-payment-receipt-pdf-server.tsx"
  );
  const rendered = await renderRentPaymentReceiptPdfBuffer({
    supabase: admin,
    tenantId: ctx.landlordTenantId,
    entryId: entry.entry_id,
    lesseeId,
  });
  if (!rendered.ok) throw new Error(rendered.error);
  await savePdfCopy(`rent-receipt-paystack-${rendered.receiptReference}`, rendered.buffer);

  const { notifyRentPaymentSuccess } = await import(
    "../utils/real-estate-document-notifications.ts"
  );
  await withRealEstateEmails(admin, ctx.landlordTenantId, lesseeId, to, async () => {
    await notifyRentPaymentSuccess({
      tenantId: ctx.landlordTenantId,
      landlordType,
      amountGhs,
      periodStart: entry.period_start,
      periodEnd: entry.period_end,
      paymentMethod: "Paystack (Card)",
      lesseeId,
      primaryEntryId: entry.entry_id,
      paymentReference: "phase3-prod-test-paystack",
      notifyStaff: false,
    });
  });

  console.log(
    `[Phase 3 prod test] rent_receipt (Paystack) subject: Rent payment receipt — ${entry.period_start}… | attachment: rent-receipt-${rendered.receiptReference}.pdf -> ${to}`,
  );
}

async function testManualPaymentReceipt(admin, ctx, to) {
  const entry = await findPaidRentEntry(admin, ctx.landlordTenantId);
  const lesseeId = await resolveLesseeForLease(admin, ctx.landlordTenantId, entry.lease_id);
  const amountGhs = Math.min(Number(entry.amount_paid_ghs) || 1, 1);
  const landlordType = await resolveLandlordType(admin, ctx.landlordTenantId);

  const { renderRentPaymentReceiptPdfBuffer } = await import(
    "../utils/rent-payment-receipt-pdf-server.tsx"
  );
  const rendered = await renderRentPaymentReceiptPdfBuffer({
    supabase: admin,
    tenantId: ctx.landlordTenantId,
    entryId: entry.entry_id,
    lesseeId,
  });
  if (!rendered.ok) throw new Error(rendered.error);
  await savePdfCopy(`rent-receipt-manual-${rendered.receiptReference}`, rendered.buffer);

  const { notifyRentPaymentSuccess } = await import(
    "../utils/real-estate-document-notifications.ts"
  );
  await withRealEstateEmails(admin, ctx.landlordTenantId, lesseeId, to, async () => {
    await notifyRentPaymentSuccess({
      tenantId: ctx.landlordTenantId,
      landlordType,
      amountGhs,
      periodStart: entry.period_start,
      periodEnd: entry.period_end,
      paymentMethod: "Bank Transfer",
      lesseeId,
      primaryEntryId: entry.entry_id,
      notifyStaff: false,
    });
  });

  console.log(
    `[Phase 3 prod test] manual_payment_receipt subject: Rent payment receipt — ${entry.period_start}… | attachment: rent-receipt-${rendered.receiptReference}.pdf (Bank Transfer label) -> ${to}`,
  );
}

async function testDepositReceipt(admin, ctx, to) {
  const depositId = argValue("--deposit-id")?.trim() ?? ctx.depositId;
  let deposit;
  if (depositId) {
    const { data, error } = await admin
      .from("security_deposits")
      .select("deposit_id, lease_id, status, amount_ghs")
      .eq("tenant_id", ctx.landlordTenantId)
      .eq("deposit_id", depositId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    deposit = data;
  } else {
    const { data, error } = await admin
      .from("security_deposits")
      .select("deposit_id, lease_id, status, amount_ghs")
      .eq("tenant_id", ctx.landlordTenantId)
      .eq("status", "held")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    deposit = data;
  }
  if (!deposit) {
    throw new Error("No held security deposit found on production.");
  }

  const lesseeId = await resolveLesseeForLease(
    admin,
    ctx.landlordTenantId,
    deposit.lease_id,
  );

  const { renderSecurityDepositReceiptPdfBuffer } = await import(
    "../utils/security-deposit-receipt-pdf-server.tsx"
  );
  const rendered = await renderSecurityDepositReceiptPdfBuffer({
    supabase: admin,
    tenantId: ctx.landlordTenantId,
    depositId: deposit.deposit_id,
    kind: "collection",
    lesseeId,
  });
  if (!rendered.ok) throw new Error(rendered.error);
  await savePdfCopy(`deposit-${rendered.receiptReference}`, rendered.buffer);

  const { notifySecurityDepositCollected } = await import(
    "../utils/real-estate-document-notifications.ts"
  );
  await withRealEstateEmails(admin, ctx.landlordTenantId, lesseeId, to, async () => {
    await notifySecurityDepositCollected({
      tenantId: ctx.landlordTenantId,
      depositId: deposit.deposit_id,
      leaseId: deposit.lease_id,
    });
  });

  console.log(
    `[Phase 3 prod test] deposit_receipt subject: Security deposit receipt — Phase 3 Test Property · P3-01 | attachment: deposit-${rendered.receiptReference}.pdf -> ${to}`,
  );
}

async function testTenancyAgreement(admin, ctx, to) {
  const leaseId = argValue("--lease-id")?.trim() ?? ctx.leaseId;
  const { data: lease, error } = await admin
    .from("leases")
    .select("lease_id, lessee_id, signature_status, lease_document_url")
    .eq("tenant_id", ctx.landlordTenantId)
    .eq("lease_id", leaseId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!lease) throw new Error("No lease found on production.");

  const lesseeId = lease.lessee_id?.trim();
  if (!lesseeId) throw new Error(`Lease ${lease.lease_id} has no lessee.`);

  const { resolveLeaseEmailAttachment, renderLeasePdfBuffer } = await import(
    "../utils/lease-pdf-server.tsx"
  );
  const attachment = await resolveLeaseEmailAttachment({
    supabase: admin,
    tenantId: ctx.landlordTenantId,
    leaseId: lease.lease_id,
  });
  if (attachment) {
    await savePdfCopy(`lease-${lease.lease_id}`, attachment.content);
    console.log(
      `  lease attachment source: ${lease.lease_document_url?.trim() ? "custom upload" : "generated LeasePdfDocument"}`,
    );
    console.log(`  attachment filename: ${attachment.filename}`);
  } else {
    const rendered = await renderLeasePdfBuffer({
      supabase: admin,
      tenantId: ctx.landlordTenantId,
      leaseId: lease.lease_id,
    });
    if (!rendered.ok) throw new Error(rendered.error);
    await savePdfCopy(`lease-${lease.lease_id}`, rendered.buffer);
    console.log("  lease attachment source: generated LeasePdfDocument (fallback)");
  }

  const { notifyLeaseSent } = await import(
    "../utils/real-estate-document-notifications.ts"
  );
  await withRealEstateEmails(admin, ctx.landlordTenantId, lesseeId, to, async () => {
    await notifyLeaseSent({
      tenantId: ctx.landlordTenantId,
      leaseId: lease.lease_id,
    });
  });

  console.log(
    `[Phase 3 prod test] tenancy_agreement subject: Tenancy agreement for your review | attachment: ${attachment?.filename ?? `lease-${lease.lease_id}.pdf`} -> ${to}`,
  );
}

async function main() {
  const envFile = argValue("--env-file") ?? PRODUCTION_ENV;
  const event = (argValue("--event") ?? "all").trim().toLowerCase();
  const to = (argValue("--to") ?? DEFAULT_TO).trim();

  loadEnvForce(resolve(envFile));
  validateSupabaseEnv(envFile);

  const ref = supabaseRef(process.env.NEXT_PUBLIC_SUPABASE_URL);
  console.log(`Env file: ${envFile}`);
  console.log(`Supabase project ref: ${ref}`);
  if (ref !== PRODUCTION_REF) {
    throw new Error(
      `Refusing to run production tests against ${ref}. Expected ${PRODUCTION_REF}. Pass --env-file explicitly if intentional.`,
    );
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );

  const seedMinimal = process.argv.includes("--seed-minimal");
  let ctx = {
    landlordTenantId: argValue("--tenant-id")?.trim() ?? "",
    leaseId: null,
    depositId: null,
    entryId: null,
  };

  if (seedMinimal || !ctx.landlordTenantId) {
    console.log("\n--- seed minimal production fixtures ---");
    const seeded = await seedMinimalFixtures(
      admin,
      to,
      ctx.landlordTenantId || null,
    );
    ctx = { ...ctx, ...seeded };
  }

  if (!ctx.landlordTenantId) {
    throw new Error(
      "No landlord tenant_id. Pass --tenant-id or use --seed-minimal on empty production.",
    );
  }

  console.log(`Landlord tenant_id: ${ctx.landlordTenantId}`);

  if (event === "none") {
    console.log("\nPhase 3 seed-only run completed.");
    return;
  }

  if (event === "all" || event === "rent_receipt") {
    console.log("\n--- rent_receipt (Paystack path) ---");
    await testRentReceiptPaystack(admin, ctx, to);
  }
  if (event === "all" || event === "deposit_receipt") {
    console.log("\n--- deposit_receipt ---");
    await testDepositReceipt(admin, ctx, to);
  }
  if (event === "all" || event === "tenancy_agreement") {
    console.log("\n--- tenancy_agreement ---");
    await testTenancyAgreement(admin, ctx, to);
  }
  if (event === "all" || event === "manual_payment_receipt") {
    console.log("\n--- manual_payment_receipt ---");
    await testManualPaymentReceipt(admin, ctx, to);
  }

  console.log("\nPhase 3 production tests completed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
