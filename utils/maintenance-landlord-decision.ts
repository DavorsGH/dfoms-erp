import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applySelfFixRentCredit,
  notifyMaintenanceLandlordDecision,
} from "@/utils/maintenance-self-fix";
import { roundPayoutMoney } from "@/app/dashboard/real-estate/payouts-utils";

export type MaintenanceLandlordDecisionResult =
  | {
      ok: true;
      landlordApprovalStatus: "approved" | "rejected";
      selfFix?: boolean;
      rentCreditEntryId?: string;
      creditGhs?: number;
      escrowBalanceAfterGhs?: number;
    }
  | { ok: false; error: string; status: number };

/**
 * Shared approve/reject for maintenance landlord approval.
 * Staff (davors_managed): applyEscrowOnApprove=true for non-self-fix.
 * Landlord portal (platform_only): applyEscrowOnApprove=false (no escrow).
 */
export async function processMaintenanceLandlordDecision(
  admin: SupabaseClient,
  options: {
    tenantId: string;
    requestId: string;
    decision: "approve" | "reject";
    applyEscrowOnApprove: boolean;
    /** Confirmed self-fix cost; when set, written to proposed_cost_ghs before credit. */
    confirmedCostGhs?: number | null;
  },
): Promise<MaintenanceLandlordDecisionResult> {
  const requestId = options.requestId.trim();
  if (!requestId) {
    return { ok: false, error: "request_id is required", status: 400 };
  }
  if (options.decision !== "approve" && options.decision !== "reject") {
    return {
      ok: false,
      error: "decision must be approve or reject.",
      status: 400,
    };
  }

  const { data: existing, error: existingError } = await admin
    .from("maintenance_requests")
    .select(
      "request_id, lease_id, description, cost_ghs, landlord_approval_status, tenant_self_fix, proposed_cost_ghs, rent_credit_entry_id, reported_by",
    )
    .eq("tenant_id", options.tenantId)
    .eq("request_id", requestId)
    .maybeSingle();

  if (existingError) {
    return { ok: false, error: existingError.message, status: 400 };
  }
  if (!existing) {
    return { ok: false, error: "Maintenance request not found.", status: 404 };
  }
  if (existing.landlord_approval_status !== "pending") {
    return {
      ok: false,
      error:
        "Only requests with pending landlord approval can be approved or rejected.",
      status: 400,
    };
  }

  const nowIso = new Date().toISOString();
  const selfFix = Boolean(existing.tenant_self_fix);

  const { data: lease } = await admin
    .from("leases")
    .select("lessee_id")
    .eq("tenant_id", options.tenantId)
    .eq("lease_id", existing.lease_id)
    .maybeSingle();

  const { data: lessee } = lease?.lessee_id
    ? await admin
        .from("lessees")
        .select("full_name, email")
        .eq("tenant_id", options.tenantId)
        .eq("lessee_id", lease.lessee_id)
        .maybeSingle()
    : { data: null };

  if (options.decision === "reject") {
    const { error: updateError } = await admin
      .from("maintenance_requests")
      .update({
        landlord_approval_status: "rejected",
        updated_at: nowIso,
      })
      .eq("tenant_id", options.tenantId)
      .eq("request_id", requestId);

    if (updateError) {
      return { ok: false, error: updateError.message, status: 400 };
    }

    await notifyMaintenanceLandlordDecision({
      email: lessee?.email,
      fullName: lessee?.full_name ?? "Tenant",
      approved: false,
      selfFix,
      amountGhs: null,
      description: existing.description,
    });

    return { ok: true, landlordApprovalStatus: "rejected" };
  }

  // --- Approve ---
  if (selfFix) {
    let proposedSource: number | string | null = existing.proposed_cost_ghs;
    if (
      options.confirmedCostGhs !== undefined &&
      options.confirmedCostGhs !== null
    ) {
      const confirmed = Number(options.confirmedCostGhs);
      if (!Number.isFinite(confirmed) || confirmed < 0) {
        return {
          ok: false,
          error: "confirmed_cost_ghs must be a non-negative number.",
          status: 400,
        };
      }
      proposedSource = confirmed;
      const { error: costUpdateError } = await admin
        .from("maintenance_requests")
        .update({
          proposed_cost_ghs: roundPayoutMoney(confirmed),
          updated_at: nowIso,
        })
        .eq("tenant_id", options.tenantId)
        .eq("request_id", requestId);
      if (costUpdateError) {
        return { ok: false, error: costUpdateError.message, status: 400 };
      }
    }

    const proposed = Number(proposedSource);
    if (!Number.isFinite(proposed) || proposed < 0 || proposedSource == null) {
      return {
        ok: false,
        error:
          "proposed_cost_ghs must be set before approving a self-fix request.",
        status: 400,
      };
    }

    if (existing.rent_credit_entry_id) {
      return {
        ok: false,
        error: "Self-fix rent credit was already applied for this request.",
        status: 400,
      };
    }

    const roundedCost = roundPayoutMoney(proposed);

    let creditResult: {
      entryId: string;
      creditGhs: number;
      status: string;
    };
    try {
      creditResult = await applySelfFixRentCredit(admin, {
        tenantId: options.tenantId,
        leaseId: existing.lease_id,
        requestId,
        amountGhs: roundedCost,
      });
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to apply self-fix rent credit.",
        status: 400,
      };
    }

    const { error: updateError } = await admin
      .from("maintenance_requests")
      .update({
        landlord_approval_status: "approved",
        cost_ghs: roundedCost,
        rent_credit_entry_id: creditResult.entryId,
        updated_at: nowIso,
      })
      .eq("tenant_id", options.tenantId)
      .eq("request_id", requestId);

    if (updateError) {
      return { ok: false, error: updateError.message, status: 400 };
    }

    await notifyMaintenanceLandlordDecision({
      email: lessee?.email,
      fullName: lessee?.full_name ?? "Tenant",
      approved: true,
      selfFix: true,
      amountGhs: roundedCost,
      description: existing.description,
    });

    return {
      ok: true,
      landlordApprovalStatus: "approved",
      selfFix: true,
      rentCreditEntryId: creditResult.entryId,
      creditGhs: creditResult.creditGhs,
    };
  }

  // Non-self-fix
  let roundedCost: number | null = null;
  if (existing.cost_ghs != null) {
    const costGhs = Number(existing.cost_ghs);
    if (!Number.isFinite(costGhs) || costGhs < 0) {
      return {
        ok: false,
        error: "cost_ghs must be a non-negative number.",
        status: 400,
      };
    }
    roundedCost = roundPayoutMoney(costGhs);
  }

  if (options.applyEscrowOnApprove) {
    if (roundedCost == null) {
      return {
        ok: false,
        error:
          "cost_ghs must be set before approving a maintenance request for escrow deduction.",
        status: 400,
      };
    }
  }

  const { error: updateError } = await admin
    .from("maintenance_requests")
    .update({
      landlord_approval_status: "approved",
      updated_at: nowIso,
    })
    .eq("tenant_id", options.tenantId)
    .eq("request_id", requestId);

  if (updateError) {
    return { ok: false, error: updateError.message, status: 400 };
  }

  let escrowBalanceAfterGhs: number | undefined;

  if (options.applyEscrowOnApprove && roundedCost != null) {
    const { data: latestEscrow, error: escrowBalanceError } = await admin
      .from("escrow_ledger")
      .select("balance_after_ghs, entry_date, created_at")
      .eq("tenant_id", options.tenantId)
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (escrowBalanceError) {
      return { ok: false, error: escrowBalanceError.message, status: 400 };
    }

    const previousBalance = Number(latestEscrow?.balance_after_ghs) || 0;
    const balanceAfter = roundPayoutMoney(previousBalance - roundedCost);
    escrowBalanceAfterGhs = balanceAfter;

    const { error: escrowError } = await admin.from("escrow_ledger").insert({
      tenant_id: options.tenantId,
      entry_id: crypto.randomUUID(),
      entry_type: "fee_deduction",
      amount_ghs: roundedCost,
      related_rent_ledger_id: null,
      balance_after_ghs: balanceAfter,
      entry_date: nowIso,
      created_at: nowIso,
    });

    if (escrowError) {
      return {
        ok: false,
        error: `Landlord approval saved, but escrow deduction failed: ${escrowError.message}`,
        status: 400,
      };
    }
  }

  await notifyMaintenanceLandlordDecision({
    email: lessee?.email,
    fullName: lessee?.full_name ?? "Tenant",
    approved: true,
    selfFix: false,
    amountGhs: roundedCost,
    description: existing.description,
  });

  return {
    ok: true,
    landlordApprovalStatus: "approved",
    selfFix: false,
    escrowBalanceAfterGhs,
  };
}
