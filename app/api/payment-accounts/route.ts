import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { PAYMENT_AND_LEAVE_APPROVER_ROLES } from "@/utils/rbac-access";
import {
  countPaymentAccountUsage,
  linkPaymentAccountToBusinessUnit,
  loadPaymentAccountById,
  loadPaymentAccountsForTenant,
  replacePaymentAccountBusinessUnits,
  unlinkPaymentAccountFromBusinessUnit,
} from "@/utils/payment-accounts-server";
import {
  PAYMENT_ACCOUNT_FK_TABLE_LABELS,
  PAYMENT_ACCOUNT_IN_USE_CODE,
  PAYMENT_ACCOUNT_IN_USE_TITLE,
  formatPaymentAccountInUseBody,
} from "@/utils/payment-account-usage";
import {
  PAYMENT_ACCOUNT_SELECT,
  normalizePaymentAccountBusinessUnitIds,
  trimPaymentAccountInput,
  validatePaymentAccountInput,
  type PaymentAccountDeleteBody,
  type PaymentAccountInput,
  type PaymentAccountUpdateBody,
} from "@/utils/payment-accounts-types";
import {
  extractPostgresForeignKeyConstraintName,
  extractPostgresForeignKeyReferencingTable,
  formatFriendlyForeignKeyDeleteMessage,
  isPostgresForeignKeyViolation,
} from "@/utils/postgres-fk-violation";
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
  const auth = await requireTenantRoleIn(PAYMENT_AND_LEAVE_APPROVER_ROLES);
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
  const auth = await requireTenantRoleIn(PAYMENT_AND_LEAVE_APPROVER_ROLES);
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
  const auth = await requireTenantRoleIn(PAYMENT_AND_LEAVE_APPROVER_ROLES);
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
  const auth = await requireTenantRoleIn(PAYMENT_AND_LEAVE_APPROVER_ROLES);
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

  const accountId = body.id.trim();
  const existing = await loadPaymentAccountById(
    supabase,
    auth.tenantId,
    accountId,
  );

  if (!existing) {
    return NextResponse.json({ error: "Payment account not found" }, { status: 404 });
  }

  const usage = await countPaymentAccountUsage(
    supabase,
    auth.tenantId,
    accountId,
  );

  if (usage.total > 0) {
    const errorBody = formatPaymentAccountInUseBody({
      accountName: existing.account_name,
      usage,
    });
    return NextResponse.json(
      {
        error: errorBody,
        code: PAYMENT_ACCOUNT_IN_USE_CODE,
        title: PAYMENT_ACCOUNT_IN_USE_TITLE,
        accountName: existing.account_name,
        usageCount: usage.total,
        usageLabels: usage.labels,
        canDeactivate: true,
      },
      { status: 409 },
    );
  }

  const { error } = await supabase
    .from("payment_accounts")
    .delete()
    .eq("id", accountId)
    .eq("tenant_id", auth.tenantId);

  if (error) {
    if (isPostgresForeignKeyViolation(error)) {
      const constraint = extractPostgresForeignKeyConstraintName(error.message);
      const onTable = extractPostgresForeignKeyReferencingTable(error.message);
      const linkedLabel =
        (constraint && PAYMENT_ACCOUNT_FK_TABLE_LABELS[constraint]) ||
        (onTable && PAYMENT_ACCOUNT_FK_TABLE_LABELS[onTable]) ||
        null;
      const friendly = formatFriendlyForeignKeyDeleteMessage(error.message, {
        itemName: existing.account_name,
        linkedLabel,
        canDeactivateHint: true,
      });
      return NextResponse.json(
        {
          error: friendly,
          code: PAYMENT_ACCOUNT_IN_USE_CODE,
          title: PAYMENT_ACCOUNT_IN_USE_TITLE,
          accountName: existing.account_name,
          canDeactivate: true,
        },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { error: "Unable to delete payment account. Try again." },
      { status: 400 },
    );
  }

  return NextResponse.json({ success: true });
}
