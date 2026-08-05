import { NextResponse } from "next/server";
import { requirePlatformOnlyLandlordSession } from "@/utils/landlord-portal-auth";
import { notifyStaffNewPaystackSubaccount } from "@/utils/real-estate-staff-notifications";
import {
  createPaystackSubaccount,
  getPaystackSubaccount,
  listPaystackBanks,
  resolvePaystackAccount,
  updatePaystackSubaccount,
} from "@/utils/paystack-subaccounts";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requirePlatformOnlyLandlordSession();
  if (!auth.ok) {
    return auth.response;
  }

  const { data, error } = await auth.admin
    .from("landlords")
    .select("paystack_subaccount_code, paystack_subaccount_status")
    .eq("tenant_id", auth.session.tenantId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const subaccountCode = data?.paystack_subaccount_code?.trim() ?? "";
  if (data?.paystack_subaccount_status !== "active" || !subaccountCode) {
    return NextResponse.json({ account: null });
  }

  const result = await getPaystackSubaccount(subaccountCode);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  return NextResponse.json({
    account: {
      bank_name: result.data.bankName,
      account_last4: result.data.accountLast4,
    },
  });
}

export async function POST(request: Request) {
  const auth = await requirePlatformOnlyLandlordSession();
  if (!auth.ok) {
    return auth.response;
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!rawBody || typeof rawBody !== "object") {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if ("tenant_id" in rawBody) {
    return NextResponse.json(
      { error: "tenant_id cannot be set by client." },
      { status: 400 },
    );
  }

  const body = rawBody as {
    bank_code?: unknown;
    account_number?: unknown;
  };
  const bankCode =
    typeof body.bank_code === "string" ? body.bank_code.trim() : "";
  const accountNumber =
    typeof body.account_number === "string" ? body.account_number.trim() : "";

  if (!bankCode || !accountNumber) {
    return NextResponse.json(
      { error: "bank_code and account_number are required." },
      { status: 400 },
    );
  }

  const tenantId = auth.session.tenantId;
  const [{ data: tenant, error: tenantError }, resolvedAccount] =
    await Promise.all([
      auth.admin.from("tenants").select("name").eq("id", tenantId).single(),
      resolvePaystackAccount({ accountNumber, bankCode }),
    ]);

  if (tenantError || !tenant?.name?.trim()) {
    return NextResponse.json(
      { error: tenantError?.message ?? "Unable to resolve workspace name." },
      { status: 500 },
    );
  }

  if (!resolvedAccount.ok) {
    const status =
      resolvedAccount.httpStatus && resolvedAccount.httpStatus >= 400
        ? resolvedAccount.httpStatus
        : 422;
    return NextResponse.json({ error: resolvedAccount.error }, { status });
  }

  const { data: existingLandlord, error: landlordLookupError } = await auth.admin
    .from("landlords")
    .select("paystack_subaccount_code")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (landlordLookupError) {
    return NextResponse.json(
      { error: landlordLookupError.message },
      { status: 500 },
    );
  }

  const existingCode =
    existingLandlord?.paystack_subaccount_code?.trim() ?? "";
  const isNewSubaccount = !existingCode;
  const businessName = tenant.name.trim();

  const paystackResult = existingCode
    ? await updatePaystackSubaccount({
        subaccountCode: existingCode,
        businessName,
        bankCode,
        accountNumber,
      })
    : await createPaystackSubaccount({
        businessName,
        bankCode,
        accountNumber,
      });

  if (!paystackResult.ok) {
    return NextResponse.json({ error: paystackResult.error }, { status: 502 });
  }

  const subaccountCode = existingCode || paystackResult.data.subaccountCode;
  const nowIso = new Date().toISOString();

  const { error: saveError } = await auth.admin
    .from("landlords")
    .update({
      paystack_subaccount_code: subaccountCode,
      paystack_subaccount_status: "active",
      updated_at: nowIso,
    })
    .eq("tenant_id", tenantId);

  if (saveError) {
    return NextResponse.json({ error: saveError.message }, { status: 500 });
  }

  if (isNewSubaccount) {
    let bankName = "";
    try {
      const banks = await listPaystackBanks();
      if (banks.ok) {
        bankName =
          banks.data.find((bank) => bank.code === bankCode)?.name?.trim() ?? "";
      }
    } catch {
      // Ignore bank lookup failures for the notification.
    }

    void notifyStaffNewPaystackSubaccount({
      entityType: "platform_only_landlord",
      entityName: businessName,
      entityTenantId: tenantId,
      bankName,
      accountNumber,
      subaccountCode,
    });
  }

  return NextResponse.json({
    status: "active",
    account: {
      bank_name: null,
      account_last4: accountNumber.slice(-4),
    },
  });
}
