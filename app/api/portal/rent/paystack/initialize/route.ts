import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  ghsToPesewas,
  initializePaystackOneOffTransaction,
} from "@/utils/paystack";
import {
  isValidEmail,
  resolveSiteUrlFromRequest,
  roundGhs,
} from "@/utils/product-sale-paystack";
import { getPortalLesseeSession } from "@/utils/lessee-portal-auth";
import {
  canInitiatePortalRentPayment,
  portalRentPaymentBlockedMessage,
} from "@/utils/lease-signature";
import { RENT_LEDGER_PAYSTACK_CONTEXT } from "@/utils/rent-ledger-paystack";
import { rentOutstandingGhs } from "@/app/dashboard/real-estate/rent-ledger-utils";
import type { LandlordType } from "@/app/dashboard/real-estate/landlords-utils";

export const runtime = "nodejs";

type InitializeBody = {
  entry_id?: string;
};

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Tenant Portal: initialize Paystack Inline for the outstanding balance on
 * the current unpaid rent_ledger row (MoMo + card).
 */
export async function POST(request: Request) {
  const session = await getPortalLesseeSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: InitializeBody;
  try {
    body = (await request.json()) as InitializeBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const entryId = body.entry_id?.trim() ?? "";
  if (!entryId) {
    return NextResponse.json({ error: "entry_id is required" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: lease, error: leaseError } = await admin
    .from("leases")
    .select("lease_id, tenant_id, lessee_id, status, signature_status")
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
    return NextResponse.json(
      { error: "No active lease found for your account." },
      { status: 404 },
    );
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

  const { data: entry, error: entryError } = await admin
    .from("rent_ledger")
    .select(
      "entry_id, tenant_id, lease_id, amount_due_ghs, amount_paid_ghs, credit_ghs, status, period_start, period_end",
    )
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

  if (entry.status === "paid") {
    return NextResponse.json(
      { error: "This rent period is already fully paid." },
      { status: 400 },
    );
  }

  const amountDue = roundMoney(Number(entry.amount_due_ghs) || 0);
  const amountPaid = roundMoney(Number(entry.amount_paid_ghs) || 0);
  const creditGhs = roundMoney(Number(entry.credit_ghs) || 0);
  const outstanding = rentOutstandingGhs(amountDue, amountPaid, creditGhs);
  if (outstanding <= 0) {
    return NextResponse.json(
      { error: "Nothing outstanding on this rent entry." },
      { status: 400 },
    );
  }

  const { data: landlord, error: landlordError } = await admin
    .from("landlords")
    .select("landlord_type, paystack_subaccount_code")
    .eq("tenant_id", session.tenantId)
    .maybeSingle();

  if (landlordError) {
    return NextResponse.json({ error: landlordError.message }, { status: 400 });
  }

  const landlordType = landlord?.landlord_type as LandlordType | null;
  if (
    landlordType !== "platform_only" &&
    landlordType !== "davors_managed"
  ) {
    return NextResponse.json(
      { error: "Landlord payment routing is not configured yet." },
      { status: 400 },
    );
  }

  let subaccountCode: string | undefined;
  if (landlordType === "platform_only") {
    const code = landlord?.paystack_subaccount_code?.trim() ?? "";
    if (!code) {
      return NextResponse.json(
        {
          error:
            "Your landlord has not set up Paystack settlement yet. Contact your property manager.",
          code: "landlord_subaccount_required",
        },
        { status: 400 },
      );
    }
    subaccountCode = code;
  }

  const payerEmail =
    session.email && isValidEmail(session.email)
      ? session.email.trim().toLowerCase()
      : `rent+${entryId.slice(0, 8)}@noreply.davorsfacilities.com`;

  const siteUrl = resolveSiteUrlFromRequest(request);
  const callbackUrl = `${siteUrl}/portal/dashboard`;

  const initialized = await initializePaystackOneOffTransaction({
    email: payerEmail,
    amountPesewas: ghsToPesewas(outstanding),
    callbackUrl,
    currency: "GHS",
    channels: ["mobile_money", "card"],
    subaccountCode,
    metadata: {
      context: RENT_LEDGER_PAYSTACK_CONTEXT,
      tenant_id: session.tenantId,
      lessee_id: session.lesseeId,
      lease_id: lease.lease_id,
      entry_id: entry.entry_id,
      landlord_type: landlordType,
      amount_ghs: outstanding,
      flow: "portal_rent_inline",
    },
  });

  if (!initialized.ok) {
    return NextResponse.json({ error: initialized.error }, { status: 502 });
  }

  const nowIso = new Date().toISOString();
  const { error: refError } = await admin
    .from("rent_ledger")
    .update({
      paystack_reference: initialized.reference,
      updated_at: nowIso,
    })
    .eq("tenant_id", session.tenantId)
    .eq("entry_id", entry.entry_id);

  if (refError) {
    return NextResponse.json(
      {
        error: `Paystack initialized but failed to store reference: ${refError.message}`,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    entry_id: entry.entry_id,
    reference: initialized.reference,
    access_code: initialized.accessCode,
    amount_ghs: roundGhs(outstanding),
    landlord_type: landlordType,
  });
}
