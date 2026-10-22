import { NextResponse } from "next/server";
import { requireDividendsWrite } from "@/lib/finance/dividends-auth";
import { SHAREHOLDER_DELETE_BLOCKED_MESSAGE } from "@/lib/finance/dividends-load";
import {
  validateShareholderPaymentFields,
} from "@/lib/finance/dividends-server";
import {
  responseForDirectorsPostgrestError,
  responseForShareholderWriteError,
} from "@/lib/finance/directors-board-api-errors";
import { createAdminClient } from "@/utils/supabase/admin";
import type { ShareholderPaymentMethod } from "@/app/dashboard/finance/dividends-types";

type ShareholderPatchBody = {
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

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireDividendsWrite();
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;
  let body: ShareholderPatchBody;
  try {
    body = (await request.json()) as ShareholderPatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (body.tenant_id !== undefined) {
    return NextResponse.json(
      { error: "tenant_id cannot be set by client." },
      { status: 400 },
    );
  }

  const patchFieldKeys = (
    [
      "full_name",
      "share_pct",
      "staff_id",
      "tin",
      "payment_method",
      "momo_number",
      "bank_name",
      "bank_account_number",
      "is_active",
    ] as const
  ).filter((key) => body[key] !== undefined);

  const admin = createAdminClient();
  const { data: existing, error: loadError } = await admin
    .from("tenant_shareholders")
    .select(
      "id, full_name, share_pct, staff_id, tin, payment_method, momo_number, bank_name, bank_account_number, is_active",
    )
    .eq("tenant_id", auth.tenantId)
    .eq("id", id)
    .maybeSingle();

  if (loadError) {
    return responseForDirectorsPostgrestError(loadError, "shareholders-patch-load");
  }
  if (!existing) {
    return NextResponse.json({ error: "Shareholder not found." }, { status: 404 });
  }

  const isActiveOnlyPatch =
    patchFieldKeys.length === 1 && patchFieldKeys[0] === "is_active";

  if (isActiveOnlyPatch) {
    if (typeof body.is_active !== "boolean") {
      return NextResponse.json(
        { error: "is_active must be true or false." },
        { status: 400 },
      );
    }
    const { data, error } = await admin
      .from("tenant_shareholders")
      .update({
        is_active: body.is_active,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", auth.tenantId)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return responseForDirectorsPostgrestError(error, "shareholders-patch-active");
    }

    return NextResponse.json({ shareholder: data });
  }

  const paymentMethod =
    body.payment_method ??
    (existing.payment_method as ShareholderPaymentMethod);
  const paymentError = validateShareholderPaymentFields({
    payment_method: paymentMethod,
    momo_number:
      body.momo_number !== undefined ? body.momo_number : existing.momo_number,
    bank_name: body.bank_name !== undefined ? body.bank_name : existing.bank_name,
    bank_account_number:
      body.bank_account_number !== undefined
        ? body.bank_account_number
        : existing.bank_account_number,
  });
  if (paymentError) {
    return NextResponse.json({ error: paymentError }, { status: 400 });
  }

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (body.full_name !== undefined) {
    const name = body.full_name.trim();
    if (!name) {
      return NextResponse.json({ error: "Full name is required." }, { status: 400 });
    }
    patch.full_name = name;
  }
  if (body.share_pct !== undefined) {
    const sharePct = Number(body.share_pct);
    if (!Number.isFinite(sharePct) || sharePct <= 0 || sharePct > 100) {
      return NextResponse.json(
        { error: "Share percentage must be between 0 and 100." },
        { status: 400 },
      );
    }
    patch.share_pct = sharePct;
  }
  if (body.staff_id !== undefined) patch.staff_id = body.staff_id?.trim() || null;
  if (body.tin !== undefined) patch.tin = body.tin?.trim() || null;
  if (body.payment_method !== undefined) patch.payment_method = body.payment_method;
  if (body.momo_number !== undefined) patch.momo_number = body.momo_number?.trim() || null;
  if (body.bank_name !== undefined) patch.bank_name = body.bank_name?.trim() || null;
  if (body.bank_account_number !== undefined) {
    patch.bank_account_number = body.bank_account_number?.trim() || null;
  }
  if (body.is_active !== undefined) patch.is_active = body.is_active;

  const { data, error } = await admin
    .from("tenant_shareholders")
    .update(patch)
    .eq("tenant_id", auth.tenantId)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    const nameForDuplicate =
      (patch.full_name as string | undefined) ??
      body.full_name?.trim() ??
      existing.full_name;
    return responseForShareholderWriteError(
      error,
      nameForDuplicate,
      "shareholders-patch",
    );
  }

  return NextResponse.json({ shareholder: data });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireDividendsWrite();
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;
  const admin = createAdminClient();

  const { data: existing, error: loadError } = await admin
    .from("tenant_shareholders")
    .select("id")
    .eq("tenant_id", auth.tenantId)
    .eq("id", id)
    .maybeSingle();

  if (loadError) {
    return responseForDirectorsPostgrestError(loadError, "shareholders-delete-load");
  }
  if (!existing) {
    return NextResponse.json({ error: "Shareholder not found." }, { status: 404 });
  }

  const { count, error: lineError } = await admin
    .from("dividend_declaration_lines")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", auth.tenantId)
    .eq("shareholder_id", id);

  if (lineError) {
    return responseForDirectorsPostgrestError(lineError, "shareholders-delete-lines");
  }
  if ((count ?? 0) > 0) {
    return NextResponse.json(
      { error: SHAREHOLDER_DELETE_BLOCKED_MESSAGE },
      { status: 400 },
    );
  }

  const { error: deleteError } = await admin
    .from("tenant_shareholders")
    .delete()
    .eq("tenant_id", auth.tenantId)
    .eq("id", id);

  if (deleteError) {
    return responseForDirectorsPostgrestError(deleteError, "shareholders-delete");
  }

  return NextResponse.json({ ok: true });
}
