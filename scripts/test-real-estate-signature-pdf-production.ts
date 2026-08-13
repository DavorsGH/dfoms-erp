/**
 * Production tests: Real Estate PDF signatures (platform_only vs davors_managed).
 *
 *   npx tsx scripts/test-real-estate-signature-pdf-production.ts --to david.avors@gmail.com
 */
// @ts-nocheck
import Module from "node:module";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
};

const PRODUCTION_ENV = ".env.local.backup";
const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const DEFAULT_TO = "david.avors@gmail.com";
const DAVORS = "00000001-0000-4000-8000-000000000001";
const PLATFORM_LANDLORD_NAME = "Phase 3 Prod Email Test Landlord";
const MANAGED_LANDLORD_NAME = "Phase 3 Prod Davors Managed Test";

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

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : null;
}

async function buildDistinctSignaturePng() {
  const fixture = resolve("scripts/fixtures/phase1-test-signature.png");
  if (existsSync(fixture)) {
    return readFileSync(fixture);
  }
  const svg = `<svg width="240" height="72" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="white"/>
    <path d="M18 48 C 42 18, 66 58, 90 34 S 138 22, 162 40 S 198 54, 222 28"
      fill="none" stroke="#0f2744" stroke-width="3" stroke-linecap="round"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function uploadLandlordTestSignature(admin, landlordTenantId, label) {
  const png = await buildDistinctSignaturePng();
  const path = `${landlordTenantId}/landlord-signature.png`;
  const { error: uploadError } = await admin.storage
    .from("tenant-logos")
    .upload(path, png, { upsert: true, contentType: "image/png" });
  if (uploadError) throw new Error(uploadError.message);

  const { error: updateError } = await admin
    .from("landlords")
    .update({
      signature_url: path,
      signature_author_name: `${label} Signatory`,
      signature_author_title: "Property Manager",
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", landlordTenantId);
  if (updateError) throw new Error(updateError.message);
  console.log(`  Seeded platform_only signature on ${landlordTenantId}`);
}

async function ensureManagedLandlord(admin) {
  const { data: existing } = await admin
    .from("tenants")
    .select("id")
    .eq("product_line", "real_estate_only")
    .eq("name", MANAGED_LANDLORD_NAME)
    .maybeSingle();

  if (existing?.id) {
    return existing.id;
  }

  const { createPendingLandlordTenant } = await import("../utils/landlord-create.ts");
  const managedSignupEmail = "david.avors+re-managed-test@gmail.com";
  const created = await createPendingLandlordTenant(admin, {
    name: MANAGED_LANDLORD_NAME,
    email: managedSignupEmail,
    phone: "+233200000003",
    address: "Davors managed test, Accra",
  });
  if (!created.ok) throw new Error(created.error);

  await admin
    .from("landlords")
    .update({
      approval_status: "approved",
      landlord_type: "davors_managed",
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", created.tenantId);

  console.log(`  Created davors_managed landlord ${created.tenantId}`);
  return created.tenantId;
}

async function loadFixtureIds(admin, landlordTenantId) {
  const seedPath = resolve("scripts/_phase3-prod-seed.json");
  if (
    existsSync(seedPath) &&
    JSON.parse(readFileSync(seedPath, "utf8")).landlordTenantId === landlordTenantId
  ) {
    return JSON.parse(readFileSync(seedPath, "utf8"));
  }

  const { data: lease } = await admin
    .from("leases")
    .select("lease_id, lessee_id")
    .eq("tenant_id", landlordTenantId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: deposit } = await admin
    .from("security_deposits")
    .select("deposit_id")
    .eq("tenant_id", landlordTenantId)
    .eq("status", "held")
    .limit(1)
    .maybeSingle();
  const { data: entry } = await admin
    .from("rent_ledger")
    .select("entry_id")
    .eq("tenant_id", landlordTenantId)
    .gt("amount_paid_ghs", 0)
    .limit(1)
    .maybeSingle();

  return {
    landlordTenantId,
    leaseId: lease?.lease_id,
    lesseeId: lease?.lessee_id,
    depositId: deposit?.deposit_id,
    entryId: entry?.entry_id,
  };
}

async function seedFixturesForLandlord(admin, landlordTenantId, to) {
  const ids = await loadFixtureIds(admin, landlordTenantId);
  if (ids.entryId && ids.depositId && ids.leaseId) {
    return ids;
  }

  const { execSync } = await import("node:child_process");
  execSync(
    `npx tsx scripts/test-phase3-real-estate-document-email-production.ts --seed-minimal --tenant-id ${landlordTenantId} --event none --to ${to}`,
    { stdio: "inherit", env: process.env },
  );
  return loadFixtureIds(admin, landlordTenantId);
}

async function savePdf(label, buffer) {
  const outPath = resolve(`scripts/_phase3-sig-prod-${label}.pdf`);
  writeFileSync(outPath, buffer);
  console.log(`  local PDF: ${outPath} (${buffer.length} bytes)`);
}

async function testLandlordType(admin, to, landlordTenantId, landlordTypeLabel) {
  const { data: landlord } = await admin
    .from("landlords")
    .select("landlord_type, signature_url, signature_author_name")
    .eq("tenant_id", landlordTenantId)
    .maybeSingle();

  const { data: davors } = await admin
    .from("tenants")
    .select("signature_url, signature_author_name, signature_author_title")
    .eq("id", DAVORS)
    .maybeSingle();

  console.log(`\n=== ${landlordTypeLabel} (${landlordTenantId}) ===`);
  console.log(`  landlord_type: ${landlord?.landlord_type}`);
  console.log(`  landlord signature_url: ${Boolean(landlord?.signature_url?.trim())}`);
  console.log(`  Davors signature_url: ${Boolean(davors?.signature_url?.trim())}`);

  const ids = await loadFixtureIds(admin, landlordTenantId);
  if (!ids.entryId || !ids.depositId || !ids.leaseId) {
    throw new Error(`Missing fixtures for ${landlordTypeLabel} landlord.`);
  }

  const { renderRentPaymentReceiptPdfBuffer } = await import(
    "../utils/rent-payment-receipt-pdf-server.tsx"
  );
  const { renderSecurityDepositReceiptPdfBuffer } = await import(
    "../utils/security-deposit-receipt-pdf-server.tsx"
  );
  const { renderLeasePdfBuffer } = await import("../utils/lease-pdf-server.tsx");
  const { resolveRealEstatePdfSignature } = await import(
    "../utils/real-estate-pdf-signature.ts"
  );
  const {
    notifyRentPaymentSuccess,
    notifySecurityDepositCollected,
    notifyLeaseSent,
  } = await import("../utils/real-estate-document-notifications.ts");

  const signature = await resolveRealEstatePdfSignature({
    supabase: admin,
    landlordTenantId,
  });
  console.log(
    `  resolved signature: image=${Boolean(signature.signatureImageUrl)} name=${signature.authorizedByName ?? "(none)"} title=${signature.authorizedByTitle ?? "(none)"}`,
  );

  const rentRendered = await renderRentPaymentReceiptPdfBuffer({
    supabase: admin,
    tenantId: landlordTenantId,
    entryId: ids.entryId,
    lesseeId: ids.lesseeId,
  });
  if (!rentRendered.ok) throw new Error(rentRendered.error);
  await savePdf(`${landlordTypeLabel}-rent-receipt`, rentRendered.buffer);

  const depositRendered = await renderSecurityDepositReceiptPdfBuffer({
    supabase: admin,
    tenantId: landlordTenantId,
    depositId: ids.depositId,
    kind: "collection",
    lesseeId: ids.lesseeId,
  });
  if (!depositRendered.ok) throw new Error(depositRendered.error);
  await savePdf(`${landlordTypeLabel}-deposit-receipt`, depositRendered.buffer);

  const leaseRendered = await renderLeasePdfBuffer({
    supabase: admin,
    tenantId: landlordTenantId,
    leaseId: ids.leaseId,
  });
  if (!leaseRendered.ok) throw new Error(leaseRendered.error);
  await savePdf(`${landlordTypeLabel}-lease`, leaseRendered.buffer);

  await admin.from("tenants").update({ email: to }).eq("id", landlordTenantId);
  await admin
    .from("lessees")
    .update({ email: to })
    .eq("tenant_id", landlordTenantId)
    .eq("lessee_id", ids.lesseeId);

  const { data: entry } = await admin
    .from("rent_ledger")
    .select("period_start, period_end, amount_paid_ghs")
    .eq("tenant_id", landlordTenantId)
    .eq("entry_id", ids.entryId)
    .maybeSingle();

  await notifyRentPaymentSuccess({
    tenantId: landlordTenantId,
    landlordType: landlord?.landlord_type ?? "platform_only",
    amountGhs: Number(entry?.amount_paid_ghs) || 1500,
    periodStart: entry?.period_start,
    periodEnd: entry?.period_end,
    paymentMethod: "Paystack (Card)",
    lesseeId: ids.lesseeId,
    primaryEntryId: ids.entryId,
    notifyStaff: false,
  });
  console.log(`  email: rent receipt (${landlordTypeLabel}) -> ${to}`);

  await notifySecurityDepositCollected({
    tenantId: landlordTenantId,
    depositId: ids.depositId,
    leaseId: ids.leaseId,
  });
  console.log(`  email: deposit receipt (${landlordTypeLabel}) -> ${to}`);

  await notifyLeaseSent({
    tenantId: landlordTenantId,
    leaseId: ids.leaseId,
  });
  console.log(`  email: tenancy agreement (${landlordTypeLabel}) -> ${to}`);
}

let to = DEFAULT_TO;

async function main() {
  to = (argValue("--to") ?? DEFAULT_TO).trim();
  loadEnvForce(resolve(PRODUCTION_ENV));
  const ref = supabaseRef(process.env.NEXT_PUBLIC_SUPABASE_URL);
  console.log(`Env: ${PRODUCTION_ENV}`);
  console.log(`Supabase ref: ${ref}`);
  if (ref !== PRODUCTION_REF) {
    throw new Error(`Refusing: expected ${PRODUCTION_REF}, got ${ref}`);
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );

  const { data: platformTenant } = await admin
    .from("tenants")
    .select("id")
    .eq("product_line", "real_estate_only")
    .eq("name", PLATFORM_LANDLORD_NAME)
    .maybeSingle();

  if (!platformTenant?.id) {
    throw new Error(
      `platform_only test landlord "${PLATFORM_LANDLORD_NAME}" not found. Run Phase 3 seed first.`,
    );
  }

  await uploadLandlordTestSignature(
    admin,
    platformTenant.id,
    "Platform Test",
  );

  const managedTenantId = await ensureManagedLandlord(admin);

  await seedFixturesForLandlord(admin, platformTenant.id, to);
  await seedFixturesForLandlord(admin, managedTenantId, to);

  await testLandlordType(admin, to, platformTenant.id, "platform_only");
  await testLandlordType(admin, to, managedTenantId, "davors_managed");

  console.log("\nReal Estate signature production tests completed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
