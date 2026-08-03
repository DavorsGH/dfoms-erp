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
  /** Primary unpaid rent entry (optional when only one-time charges remain). */
  entry_id?: string;
  /** Explicit bundle; when omitted, rent entry + all outstanding one_time for the lease. */
  entry_ids?: string[];
};

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

type LedgerPayRow = {
  entry_id: string;
  tenant_id: string;
  lease_id: string;
  charge_type: string | null;
  amount_due_ghs: number | string;
  amount_paid_ghs: number | string;
  credit_ghs: number | string | null;
  status: string;
  period_start: string;
  period_end: string;
};

/**
 * Tenant Portal: initialize Paystack Inline for outstanding rent + all
 * outstanding one-time charges on the lease (one bundled transaction).
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

  const requestedIds = [
    ...new Set(
      [
        ...(Array.isArray(body.entry_ids) ? body.entry_ids : []),
        body.entry_id?.trim() || null,
      ]
        .map((id) => (typeof id === "string" ? id.trim() : ""))
        .filter(Boolean),
    ),
  ];

  let candidates: LedgerPayRow[] = [];

  if (requestedIds.length > 0) {
    const { data, error } = await admin
      .from("rent_ledger")
      .select(
        "entry_id, tenant_id, lease_id, charge_type, amount_due_ghs, amount_paid_ghs, credit_ghs, status, period_start, period_end",
      )
      .eq("tenant_id", session.tenantId)
      .eq("lease_id", lease.lease_id)
      .in("entry_id", requestedIds);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    candidates = (data as LedgerPayRow[] | null) ?? [];
    if (candidates.length !== requestedIds.length) {
      return NextResponse.json(
        { error: "One or more ledger entries were not found for your lease." },
        { status: 404 },
      );
    }
  } else {
    // Auto-bundle: unpaid rent periods + outstanding one-time charges.
    const { data, error } = await admin
      .from("rent_ledger")
      .select(
        "entry_id, tenant_id, lease_id, charge_type, amount_due_ghs, amount_paid_ghs, credit_ghs, status, period_start, period_end",
      )
      .eq("tenant_id", session.tenantId)
      .eq("lease_id", lease.lease_id)
      .neq("status", "paid")
      .order("period_start", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    candidates = (data as LedgerPayRow[] | null) ?? [];
  }

  // Always include outstanding one_time even when a specific rent entry_id was sent.
  if (requestedIds.length > 0) {
    const { data: oneTimeRows, error: oneTimeError } = await admin
      .from("rent_ledger")
      .select(
        "entry_id, tenant_id, lease_id, charge_type, amount_due_ghs, amount_paid_ghs, credit_ghs, status, period_start, period_end",
      )
      .eq("tenant_id", session.tenantId)
      .eq("lease_id", lease.lease_id)
      .eq("charge_type", "one_time")
      .neq("status", "paid");

    if (oneTimeError) {
      return NextResponse.json({ error: oneTimeError.message }, { status: 400 });
    }

    const byId = new Map(candidates.map((row) => [row.entry_id, row]));
    for (const row of (oneTimeRows as LedgerPayRow[] | null) ?? []) {
      byId.set(row.entry_id, row);
    }
    candidates = [...byId.values()];
  }

  const payable = candidates
    .map((row) => {
      const amountDue = roundMoney(Number(row.amount_due_ghs) || 0);
      const amountPaid = roundMoney(Number(row.amount_paid_ghs) || 0);
      const creditGhs = roundMoney(Number(row.credit_ghs) || 0);
      const outstanding = rentOutstandingGhs(amountDue, amountPaid, creditGhs);
      return { row, outstanding };
    })
    .filter((item) => item.row.status !== "paid" && item.outstanding > 0);

  if (payable.length === 0) {
    return NextResponse.json(
      { error: "Nothing outstanding on rent or other charges." },
      { status: 400 },
    );
  }

  // Prefer a single current rent row when auto-bundling many rent periods:
  // keep the newest unpaid rent + all one_time (matches prior portal behaviour).
  const rentPayable = payable.filter(
    (item) => (item.row.charge_type ?? "rent") === "rent",
  );
  const oneTimePayable = payable.filter(
    (item) => item.row.charge_type === "one_time",
  );
  let selected = [...oneTimePayable];
  if (rentPayable.length > 0) {
    const newestRent = [...rentPayable].sort((a, b) =>
      b.row.period_start.localeCompare(a.row.period_start),
    )[0];
    selected = [newestRent, ...oneTimePayable];
  }

  // If caller passed explicit rent entry ids, honour those rent rows + one_time.
  if (requestedIds.length > 0) {
    const requestedSet = new Set(requestedIds);
    const requestedRent = payable.filter(
      (item) =>
        (item.row.charge_type ?? "rent") === "rent" &&
        requestedSet.has(item.row.entry_id),
    );
    selected =
      requestedRent.length > 0
        ? [...requestedRent, ...oneTimePayable]
        : [...oneTimePayable];
    if (selected.length === 0) {
      selected = payable.filter((item) => requestedSet.has(item.row.entry_id));
    }
  }

  const totalOutstanding = roundMoney(
    selected.reduce((sum, item) => sum + item.outstanding, 0),
  );
  if (totalOutstanding <= 0) {
    return NextResponse.json(
      { error: "Nothing outstanding on rent or other charges." },
      { status: 400 },
    );
  }

  const entryIds = selected.map((item) => item.row.entry_id);
  const primaryEntryId = entryIds[0];

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
      : `rent+${primaryEntryId.slice(0, 8)}@noreply.davorsfacilities.com`;

  const siteUrl = resolveSiteUrlFromRequest(request);
  const callbackUrl = `${siteUrl}/portal/dashboard`;

  const initialized = await initializePaystackOneOffTransaction({
    email: payerEmail,
    amountPesewas: ghsToPesewas(totalOutstanding),
    callbackUrl,
    currency: "GHS",
    channels: ["mobile_money", "card"],
    subaccountCode,
    metadata: {
      context: RENT_LEDGER_PAYSTACK_CONTEXT,
      tenant_id: session.tenantId,
      lessee_id: session.lesseeId,
      lease_id: lease.lease_id,
      entry_id: primaryEntryId,
      entry_ids: entryIds,
      landlord_type: landlordType,
      amount_ghs: totalOutstanding,
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
    .in("entry_id", entryIds);

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
    entry_id: primaryEntryId,
    entry_ids: entryIds,
    reference: initialized.reference,
    access_code: initialized.accessCode,
    amount_ghs: roundGhs(totalOutstanding),
    landlord_type: landlordType,
  });
}
