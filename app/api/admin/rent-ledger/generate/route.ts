import { NextResponse } from "next/server";
import { requireDavorsPlatformRealEstateStaff } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { assertRealEstateLandlordTenant } from "@/utils/property-management";
import { assertDavorsManagedLandlord } from "@/utils/maintenance-management";
import { generateRentLedger } from "@/utils/generate-rent-ledger";

type GenerateBody = {
  tenant_id?: string;
  tenant_ids?: string[];
  billingMonth?: string;
  lease_id?: string;
};

export type RentLedgerGenerateLandlordResult = {
  tenantId: string;
  landlordName: string | null;
  ok: boolean;
  error?: string;
  created: number;
  skipped: number;
  errors: number;
  overdueUpdated: number;
  billingMonth?: string;
  periodStart?: string;
  periodEnd?: string;
};

function isBillingMonth(value: string): boolean {
  return /^\d{4}-\d{2}$/.test(value);
}

function parseTenantIds(body: GenerateBody): string[] {
  if (Array.isArray(body.tenant_ids)) {
    return [
      ...new Set(
        body.tenant_ids
          .map((id) => (typeof id === "string" ? id.trim() : ""))
          .filter(Boolean),
      ),
    ];
  }
  return [];
}

/**
 * Staff-triggered rent ledger generation for one or many davors_managed landlords.
 * Cron path remains /api/cron/generate-rent-ledger (platform-wide).
 */
export async function POST(request: Request) {
  const auth = await requireDavorsPlatformRealEstateStaff();
  if (!auth.ok) {
    return auth.response;
  }

  let body: GenerateBody;
  try {
    body = (await request.json()) as GenerateBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const billingMonth = body.billingMonth?.trim() || undefined;
  if (billingMonth && !isBillingMonth(billingMonth)) {
    return NextResponse.json(
      { error: "billingMonth must be YYYY-MM." },
      { status: 400 },
    );
  }

  const leaseId = body.lease_id?.trim() || undefined;
  const bulkTenantIds = parseTenantIds(body);

  if (bulkTenantIds.length > 0) {
    if (leaseId) {
      return NextResponse.json(
        { error: "lease_id cannot be used with tenant_ids bulk generation." },
        { status: 400 },
      );
    }

    const admin = createAdminClient();
    const landlords: RentLedgerGenerateLandlordResult[] = [];
    let created = 0;
    let skipped = 0;
    let errors = 0;
    let overdueUpdated = 0;
    let billingMonthLabel = billingMonth ?? "";
    let periodStart: string | undefined;
    let periodEnd: string | undefined;

    for (const tenantId of bulkTenantIds) {
      const landlord = await assertDavorsManagedLandlord(admin, tenantId);
      if (!landlord.ok) {
        landlords.push({
          tenantId,
          landlordName: null,
          ok: false,
          error: landlord.error,
          created: 0,
          skipped: 0,
          errors: 1,
          overdueUpdated: 0,
        });
        errors += 1;
        continue;
      }

      try {
        const result = await generateRentLedger({
          admin,
          tenantId: landlord.tenantId,
          billingMonth,
        });
        billingMonthLabel = result.billingMonth;
        periodStart = result.periodStart;
        periodEnd = result.periodEnd;
        created += result.created;
        skipped += result.skipped;
        errors += result.errors;
        overdueUpdated += result.overdueUpdated;
        landlords.push({
          tenantId: landlord.tenantId,
          landlordName: landlord.name,
          ok: result.errors === 0,
          created: result.created,
          skipped: result.skipped,
          errors: result.errors,
          overdueUpdated: result.overdueUpdated,
          billingMonth: result.billingMonth,
          periodStart: result.periodStart,
          periodEnd: result.periodEnd,
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Rent ledger generation failed.";
        landlords.push({
          tenantId: landlord.tenantId,
          landlordName: landlord.name,
          ok: false,
          error: message,
          created: 0,
          skipped: 0,
          errors: 1,
          overdueUpdated: 0,
        });
        errors += 1;
      }
    }

    return NextResponse.json({
      success: true,
      bulk: true,
      billingMonth: billingMonthLabel,
      periodStart,
      periodEnd,
      landlordsProcessed: bulkTenantIds.length,
      created,
      skipped,
      errors,
      overdueUpdated,
      landlords,
    });
  }

  const admin = createAdminClient();
  const landlord = await assertRealEstateLandlordTenant(
    admin,
    body.tenant_id ?? "",
  );
  if (!landlord.ok) {
    return NextResponse.json(
      { error: landlord.error },
      { status: landlord.status },
    );
  }

  try {
    const result = await generateRentLedger({
      admin,
      tenantId: landlord.tenantId,
      leaseId,
      billingMonth,
    });

    return NextResponse.json({
      success: true,
      bulk: false,
      billingMonth: result.billingMonth,
      periodStart: result.periodStart,
      periodEnd: result.periodEnd,
      overdueUpdated: result.overdueUpdated,
      created: result.created,
      skipped: result.skipped,
      errors: result.errors,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Rent ledger generation failed.",
      },
      { status: 500 },
    );
  }
}
