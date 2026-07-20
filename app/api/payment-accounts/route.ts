import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantSuperAdmin } from "@/utils/admin-auth";
import {
  PAYMENT_ACCOUNT_SELECT,
  trimPaymentAccountInput,
  validatePaymentAccountInput,
  type PaymentAccountDeleteBody,
  type PaymentAccountInput,
  type PaymentAccountRow,
  type PaymentAccountUpdateBody,
} from "@/utils/payment-accounts-types";
import { createClient } from "@/utils/supabase/server";

async function getTenantSupabase() {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}

function rejectClientTenantId(body: unknown): NextResponse | null {
  if (body !== null && typeof body === "object" && "tenant_id" in body) {
    return NextResponse.json(
      { error: "tenant_id cannot be set by client" },
      { status: 400 },
    );
  }

  return null;
}

export async function GET() {
  const auth = await requireTenantSuperAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  const supabase = await getTenantSupabase();
  const { data, error } = await supabase
    .from("payment_accounts")
    .select(PAYMENT_ACCOUNT_SELECT)
    .eq("tenant_id", auth.tenantId)
    .order("account_name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    payment_accounts: (data as PaymentAccountRow[] | null) ?? [],
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
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const tenantRejection = rejectClientTenantId(rawBody);
  if (tenantRejection) {
    return tenantRejection;
  }

  const body = rawBody as PaymentAccountInput;
  const validationError = validatePaymentAccountInput(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const trimmed = trimPaymentAccountInput(body);
  const supabase = await getTenantSupabase();

  const { data, error } = await supabase
    .from("payment_accounts")
    .insert({
      tenant_id: auth.tenantId,
      ...trimmed,
      updated_at: new Date().toISOString(),
    })
    .select(PAYMENT_ACCOUNT_SELECT)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ payment_account: data as PaymentAccountRow });
}

export async function PUT(request: Request) {
  const auth = await requireTenantSuperAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const tenantRejection = rejectClientTenantId(rawBody);
  if (tenantRejection) {
    return tenantRejection;
  }

  const body = rawBody as PaymentAccountUpdateBody;
  if (!body.id?.trim()) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const validationError = validatePaymentAccountInput(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const trimmed = trimPaymentAccountInput(body);
  const supabase = await getTenantSupabase();

  const { data: existing, error: fetchError } = await supabase
    .from("payment_accounts")
    .select("id")
    .eq("id", body.id)
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 400 });
  }

  if (!existing) {
    return NextResponse.json({ error: "Payment account not found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("payment_accounts")
    .update({
      ...trimmed,
      updated_at: new Date().toISOString(),
    })
    .eq("id", body.id)
    .eq("tenant_id", auth.tenantId)
    .select(PAYMENT_ACCOUNT_SELECT)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ payment_account: data as PaymentAccountRow });
}

export async function DELETE(request: Request) {
  const auth = await requireTenantSuperAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const tenantRejection = rejectClientTenantId(rawBody);
  if (tenantRejection) {
    return tenantRejection;
  }

  const body = rawBody as PaymentAccountDeleteBody;
  if (!body.id?.trim()) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const supabase = await getTenantSupabase();

  const { data: existing, error: fetchError } = await supabase
    .from("payment_accounts")
    .select("id")
    .eq("id", body.id)
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 400 });
  }

  if (!existing) {
    return NextResponse.json({ error: "Payment account not found" }, { status: 404 });
  }

  const { error } = await supabase
    .from("payment_accounts")
    .delete()
    .eq("id", body.id)
    .eq("tenant_id", auth.tenantId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
