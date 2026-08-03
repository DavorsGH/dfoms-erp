import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { verifyPaystackTransaction } from "@/utils/paystack";
import { roundGhs } from "@/utils/product-sale-paystack";
import { getPortalLesseeSession } from "@/utils/lessee-portal-auth";
import {
  canInitiatePortalRentPayment,
  portalRentPaymentBlockedMessage,
} from "@/utils/lease-signature";
import { fulfillRentLedgerPaystackPayment } from "@/utils/rent-ledger-paystack";

export const runtime = "nodejs";

type ConfirmBody = {
  entry_id?: string;
  entry_ids?: string[];
  reference?: string;
};

/**
 * Tenant Portal: after Paystack Inline success, verify the charge and fulfill
 * rent_ledger rows (+ escrow for davors_managed). Allocates across rent +
 * one-time entries bundled at initialize. Webhook is the durable path.
 */
export async function POST(request: Request) {
  const session = await getPortalLesseeSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: ConfirmBody;
  try {
    body = (await request.json()) as ConfirmBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const reference = body.reference?.trim() ?? "";
  let entryIds = [
    ...new Set(
      [
        ...(Array.isArray(body.entry_ids) ? body.entry_ids : []),
        body.entry_id?.trim() || null,
      ]
        .map((id) => (typeof id === "string" ? id.trim() : ""))
        .filter(Boolean),
    ),
  ];

  if (!reference) {
    return NextResponse.json(
      { error: "entry_id (or entry_ids) and reference are required" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  const { data: lease, error: leaseError } = await admin
    .from("leases")
    .select("lease_id, signature_status")
    .eq("tenant_id", session.tenantId)
    .eq("lessee_id", session.lesseeId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (leaseError) {
    return NextResponse.json({ error: leaseError.message }, { status: 400 });
  }
  if (!lease) {
    return NextResponse.json({ error: "No active lease found." }, { status: 404 });
  }

  if (!canInitiatePortalRentPayment(lease.signature_status as string | null)) {
    return NextResponse.json(
      {
        error: portalRentPaymentBlockedMessage(
          lease.signature_status as string | null,
        ),
      },
      { status: 403 },
    );
  }

  if (entryIds.length === 0) {
    const { data: refRows, error: refLookupError } = await admin
      .from("rent_ledger")
      .select("entry_id")
      .eq("tenant_id", session.tenantId)
      .eq("lease_id", lease.lease_id)
      .eq("paystack_reference", reference);

    if (refLookupError) {
      return NextResponse.json({ error: refLookupError.message }, { status: 400 });
    }

    entryIds = [
      ...new Set(
        ((refRows as Array<{ entry_id: string }> | null) ?? []).map(
          (row) => row.entry_id,
        ),
      ),
    ];
  }

  if (entryIds.length === 0) {
    return NextResponse.json(
      { error: "entry_id (or entry_ids) and reference are required" },
      { status: 400 },
    );
  }

  const { data: entries, error: entryError } = await admin
    .from("rent_ledger")
    .select("entry_id, lease_id")
    .eq("tenant_id", session.tenantId)
    .in("entry_id", entryIds);

  if (entryError) {
    return NextResponse.json({ error: entryError.message }, { status: 400 });
  }
  const rows = (entries as Array<{ entry_id: string; lease_id: string }> | null) ?? [];
  if (rows.length !== entryIds.length) {
    return NextResponse.json(
      { error: "One or more rent ledger entries were not found for your lease." },
      { status: 404 },
    );
  }
  if (rows.some((row) => row.lease_id !== lease.lease_id)) {
    return NextResponse.json(
      { error: "Rent ledger entry not found for your lease." },
      { status: 404 },
    );
  }

  const verified = await verifyPaystackTransaction(reference);
  if (!verified.ok) {
    return NextResponse.json({ error: verified.error }, { status: 502 });
  }
  if (verified.status !== "success") {
    return NextResponse.json(
      {
        error: `Payment not successful yet (status: ${verified.status}).`,
        status: verified.status,
      },
      { status: 409 },
    );
  }

  const paidAmountGhs =
    verified.amount != null ? roundGhs(verified.amount / 100) : null;

  try {
    const result = await fulfillRentLedgerPaystackPayment(admin, {
      entryId: entryIds[0],
      entryIds,
      reference: verified.reference,
      paidAmountGhs,
      paidAt: verified.paidAt,
      channel: verified.channel,
      metadataTenantId: session.tenantId,
      metadataLesseeId: session.lesseeId,
    });

    return NextResponse.json({
      ok: true,
      entry_id: result.entryId,
      entry_ids: result.entryIds,
      amount_paid_ghs: result.amountPaidGhs,
      total_applied_ghs: result.totalAppliedGhs,
      status: result.status,
      verification_status: result.verificationStatus,
      already_fulfilled: result.alreadyFulfilled,
      escrow_balance_after_ghs: result.escrowBalanceAfterGhs,
      reference: verified.reference,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to apply rent payment after Paystack confirmation.",
      },
      { status: 500 },
    );
  }
}
