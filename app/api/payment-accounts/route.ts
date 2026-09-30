import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantSuperAdmin } from "@/utils/admin-auth";
import {
  linkPaymentAccountToBusinessUnit,
  loadPaymentAccountById,
  loadPaymentAccountsForTenant,
  replacePaymentAccountBusinessUnits,
  unlinkPaymentAccountFromBusinessUnit,
} from "@/utils/payment-accounts-server";
import {
  PAYMENT_ACCOUNT_SELECT,
  normalizePaymentAccountBusinessUnitIds,
  trimPaymentAccountInput,
  validatePaymentAccountInput,
  type PaymentAccountDeleteBody,
  type PaymentAccountInput,
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

  try {
    const payment_accounts = await loadPaymentAccountsForTenant(
      supabase,
      auth.tenantId,
    );
    return NextResponse.json({ payment_accounts });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load payment accounts.",
      },
      { status: 500 },
    );
  }
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
  const availability = body.availability ?? "all";
  const businessUnitIds = normalizePaymentAccountBusinessUnitIds(
    body.business_unit_ids,
  );

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

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Unable to create payment account." },
      { status: 400 },
    );
  }

  const linkError = await replacePaymentAccountBusinessUnits(
    supabase,
    auth.tenantId,
    data.id as string,
    availability,
    businessUnitIds,
  );
  if (linkError) {
    return NextResponse.json({ error: linkError }, { status: 400 });
  }

  const payment_account = await loadPaymentAccountById(
    supabase,
    auth.tenantId,
    data.id as string,
  );

  return NextResponse.json({ payment_account });
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

  const supabase = await getTenantSupabase();

  const existing = await loadPaymentAccountById(
    supabase,
    auth.tenantId,
    body.id.trim(),
  );
  if (!existing) {
    return NextResponse.json({ error: "Payment account not found" }, { status: 404 });
  }

  const linkId = body.link_business_unit_id?.trim();
  if (linkId) {
    const linkError = await linkPaymentAccountToBusinessUnit(
      supabase,
      auth.tenantId,
      existing.id,
      linkId,
    );
    if (linkError) {
      return NextResponse.json({ error: linkError }, { status: 400 });
    }
    const payment_account = await loadPaymentAccountById(
      supabase,
      auth.tenantId,
      existing.id,
    );
    return NextResponse.json({ payment_account });
  }

  const unlinkId = body.unlink_business_unit_id?.trim();
  if (unlinkId) {
    const unlinkError = await unlinkPaymentAccountFromBusinessUnit(
      supabase,
      auth.tenantId,
      existing.id,
      unlinkId,
    );
    if (unlinkError) {
      return NextResponse.json({ error: unlinkError }, { status: 400 });
    }
    const payment_account = await loadPaymentAccountById(
      supabase,
      auth.tenantId,
      existing.id,
    );
    return NextResponse.json({ payment_account });
  }

  const validationError = validatePaymentAccountInput(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const trimmed = trimPaymentAccountInput(body);

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

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Unable to update payment account." },
      { status: 400 },
    );
  }

  if (body.availability !== undefined) {
    const availability = body.availability;
    const businessUnitIds = normalizePaymentAccountBusinessUnitIds(
      body.business_unit_ids,
    );
    const linkError = await replacePaymentAccountBusinessUnits(
      supabase,
      auth.tenantId,
      existing.id,
      availability,
      businessUnitIds,
    );
    if (linkError) {
      return NextResponse.json({ error: linkError }, { status: 400 });
    }
  }

  const payment_account = await loadPaymentAccountById(
    supabase,
    auth.tenantId,
    existing.id,
  );

  return NextResponse.json({ payment_account });
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
