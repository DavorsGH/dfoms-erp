import { NextResponse } from "next/server";
import { requireDavorsPlatformSuperAdmin } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { assertRealEstateLandlordTenant } from "@/utils/property-management";
import { generateRentLedger } from "@/utils/generate-rent-ledger";

type GenerateBody = {
  tenant_id?: string;
  billingMonth?: string;
  lease_id?: string;
};

function isBillingMonth(value: string): boolean {
  return /^\d{4}-\d{2}$/.test(value);
}

/**
 * Staff-triggered rent ledger generation for one landlord (optional month).
 * Cron path remains /api/cron/generate-rent-ledger (platform-wide).
 */
export async function POST(request: Request) {
  const auth = await requireDavorsPlatformSuperAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  let body: GenerateBody;
  try {
    body = (await request.json()) as GenerateBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
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

  const billingMonth = body.billingMonth?.trim() || undefined;
  if (billingMonth && !isBillingMonth(billingMonth)) {
    return NextResponse.json(
      { error: "billingMonth must be YYYY-MM." },
      { status: 400 },
    );
  }

  const leaseId = body.lease_id?.trim() || undefined;

  try {
    const result = await generateRentLedger({
      admin,
      tenantId: landlord.tenantId,
      leaseId,
      billingMonth,
    });

    return NextResponse.json({
      success: true,
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
