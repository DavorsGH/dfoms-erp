import type { SupabaseClient } from "@supabase/supabase-js";

export const LEASE_SIGNATURE_STATUSES = [
  "unsigned",
  "sent",
  "partially_signed",
  "signed",
] as const;

export type LeaseSignatureStatus = (typeof LEASE_SIGNATURE_STATUSES)[number];

export const LEASE_SIGNATURE_DISCLAIMER =
  "Acknowledgment confirms you have reviewed the lease terms. It is not a legal electronic signature.";

export const LEASE_SIGNATURE_STATUS_OPTIONS: Array<{
  value: LeaseSignatureStatus;
  label: string;
}> = [
  { value: "unsigned", label: "Unsigned" },
  { value: "sent", label: "Sent for acknowledgment" },
  { value: "partially_signed", label: "Partially acknowledged" },
  { value: "signed", label: "Fully acknowledged" },
];

export function isLeaseSignatureStatus(
  value: string | null | undefined,
): value is LeaseSignatureStatus {
  return (
    typeof value === "string" &&
    (LEASE_SIGNATURE_STATUSES as readonly string[]).includes(value)
  );
}

export function formatLeaseSignatureStatus(
  value: string | null | undefined,
): string {
  if (!value) {
    return "—";
  }
  const match = LEASE_SIGNATURE_STATUS_OPTIONS.find(
    (option) => option.value === value,
  );
  return match?.label ?? value.replace(/_/g, " ");
}

/** Portal Paystack rent: allow only after at least one party has acknowledged. */
export function canInitiatePortalRentPayment(
  status: string | null | undefined,
): boolean {
  return status === "partially_signed" || status === "signed";
}

export function portalRentPaymentBlockedMessage(
  status: string | null | undefined,
): string {
  if (status === "unsigned" || !status) {
    return "Rent payment is unavailable until the lease has been sent for acknowledgment and at least one party has acknowledged it.";
  }
  if (status === "sent") {
    return "Rent payment is unavailable until at least one party acknowledges the lease.";
  }
  return "Rent payment is unavailable for this lease signature status.";
}

export function deriveSignatureStatusFromAcks(options: {
  landlordAcknowledgedAt: string | null;
  tenantAcknowledgedAt: string | null;
  previousStatus: LeaseSignatureStatus;
}): LeaseSignatureStatus {
  const hasLandlord = Boolean(options.landlordAcknowledgedAt);
  const hasTenant = Boolean(options.tenantAcknowledgedAt);
  if (hasLandlord && hasTenant) {
    return "signed";
  }
  if (hasLandlord || hasTenant) {
    return "partially_signed";
  }
  if (options.previousStatus === "unsigned") {
    return "unsigned";
  }
  return "sent";
}

export type LeaseSignatureRow = {
  signature_status: string | null;
  landlord_acknowledged_at: string | null;
  tenant_acknowledged_at: string | null;
  landlord_acknowledged_by: string | null;
  tenant_acknowledged_by: string | null;
};

export async function markLeaseSent(options: {
  admin: SupabaseClient;
  tenantId: string;
  leaseId: string;
}): Promise<
  | { ok: true; status: LeaseSignatureStatus; changed: boolean }
  | { ok: false; error: string }
> {
  const { data: lease, error } = await options.admin
    .from("leases")
    .select(
      "lease_id, signature_status, landlord_acknowledged_at, tenant_acknowledged_at",
    )
    .eq("tenant_id", options.tenantId)
    .eq("lease_id", options.leaseId)
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message };
  }
  if (!lease) {
    return { ok: false, error: "Lease not found." };
  }

  const current = isLeaseSignatureStatus(lease.signature_status)
    ? lease.signature_status
    : "unsigned";

  if (current !== "unsigned" && current !== "sent") {
    return {
      ok: false,
      error: `Cannot mark sent when signature status is ${current}.`,
    };
  }

  if (current === "sent") {
    return { ok: true, status: "sent", changed: false };
  }

  const now = new Date().toISOString();
  const { error: updateError } = await options.admin
    .from("leases")
    .update({
      signature_status: "sent",
      updated_at: now,
    })
    .eq("tenant_id", options.tenantId)
    .eq("lease_id", options.leaseId);

  if (updateError) {
    return { ok: false, error: updateError.message };
  }

  return { ok: true, status: "sent", changed: true };
}

export async function acknowledgeLeaseParty(options: {
  admin: SupabaseClient;
  tenantId: string;
  leaseId: string;
  party: "landlord" | "tenant";
  acknowledgedBy: string;
}): Promise<
  | { ok: true; status: LeaseSignatureStatus; changed: boolean }
  | { ok: false; error: string }
> {
  const { data: lease, error } = await options.admin
    .from("leases")
    .select(
      "lease_id, signature_status, landlord_acknowledged_at, tenant_acknowledged_at",
    )
    .eq("tenant_id", options.tenantId)
    .eq("lease_id", options.leaseId)
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message };
  }
  if (!lease) {
    return { ok: false, error: "Lease not found." };
  }

  const current = isLeaseSignatureStatus(lease.signature_status)
    ? lease.signature_status
    : "unsigned";

  if (current === "unsigned") {
    return {
      ok: false,
      error: "Lease must be marked sent before acknowledgment.",
    };
  }

  const now = new Date().toISOString();
  let landlordAt = (lease.landlord_acknowledged_at as string | null) ?? null;
  let tenantAt = (lease.tenant_acknowledged_at as string | null) ?? null;

  const patch: Record<string, string | null> = {
    updated_at: now,
  };

  if (options.party === "landlord") {
    if (landlordAt) {
      return {
        ok: false,
        error: "Landlord has already acknowledged this lease.",
      };
    }
    landlordAt = now;
    patch.landlord_acknowledged_at = now;
    patch.landlord_acknowledged_by = options.acknowledgedBy;
  } else {
    if (tenantAt) {
      return {
        ok: false,
        error: "Tenant has already acknowledged this lease.",
      };
    }
    tenantAt = now;
    patch.tenant_acknowledged_at = now;
    patch.tenant_acknowledged_by = options.acknowledgedBy;
  }

  const nextStatus = deriveSignatureStatusFromAcks({
    landlordAcknowledgedAt: landlordAt,
    tenantAcknowledgedAt: tenantAt,
    previousStatus: current,
  });
  patch.signature_status = nextStatus;

  const { error: updateError } = await options.admin
    .from("leases")
    .update(patch)
    .eq("tenant_id", options.tenantId)
    .eq("lease_id", options.leaseId);

  if (updateError) {
    return { ok: false, error: updateError.message };
  }

  return { ok: true, status: nextStatus, changed: true };
}
