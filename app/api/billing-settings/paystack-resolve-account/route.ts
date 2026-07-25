import { NextResponse } from "next/server";
import { requireTenantSuperAdmin } from "@/utils/admin-auth";
import { resolvePaystackAccount } from "@/utils/paystack-subaccounts";

export async function GET(request: Request) {
  const auth = await requireTenantSuperAdmin();
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
    return NextResponse.json({ error: result.error }, { status: 422 });
  }

  return NextResponse.json({ account_name: result.data.accountName });
}
