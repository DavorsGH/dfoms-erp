import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  requireTenantRoleIn,
  requireTenantSuperAdmin,
} from "@/utils/admin-auth";
import { notifyStaffNewPaystackSubaccount } from "@/utils/real-estate-staff-notifications";
import {
  createPaystackSubaccount,
  listPaystackBanks,
  resolvePaystackAccount,
  updatePaystackSubaccount,
} from "@/utils/paystack-subaccounts";
import { verifyAndPersistSettlementSubaccount } from "@/utils/paystack-settlement-verification";
import { createClient } from "@/utils/supabase/server";

async function getTenantSupabase() {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}

export async function GET() {
  // Directors may open Online Payments and trigger verify-on-open; only
  // super_admin may POST (save / change) the settlement account.
  const auth = await requireTenantRoleIn(["super_admin", "director"]);
  if (!auth.ok) {
    return auth.response;
  }

  const supabase = await getTenantSupabase();
  const { data, error } = await supabase
    .from("billing_settings")
    .select(
      "paystack_subaccount_code, paystack_subaccount_status, paystack_subaccount_verified_ok, paystack_subaccount_last_verified_at, paystack_subaccount_last_verify_error",
    )
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const subaccountCode = data?.paystack_subaccount_code?.trim() ?? "";
  if (data?.paystack_subaccount_status !== "active" || !subaccountCode) {
    return NextResponse.json({
      account: null,
      verification: {
        verified_ok: false,
        last_verified_at: null,
        last_verify_error: null,
      },
    });
  }

  // Opening Online Payments always re-verifies against Paystack and persists.
  const verification = await verifyAndPersistSettlementSubaccount(auth.tenantId);
  if (!verification) {
    return NextResponse.json(
      { error: "Unable to verify settlement subaccount." },
      { status: 502 },
    );
  }

  if (!verification.verifiedOk) {
    return NextResponse.json({
      account: null,
      verification: {
        verified_ok: false,
        last_verified_at: verification.lastVerifiedAt,
        last_verify_error: verification.lastVerifyError,
      },
      error: verification.lastVerifyError,
    });
  }

  return NextResponse.json({
    account: {
      bank_name: verification.account?.bankName ?? null,
      account_last4: verification.account?.accountLast4 ?? null,
    },
    verification: {
      verified_ok: true,
      last_verified_at: verification.lastVerifiedAt,
      last_verify_error: null,
    },
  });
}

export async function POST(request: Request) {
  const auth = await requireTenantSuperAdmin();
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

  const supabase = await getTenantSupabase();
  const [{ data: tenant, error: tenantError }, resolvedAccount] =
    await Promise.all([
      supabase
        .from("tenants")
        .select("name")
        .eq("id", auth.tenantId)
        .single(),
      resolvePaystackAccount({ accountNumber, bankCode }),
    ]);

  if (tenantError || !tenant?.name?.trim()) {
    return NextResponse.json(
      { error: tenantError?.message ?? "Unable to resolve tenant name." },
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

  // Create once; subsequent Save & Verify updates the existing Paystack
  // subaccount in place so we do not orphan duplicate ACCT_ codes.
  const { data: existingBilling, error: billingLookupError } = await supabase
    .from("billing_settings")
    .select("paystack_subaccount_code")
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();

  if (billingLookupError) {
    return NextResponse.json(
      { error: billingLookupError.message },
      { status: 500 },
    );
  }

  const existingCode =
    existingBilling?.paystack_subaccount_code?.trim() ?? "";
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

  const { error: saveError } = await supabase.from("billing_settings").upsert(
    {
      tenant_id: auth.tenantId,
      paystack_subaccount_code: subaccountCode,
      paystack_subaccount_status: "active",
      // Optimistic until fetch below; verifyAndPersist overwrites.
      paystack_subaccount_verified_ok: true,
      paystack_subaccount_last_verified_at: nowIso,
      paystack_subaccount_last_verify_error: null,
    },
    { onConflict: "tenant_id" },
  );

  if (saveError) {
    return NextResponse.json({ error: saveError.message }, { status: 500 });
  }

  const verification = await verifyAndPersistSettlementSubaccount(auth.tenantId);

  // Best-effort ops email — never block subaccount creation/save.
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
      entityType: "business_tenant",
      entityName: businessName,
      entityTenantId: auth.tenantId,
      bankName,
      accountNumber,
      subaccountCode,
    });
  }

  if (verification && !verification.verifiedOk) {
    return NextResponse.json({
      status: "active",
      account: null,
      verification: {
        verified_ok: false,
        last_verified_at: verification.lastVerifiedAt,
        last_verify_error: verification.lastVerifyError,
      },
      error: verification.lastVerifyError,
    });
  }

  return NextResponse.json({
    status: "active",
    account: {
      bank_name: verification?.account?.bankName ?? null,
      account_last4:
        verification?.account?.accountLast4 ?? accountNumber.slice(-4),
    },
    verification: {
      verified_ok: verification?.verifiedOk ?? true,
      last_verified_at: verification?.lastVerifiedAt ?? nowIso,
      last_verify_error: null,
    },
  });
}
