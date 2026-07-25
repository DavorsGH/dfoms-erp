import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantSuperAdmin } from "@/utils/admin-auth";
import {
  createPaystackSubaccount,
  getPaystackSubaccount,
  resolvePaystackAccount,
} from "@/utils/paystack-subaccounts";
import { createClient } from "@/utils/supabase/server";

async function getTenantSupabase() {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}

export async function GET() {
  const auth = await requireTenantSuperAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  const supabase = await getTenantSupabase();
  const { data, error } = await supabase
    .from("billing_settings")
    .select("paystack_subaccount_code, paystack_subaccount_status")
    .eq("tenant_id", auth.tenantId)
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

  const created = await createPaystackSubaccount({
    businessName: tenant.name.trim(),
    bankCode,
    accountNumber,
  });
  if (!created.ok) {
    return NextResponse.json({ error: created.error }, { status: 502 });
  }

  const { error: saveError } = await supabase.from("billing_settings").upsert(
    {
      tenant_id: auth.tenantId,
      paystack_subaccount_code: created.data.subaccountCode,
      paystack_subaccount_status: "active",
    },
    { onConflict: "tenant_id" },
  );

  if (saveError) {
    return NextResponse.json({ error: saveError.message }, { status: 500 });
  }

  return NextResponse.json({
    status: "active",
    account: {
      bank_name: null,
      account_last4: accountNumber.slice(-4),
    },
  });
}
