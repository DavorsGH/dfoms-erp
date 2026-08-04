import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  formatDepositStatus,
  isDepositStatus,
  type DepositStatus,
} from "@/app/dashboard/real-estate/leases-utils";

export type SecurityDepositReceiptData = {
  depositId: string;
  tenantId: string;
  leaseId: string;
  receiptReference: string;
  lesseeName: string;
  landlordName: string;
  propertyName: string;
  unitNumber: string;
  unitLabel: string;
  leaseStartDate: string;
  leaseEndDate: string;
  amountGhs: number;
  status: DepositStatus;
  statusLabel: string;
  dateCollected: string;
  dateResolved: string | null;
  amountReturnedGhs: number | null;
  resolutionNotes: string | null;
};

function toNumber(value: unknown): number | null {
  if (value == null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function fetchSecurityDepositReceipt(
  admin: SupabaseClient,
  options: {
    tenantId: string;
    depositId: string;
    lesseeId?: string | null;
  },
): Promise<{ receipt: SecurityDepositReceiptData | null; error: string | null }> {
  const depositId = options.depositId.trim();
  if (!depositId) {
    return { receipt: null, error: "deposit_id is required" };
  }

  const { data: depositRow, error: depositError } = await admin
    .from("security_deposits")
    .select(
      "deposit_id, lease_id, amount_ghs, status, amount_returned_ghs, date_collected, date_resolved, resolution_notes",
    )
    .eq("tenant_id", options.tenantId)
    .eq("deposit_id", depositId)
    .maybeSingle();

  if (depositError) {
    return { receipt: null, error: depositError.message };
  }
  if (!depositRow) {
    return { receipt: null, error: null };
  }

  if (!isDepositStatus(depositRow.status)) {
    return { receipt: null, error: "Invalid deposit status." };
  }

  const [{ data: lease }, { data: tenantRow }] = await Promise.all([
    admin
      .from("leases")
      .select("lease_id, unit_id, lessee_id, start_date, end_date")
      .eq("tenant_id", options.tenantId)
      .eq("lease_id", depositRow.lease_id)
      .maybeSingle(),
    admin
      .from("tenants")
      .select("name")
      .eq("id", options.tenantId)
      .maybeSingle(),
  ]);

  if (!lease) {
    return { receipt: null, error: "Lease not found for this deposit." };
  }

  if (options.lesseeId && lease.lessee_id !== options.lesseeId) {
    return { receipt: null, error: "Access denied." };
  }

  const { data: unit } = await admin
    .from("property_units")
    .select("unit_id, unit_number, property_id")
    .eq("tenant_id", options.tenantId)
    .eq("unit_id", lease.unit_id)
    .maybeSingle();

  const [{ data: property }, { data: lessee }] = await Promise.all([
    unit
      ? admin
          .from("properties")
          .select("property_id, name")
          .eq("tenant_id", options.tenantId)
          .eq("property_id", unit.property_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    admin
      .from("lessees")
      .select("lessee_id, full_name")
      .eq("tenant_id", options.tenantId)
      .eq("lessee_id", lease.lessee_id)
      .maybeSingle(),
  ]);

  const propertyName = property?.name?.trim() || "—";
  const unitNumber = unit?.unit_number?.trim() || "—";

  return {
    receipt: {
      depositId: depositRow.deposit_id,
      tenantId: options.tenantId,
      leaseId: depositRow.lease_id,
      receiptReference: depositRow.deposit_id,
      lesseeName: lessee?.full_name?.trim() || "—",
      landlordName: tenantRow?.name?.trim() || "—",
      propertyName,
      unitNumber,
      unitLabel: `${propertyName} · ${unitNumber}`,
      leaseStartDate: lease.start_date,
      leaseEndDate: lease.end_date,
      amountGhs: toNumber(depositRow.amount_ghs) ?? 0,
      status: depositRow.status,
      statusLabel: formatDepositStatus(depositRow.status),
      dateCollected: depositRow.date_collected,
      dateResolved: depositRow.date_resolved,
      amountReturnedGhs: toNumber(depositRow.amount_returned_ghs),
      resolutionNotes: depositRow.resolution_notes?.trim() || null,
    },
    error: null,
  };
}

export function depositIsResolved(status: DepositStatus): boolean {
  return status !== "held";
}
