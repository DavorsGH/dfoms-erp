import { NextResponse } from "next/server";
import { requireDavorsPlatformSuperAdmin } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { updatePlatformOnlyUnitActivationPriceGhs } from "@/utils/platform-billing-config";

type UpdatePlatformBillingBody = {
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
  const result = await updatePlatformOnlyUnitActivationPriceGhs(admin, price_ghs);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    price_ghs,
    updated_at: new Date().toISOString(),
  });
}
