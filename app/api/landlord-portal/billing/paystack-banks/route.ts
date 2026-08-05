import { NextResponse } from "next/server";
import { requirePlatformOnlyLandlordSession } from "@/utils/landlord-portal-auth";
import { listPaystackBanks } from "@/utils/paystack-subaccounts";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requirePlatformOnlyLandlordSession();
  if (!auth.ok) {
    return auth.response;
  }

  const type = new URL(request.url).searchParams.get("type")?.trim() || undefined;
  const result = await listPaystackBanks(type);
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
