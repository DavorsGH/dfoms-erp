import { NextResponse } from "next/server";
import { requireDavorsPlatformRealEstateStaff } from "@/utils/admin-auth";
import {
  isLeaseChargeBillingMode,
  isLeaseChargeCategory,
  LEASE_CHARGE_CATEGORIES,
  type LeaseChargeBillingMode,
  type LeaseChargeCategory,
} from "@/utils/lease-charge-categories";
import {
  upsertLeaseChargeSettings,
  type UpsertLeaseChargeSettingInput,
} from "@/utils/lease-charge-settings";
import { createAdminClient } from "@/utils/supabase/admin";
import { assertRealEstateLandlordTenant } from "@/utils/property-management";

export const runtime = "nodejs";

type SettingBody = {
  charge_category?: string;
  is_billed?: boolean;
  billing_mode?: string;
  flat_amount_ghs?: number | string | null;
};

type Body = {
  tenant_id?: string;
  lease_id?: string;
  settings?: SettingBody[];
};

function parseSettings(settings: SettingBody[] | undefined):
  | { ok: true; rows: UpsertLeaseChargeSettingInput[] }
  | { ok: false; error: string } {
  if (!Array.isArray(settings)) {
    return { ok: false, error: "settings must be an array." };
  }

  const byCategory = new Map<LeaseChargeCategory, UpsertLeaseChargeSettingInput>();
  for (const row of settings) {
    const category = row.charge_category?.trim();
    if (!category || !isLeaseChargeCategory(category)) {
      return { ok: false, error: "Each setting requires a valid charge_category." };
    }
    const billingModeRaw = row.billing_mode?.trim() || "recurring";
    if (!isLeaseChargeBillingMode(billingModeRaw)) {
      return { ok: false, error: "Invalid billing_mode." };
    }
    const billingMode = billingModeRaw as LeaseChargeBillingMode;
    const isBilled = row.is_billed === true;
    const flatRaw = row.flat_amount_ghs;
    const flatAmount =
      flatRaw == null || flatRaw === ""
        ? null
        : Number(flatRaw);

    byCategory.set(category, {
      chargeCategory: category,
      isBilled,
      billingMode,
      flatAmountGhs:
        flatAmount != null && Number.isFinite(flatAmount) ? flatAmount : null,
    });
  }

  const rows = LEASE_CHARGE_CATEGORIES.map((chargeCategory) => {
    return (
      byCategory.get(chargeCategory) ?? {
        chargeCategory,
        isBilled: false,
        billingMode: "recurring" as const,
        flatAmountGhs: null,
      }
    );
  });

  return { ok: true, rows };
}

export async function POST(request: Request) {
  const auth = await requireDavorsPlatformRealEstateStaff();
  if (!auth.ok) {
    return auth.response;
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const leaseId = body.lease_id?.trim() ?? "";
  if (!leaseId) {
    return NextResponse.json({ error: "lease_id is required" }, { status: 400 });
  }

  const parsed = parseSettings(body.settings);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
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

  const result = await upsertLeaseChargeSettings(admin, {
    tenantId: landlord.tenantId,
    leaseId,
    settings: parsed.rows,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
