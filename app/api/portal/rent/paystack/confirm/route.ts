import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { verifyPaystackTransaction } from "@/utils/paystack";
import { roundGhs } from "@/utils/product-sale-paystack";
import { getPortalLesseeSession } from "@/utils/lessee-portal-auth";
import { fulfillRentLedgerPaystackPayment } from "@/utils/rent-ledger-paystack";

export const runtime = "nodejs";

type ConfirmBody = {
  entry_id?: string;
  reference?: string;
};

/**
 * Tenant Portal: after Paystack Inline success, verify the charge and fulfill
 * rent_ledger (+ escrow for davors_managed). Webhook is the durable path;
 * this is the fast UX path (same pattern as POS MoMo confirm).
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

  const entryId = body.entry_id?.trim() ?? "";
  const reference = body.reference?.trim() ?? "";
  if (!entryId || !reference) {
    return NextResponse.json(
      { error: "entry_id and reference are required" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  const { data: lease, error: leaseError } = await admin
    .from("leases")
    .select("lease_id")
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

  const { data: entry, error: entryError } = await admin
    .from("rent_ledger")
    .select("entry_id, lease_id")
    .eq("tenant_id", session.tenantId)
    .eq("entry_id", entryId)
    .maybeSingle();

  if (entryError) {
    return NextResponse.json({ error: entryError.message }, { status: 400 });
  }
  if (!entry || entry.lease_id !== lease.lease_id) {
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
      entryId,
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
      amount_paid_ghs: result.amountPaidGhs,
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
