import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  requireDividendsRead,
  requireDividendsWrite,
} from "@/lib/finance/dividends-auth";
import {
  validateShareholderPaymentFields,
} from "@/lib/finance/dividends-server";
import {
  enrichShareholdersWithCanDelete,
  fetchTenantShareholders,
} from "@/lib/finance/dividends-load";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";
import type { ShareholderPaymentMethod } from "@/app/dashboard/finance/dividends-types";

type ShareholderBody = {
  tenant_id?: string;
  full_name?: string;
  share_pct?: number;
  staff_id?: string | null;
  tin?: string | null;
  payment_method?: ShareholderPaymentMethod;
  momo_number?: string | null;
  bank_name?: string | null;
  bank_account_number?: string | null;
  is_active?: boolean;
};

export async function GET() {
  const auth = await requireDividendsRead();
  if (!auth.ok) {
    return auth.response;
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const { rows, error } = await fetchTenantShareholders(supabase, auth.tenantId);
  if (error) {
    return NextResponse.json({ error }, { status: 500 });
  }
  const admin = createAdminClient();
  const enriched = await enrichShareholdersWithCanDelete(admin, auth.tenantId, rows);
  if (enriched.error) {
    return NextResponse.json({ error: enriched.error }, { status: 500 });
  }
  return NextResponse.json({ shareholders: enriched.rows });
}

export async function POST(request: Request) {
  const auth = await requireDividendsWrite();
  if (!auth.ok) {
    return auth.response;
  }

  let body: ShareholderBody;
  try {
    body = (await request.json()) as ShareholderBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (body.tenant_id !== undefined) {
    return NextResponse.json(
      { error: "tenant_id cannot be set by client." },
      { status: 400 },
    );
  }

  const fullName = body.full_name?.trim();
  if (!fullName) {
    return NextResponse.json({ error: "Full name is required." }, { status: 400 });
  }

  const sharePct = Number(body.share_pct);
  if (!Number.isFinite(sharePct) || sharePct <= 0 || sharePct > 100) {
    return NextResponse.json(
      { error: "Share percentage must be between 0 and 100." },
      { status: 400 },
    );
  }

  const paymentMethod = body.payment_method ?? "cash";
  const paymentError = validateShareholderPaymentFields({
    payment_method: paymentMethod,
    momo_number: body.momo_number,
    bank_name: body.bank_name,
    bank_account_number: body.bank_account_number,
  });
  if (paymentError) {
    return NextResponse.json({ error: paymentError }, { status: 400 });
  }

  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("tenant_shareholders")
    .insert({
      tenant_id: auth.tenantId,
      full_name: fullName,
      share_pct: sharePct,
      staff_id: body.staff_id?.trim() || null,
      tin: body.tin?.trim() || null,
      payment_method: paymentMethod,
      momo_number: body.momo_number?.trim() || null,
      bank_name: body.bank_name?.trim() || null,
      bank_account_number: body.bank_account_number?.trim() || null,
      is_active: body.is_active !== false,
      created_at: now,
      updated_at: now,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ shareholder: data });
}
