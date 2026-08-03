import { NextResponse } from "next/server";
import { requirePlatformOnlyLandlordSession } from "@/utils/landlord-portal-auth";
import { resolveSiteUrlFromRequest } from "@/utils/product-sale-paystack";
import { activatePlatformOnlyUnitForBilling } from "@/utils/platform-only-unit-billing";
import {
  isUnitStatus,
  type UnitStatus,
} from "@/app/dashboard/real-estate/properties-utils";

type CreateUnitBody = {
  property_id?: string;
  unit_number?: string;
  bedrooms?: number | string | null;
  bathrooms?: number | string | null;
  base_rent_ghs?: number | string;
  status?: string;
  /** When true (default), attempt billing activation after create (post-trial per-unit charge). */
  activate_for_billing?: boolean;
};

function parseOptionalInteger(
  value: number | string | null | undefined,
  field: string,
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (value == null || value === "") {
    return { ok: true, value: null };
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return {
      ok: false,
      error: `${field} must be a non-negative whole number.`,
    };
  }
  return { ok: true, value: parsed };
}

/**
 * platform_only: create a unit on a property in the landlord's own tenant.
 */
export async function POST(request: Request) {
  const auth = await requirePlatformOnlyLandlordSession();
  if (!auth.ok) {
    return auth.response;
  }

  let body: CreateUnitBody;
  try {
    body = (await request.json()) as CreateUnitBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const propertyId = body.property_id?.trim() ?? "";
  if (!propertyId) {
    return NextResponse.json(
      { error: "property_id is required" },
      { status: 400 },
    );
  }

  const { data: property, error: propertyError } = await auth.admin
    .from("properties")
    .select("property_id")
    .eq("tenant_id", auth.session.tenantId)
    .eq("property_id", propertyId)
    .maybeSingle();

  if (propertyError) {
    return NextResponse.json({ error: propertyError.message }, { status: 400 });
  }
  if (!property) {
    return NextResponse.json({ error: "Property not found." }, { status: 404 });
  }

  const unitNumber = body.unit_number?.trim() ?? "";
  if (!unitNumber) {
    return NextResponse.json(
      { error: "unit_number is required" },
      { status: 400 },
    );
  }

  const bedrooms = parseOptionalInteger(body.bedrooms, "bedrooms");
  if (!bedrooms.ok) {
    return NextResponse.json({ error: bedrooms.error }, { status: 400 });
  }
  const bathrooms = parseOptionalInteger(body.bathrooms, "bathrooms");
  if (!bathrooms.ok) {
    return NextResponse.json({ error: bathrooms.error }, { status: 400 });
  }

  const baseRent = Number(body.base_rent_ghs);
  if (!Number.isFinite(baseRent) || baseRent < 0) {
    return NextResponse.json(
      { error: "base_rent_ghs must be a non-negative number." },
      { status: 400 },
    );
  }

  const status = body.status?.trim() ?? "";
  if (!isUnitStatus(status)) {
    return NextResponse.json(
      {
        error:
          "status must be vacant, occupied, under_maintenance, or application_hold.",
      },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const unitId = crypto.randomUUID();

  const { error } = await auth.admin.from("property_units").insert({
    tenant_id: auth.session.tenantId,
    unit_id: unitId,
    property_id: propertyId,
    unit_number: unitNumber,
    bedrooms: bedrooms.value,
    bathrooms: bathrooms.value,
    base_rent_ghs: baseRent,
    status: status as UnitStatus,
    billing_activation_status: "inactive",
    photo_urls: [],
    created_at: now,
    updated_at: now,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const activateForBilling = body.activate_for_billing !== false;
  if (activateForBilling) {
    const siteUrl = resolveSiteUrlFromRequest(request);
    const callbackUrl = `${siteUrl}/landlord-portal/administration/billing/callback`;
    const activation = await activatePlatformOnlyUnitForBilling(auth.admin, {
      tenantId: auth.session.tenantId,
      unitId,
      triggerType: "create",
      billingEmailFallback: auth.session.email,
      callbackUrl,
    });

    if (!activation.ok) {
      return NextResponse.json({
        success: true,
        unit_id: unitId,
        billing_activation_error: activation.error,
      });
    }

    if ("requiresPayment" in activation && activation.requiresPayment) {
      return NextResponse.json({
        success: true,
        unit_id: unitId,
        requires_payment: true,
        amount_ghs: activation.amountGhs,
        reference: activation.reference,
        access_code: activation.accessCode,
      });
    }

    if ("activated" in activation && activation.activated) {
      return NextResponse.json({
        success: true,
        unit_id: unitId,
        billing_activated: true,
        trial: activation.trial,
      });
    }

    return NextResponse.json({
      success: true,
      unit_id: unitId,
      billing_activation_error: "Unexpected activation result.",
    });
  }

  return NextResponse.json({ success: true, unit_id: unitId });
}
