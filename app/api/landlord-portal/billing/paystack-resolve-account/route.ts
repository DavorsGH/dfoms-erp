import { NextResponse } from "next/server";
import { requirePlatformOnlyLandlordSession } from "@/utils/landlord-portal-auth";
import { resolvePaystackAccount } from "@/utils/paystack-subaccounts";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requirePlatformOnlyLandlordSession();
  if (!auth.ok) {
    return auth.response;
  }

  const { searchParams } = new URL(request.url);
  const accountNumber = searchParams.get("account_number")?.trim() ?? "";
  const bankCode = searchParams.get("bank_code")?.trim() ?? "";

  if (!accountNumber || !bankCode) {
    return NextResponse.json(
      { error: "account_number and bank_code are required." },
      { status: 400 },
    );
  }

  const result = await resolvePaystackAccount({ accountNumber, bankCode });
  if (!result.ok) {
    const status =
      result.httpStatus && result.httpStatus >= 400 ? result.httpStatus : 422;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ account_name: result.data.accountName });
}
