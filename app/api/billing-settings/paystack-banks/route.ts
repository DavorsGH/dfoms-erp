import { NextResponse } from "next/server";
import { requireTenantSuperAdmin } from "@/utils/admin-auth";
import { listPaystackBanks } from "@/utils/paystack-subaccounts";

export async function GET() {
  const auth = await requireTenantSuperAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  const result = await listPaystackBanks();
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  return NextResponse.json(
    { banks: result.data },
    {
      headers: {
        "Cache-Control": "private, max-age=3600",
      },
    },
  );
}
