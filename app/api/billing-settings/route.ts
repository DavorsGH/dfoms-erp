import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantSuperAdmin } from "@/utils/admin-auth";
import {
  BILLING_SETTINGS_SELECT,
  type BillingSettingsRow,
  type BillingSettingsUpdateBody,
} from "@/utils/billing-settings-types";
import { createClient } from "@/utils/supabase/server";

async function getTenantSupabase() {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}

async function loadOrCreateBillingSettings(
  tenantId: string,
): Promise<{ row: BillingSettingsRow | null; error: string | null }> {
  const supabase = await getTenantSupabase();
  const { error: upsertError } = await supabase
    .from("billing_settings")
    .upsert({ tenant_id: tenantId }, {
      onConflict: "tenant_id",
      ignoreDuplicates: false,
    });

  if (upsertError) {
    return { row: null, error: upsertError.message };
  }

  const { data, error: selectError } = await supabase
    .from("billing_settings")
    .select(BILLING_SETTINGS_SELECT)
    .eq("tenant_id", tenantId)
    .single();

  if (selectError) {
    return { row: null, error: selectError.message };
  }

  return { row: data as BillingSettingsRow, error: null };
}

export async function GET() {
  const auth = await requireTenantSuperAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  const { row, error } = await loadOrCreateBillingSettings(auth.tenantId);

  if (error || !row) {
    return NextResponse.json(
      { error: error ?? "Unable to load billing settings." },
      { status: 500 },
    );
  }

  return NextResponse.json({ billing_settings: row });
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

  if (
    rawBody !== null &&
    typeof rawBody === "object" &&
    "tenant_id" in rawBody
  ) {
    return NextResponse.json(
      { error: "tenant_id cannot be set by client" },
      { status: 400 },
    );
  }

  const body = rawBody as BillingSettingsUpdateBody;

  const payload = {
    tenant_id: auth.tenantId,
    email_recipient: (body.email_recipient ?? "").trim(),
    additional_emails: (body.additional_emails ?? "").trim(),
    bill_to_name: (body.bill_to_name ?? "").trim(),
    country_region: (body.country_region ?? "").trim(),
    address_line1: (body.address_line1 ?? "").trim(),
    business_tax_id: (body.business_tax_id ?? "").trim(),
  };

  const supabase = await getTenantSupabase();

  const { data, error } = await supabase
    .from("billing_settings")
    .upsert(payload, { onConflict: "tenant_id" })
    .select(BILLING_SETTINGS_SELECT)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ billing_settings: data as BillingSettingsRow });
}
