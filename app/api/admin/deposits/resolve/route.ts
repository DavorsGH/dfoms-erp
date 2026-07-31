import { NextResponse } from "next/server";
import { requireDavorsPlatformSuperAdmin } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { assertRealEstateLandlordTenant } from "@/utils/property-management";
import {
  isDepositStatus,
  type DepositStatus,
} from "@/app/dashboard/real-estate/leases-utils";

type ResolveDepositBody = {
  tenant_id?: string;
  deposit_id?: string;
  status?: string;
  amount_returned_ghs?: number | string | null;
  resolution_notes?: string | null;
};

export async function POST(request: Request) {
  const auth = await requireDavorsPlatformSuperAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  let body: ResolveDepositBody;
  try {
    body = (await request.json()) as ResolveDepositBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const depositId = body.deposit_id?.trim() ?? "";
  const status = body.status?.trim() ?? "";
  if (!depositId) {
    return NextResponse.json({ error: "deposit_id is required" }, { status: 400 });
  }
  if (
    status !== "returned" &&
    status !== "forfeited" &&
    status !== "partially_forfeited"
  ) {
    return NextResponse.json(
      {
        error:
          "status must be returned, forfeited, or partially_forfeited.",
      },
      { status: 400 },
    );
  }
  if (!isDepositStatus(status)) {
    return NextResponse.json({ error: "Invalid deposit status." }, { status: 400 });
  }

  const admin = createAdminClient();
  const landlord = await assertRealEstateLandlordTenant(
    admin,
    body.tenant_id ?? "",
  );
  if (!landlord.ok) {
    return NextResponse.json(
      { error: landlord.error },
      { status: landlord.status },
    );
  }

  const { data: deposit, error: depositError } = await admin
    .from("security_deposits")
    .select("deposit_id, amount_ghs, status")
    .eq("tenant_id", landlord.tenantId)
    .eq("deposit_id", depositId)
    .maybeSingle();

  if (depositError) {
    return NextResponse.json({ error: depositError.message }, { status: 400 });
  }
  if (!deposit) {
    return NextResponse.json({ error: "Deposit not found." }, { status: 404 });
  }
  if (deposit.status !== "held") {
    return NextResponse.json(
      { error: "Only held deposits can be resolved." },
      { status: 400 },
    );
  }

  const fullAmount = Number(deposit.amount_ghs);
  let amountReturned = 0;
  if (status === "returned") {
    amountReturned = fullAmount;
  } else if (status === "forfeited") {
    amountReturned = 0;
  } else {
    const parsed = Number(body.amount_returned_ghs);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > fullAmount) {
      return NextResponse.json(
        {
          error:
            "amount_returned_ghs must be between 0 and the full deposit amount.",
        },
        { status: 400 },
      );
    }
    amountReturned = parsed;
  }

  const today = new Date().toISOString().slice(0, 10);
  const { error } = await admin
    .from("security_deposits")
    .update({
      status: status as DepositStatus,
      amount_returned_ghs: amountReturned,
      date_resolved: today,
      resolution_notes: body.resolution_notes?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", landlord.tenantId)
    .eq("deposit_id", depositId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
