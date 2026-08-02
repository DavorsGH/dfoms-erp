import { NextResponse } from "next/server";
import { requireApprovedLandlordSession } from "@/utils/landlord-portal-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { verifyPaystackTransaction } from "@/utils/paystack";
import { roundGhs } from "@/utils/product-sale-paystack";
import { fulfillSmsCreditPurchase } from "@/utils/sms-credit-paystack";

export const runtime = "nodejs";

type ConfirmBody = {
  purchase_request_id?: string;
  reference?: string;
};

/**
 * Landlord portal: after Paystack Inline success, verify and credit this
 * landlord tenant's SMS wallet. Webhook remains the durable path.
 */
export async function POST(request: Request) {
  const auth = await requireApprovedLandlordSession();
  if (!auth.ok) {
    return auth.response;
  }

  let body: ConfirmBody;
  try {
    body = (await request.json()) as ConfirmBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const purchaseRequestId = body.purchase_request_id?.trim() ?? "";
  const reference = body.reference?.trim() ?? "";
  if (!purchaseRequestId || !reference) {
    return NextResponse.json(
      { error: "purchase_request_id and reference are required" },
      { status: 400 },
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

  const admin = createAdminClient();

  try {
    const result = await fulfillSmsCreditPurchase(admin, {
      purchaseRequestId,
      reference: verified.reference,
      paidAmountGhs,
      paidAt: verified.paidAt,
      metadataTenantId: auth.session.tenantId,
    });

    return NextResponse.json({
      ok: true,
      already_fulfilled: result.alreadyFulfilled,
      purchase_request_id: result.purchaseRequestId,
      credits: result.credits,
      balance: result.balance,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "SMS credit confirmation failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
