import { NextResponse } from "next/server";
import { requireDavorsPlatformSuperAdmin } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  PLATFORM_ONLY_UNIT_ACTIVATION_CONFIG_KEY,
  PLATFORM_ONLY_UNIT_ANNUAL_CONFIG_KEY,
  PLATFORM_ONLY_UNIT_CAP_CONFIG_KEY,
  updatePlatformOnlyUnitActivationPriceGhs,
  updatePlatformOnlyUnitAnnualPriceGhs,
  updatePlatformOnlyUnitCap,
} from "@/utils/platform-billing-config";

type UpdatePlatformBillingBody = {
  config_key?: string;
  price_ghs?: number;
  unit_cap?: number;
};

export async function POST(request: Request) {
  const auth = await requireDavorsPlatformSuperAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  let body: UpdatePlatformBillingBody;
  try {
    body = (await request.json()) as UpdatePlatformBillingBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { price_ghs, unit_cap } = body;
  const configKey =
    typeof body.config_key === "string" && body.config_key.trim()
      ? body.config_key.trim()
      : PLATFORM_ONLY_UNIT_ACTIVATION_CONFIG_KEY;

  if (configKey === PLATFORM_ONLY_UNIT_CAP_CONFIG_KEY) {
    if (typeof unit_cap !== "number" && typeof price_ghs !== "number") {
      return NextResponse.json(
        { error: "unit_cap is required and must be a whole number" },
        { status: 400 },
      );
    }

    const capValue =
      typeof unit_cap === "number" ? unit_cap : Math.trunc(price_ghs as number);
    if (!Number.isFinite(capValue) || capValue < 0 || !Number.isInteger(capValue)) {
      return NextResponse.json(
        { error: "unit_cap must be a non-negative whole number" },
        { status: 400 },
      );
    }

    const admin = createAdminClient();
    const result = await updatePlatformOnlyUnitCap(admin, capValue);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      config_key: configKey,
      unit_cap: capValue,
      updated_at: new Date().toISOString(),
    });
  }

  if (typeof price_ghs !== "number") {
    return NextResponse.json(
      { error: "price_ghs is required and must be a number" },
      { status: 400 },
    );
  }

  if (price_ghs < 0) {
    return NextResponse.json(
      { error: "price_ghs cannot be negative" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const result =
    configKey === PLATFORM_ONLY_UNIT_ANNUAL_CONFIG_KEY
      ? await updatePlatformOnlyUnitAnnualPriceGhs(admin, price_ghs)
      : configKey === PLATFORM_ONLY_UNIT_ACTIVATION_CONFIG_KEY
        ? await updatePlatformOnlyUnitActivationPriceGhs(admin, price_ghs)
        : { ok: false as const, error: "Unsupported config_key." };

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    config_key: configKey,
    price_ghs,
    updated_at: new Date().toISOString(),
  });
}
