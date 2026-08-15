import { NextResponse } from "next/server";
import { requireDavorsPlatformSuperAdmin } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  PLATFORM_ONLY_UNIT_ACTIVATION_CONFIG_KEY,
  PLATFORM_ONLY_UNIT_ANNUAL_CONFIG_KEY,
  updatePlatformOnlyUnitActivationPriceGhs,
  updatePlatformOnlyUnitAnnualPriceGhs,
} from "@/utils/platform-billing-config";

type UpdatePlatformBillingBody = {
  config_key?: string;
  price_ghs?: number;
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

  const { price_ghs } = body;
  const configKey =
    typeof body.config_key === "string" && body.config_key.trim()
      ? body.config_key.trim()
      : PLATFORM_ONLY_UNIT_ACTIVATION_CONFIG_KEY;

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
