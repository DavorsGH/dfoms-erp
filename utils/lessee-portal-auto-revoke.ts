import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revokeLesseePortalAccess } from "@/utils/email-reuse";
import { sendResendEmail } from "@/utils/resend-email";

export type LesseePortalAutoRevokeResult = {
  revoked: boolean;
  emailAttempted: boolean;
  emailSent: boolean;
  skippedReason?: string;
  error?: string;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * After a lease ends (early terminate or natural expiry): if this lessee has no
 * other active lease with the same landlord, revoke portal access and notify.
 */
export async function maybeRevokeLesseePortalIfNoActiveLeases(
  admin: SupabaseClient,
  args: {
    tenantId: string;
    lesseeId: string;
    /** Lease already ended — excluded from the remaining-active count. */
    endedLeaseId?: string;
  },
): Promise<LesseePortalAutoRevokeResult> {
  const lesseeId = args.lesseeId.trim();
  const tenantId = args.tenantId.trim();
  if (!lesseeId || !tenantId) {
    return {
      revoked: false,
      emailAttempted: false,
      emailSent: false,
      skippedReason: "missing_ids",
    };
  }

  let remainingQuery = admin
    .from("leases")
    .select("lease_id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("lessee_id", lesseeId)
    .eq("status", "active");

  if (args.endedLeaseId?.trim()) {
    remainingQuery = remainingQuery.neq("lease_id", args.endedLeaseId.trim());
  }

  const { count, error: countError } = await remainingQuery;
  if (countError) {
    return {
      revoked: false,
      emailAttempted: false,
      emailSent: false,
      error: countError.message,
    };
  }

  if ((count ?? 0) > 0) {
    return {
      revoked: false,
      emailAttempted: false,
      emailSent: false,
      skippedReason: "other_active_leases",
    };
  }

  const { data: lessee, error: lesseeError } = await admin
    .from("lessees")
    .select("lessee_id, auth_user_id, full_name, email, status")
    .eq("tenant_id", tenantId)
    .eq("lessee_id", lesseeId)
    .maybeSingle();

  if (lesseeError) {
    return {
      revoked: false,
      emailAttempted: false,
      emailSent: false,
      error: lesseeError.message,
    };
  }
  if (!lessee) {
    return {
      revoked: false,
      emailAttempted: false,
      emailSent: false,
      skippedReason: "lessee_not_found",
    };
  }

  const hadPortalLink = Boolean(
    typeof lessee.auth_user_id === "string" && lessee.auth_user_id.trim(),
  );
  const alreadyFormer = lessee.status === "former" && !hadPortalLink;
  if (alreadyFormer) {
    return {
      revoked: false,
      emailAttempted: false,
      emailSent: false,
      skippedReason: "already_former",
    };
  }

  // Nothing to revoke if never linked and already not active — still mark former
  // when they had an invite or active status so the email can be reused.
  const revoke = await revokeLesseePortalAccess(admin, {
    tenantId,
    lesseeId,
  });
  if (!revoke.ok) {
    return {
      revoked: false,
      emailAttempted: false,
      emailSent: false,
      error: revoke.error,
    };
  }

  const email =
    typeof lessee.email === "string" ? lessee.email.trim().toLowerCase() : "";
  if (!email) {
    return {
      revoked: true,
      emailAttempted: false,
      emailSent: false,
      skippedReason: "no_email",
    };
  }

  const displayName =
    typeof lessee.full_name === "string" && lessee.full_name.trim()
      ? lessee.full_name.trim()
      : "there";

  const emailResult = await sendResendEmail({
    to: email,
    subject: "Your Davors Tenant Portal access has ended",
    html: `
      <h2>Tenant Portal access ended</h2>
      <p>Hi ${escapeHtml(displayName)},</p>
      <p>Your access to the Davors Tenant Portal for this landlord has ended because you no longer have an active lease.</p>
      <p>You can no longer sign in to download receipts or other lease documents from the portal.</p>
      <p>If you need copies of receipts or documents, please request them directly from your landlord.</p>
    `,
    text: `Hi ${displayName},\n\nYour access to the Davors Tenant Portal for this landlord has ended because you no longer have an active lease.\n\nYou can no longer sign in to download receipts or other lease documents from the portal.\n\nIf you need copies of receipts or documents, please request them directly from your landlord.\n`,
  });

  return {
    revoked: true,
    emailAttempted: true,
    emailSent: emailResult.ok,
    error: emailResult.ok ? undefined : emailResult.error,
  };
}

export type ExpireLeasesPastEndDateResult = {
  expired: number;
  portalRevoked: number;
  portalEmailsSent: number;
  errors: number;
  entries: Array<{
    leaseId: string;
    tenantId: string;
    lesseeId: string;
    portalRevoked: boolean;
    error?: string;
  }>;
};

/**
 * Marks active leases whose end_date is before asOfDate as expired, frees the
 * unit, and auto-revokes portal access when no other active lease remains.
 */
export async function expireLeasesPastEndDate(
  admin: SupabaseClient,
  options?: { asOfDate?: string; tenantId?: string },
): Promise<ExpireLeasesPastEndDateResult> {
  const asOfDate =
    options?.asOfDate?.trim() || new Date().toISOString().slice(0, 10);
  const tenantId = options?.tenantId?.trim() || undefined;

  let query = admin
    .from("leases")
    .select("lease_id, tenant_id, lessee_id, unit_id, end_date, status")
    .eq("status", "active")
    .lt("end_date", asOfDate);

  if (tenantId) {
    query = query.eq("tenant_id", tenantId);
  }

  const { data: rows, error } = await query;
  if (error) {
    throw new Error(`Failed to load leases past end date: ${error.message}`);
  }

  const result: ExpireLeasesPastEndDateResult = {
    expired: 0,
    portalRevoked: 0,
    portalEmailsSent: 0,
    errors: 0,
    entries: [],
  };

  const nowIso = new Date().toISOString();

  for (const row of rows ?? []) {
    const leaseId = row.lease_id as string;
    const rowTenantId = row.tenant_id as string;
    const lesseeId = row.lessee_id as string;
    const unitId = row.unit_id as string;

    const { error: updateError } = await admin
      .from("leases")
      .update({
        status: "expired",
        updated_at: nowIso,
      })
      .eq("tenant_id", rowTenantId)
      .eq("lease_id", leaseId)
      .eq("status", "active");

    if (updateError) {
      result.errors += 1;
      result.entries.push({
        leaseId,
        tenantId: rowTenantId,
        lesseeId,
        portalRevoked: false,
        error: updateError.message,
      });
      continue;
    }

    if (unitId) {
      await admin
        .from("property_units")
        .update({ status: "vacant", updated_at: nowIso })
        .eq("tenant_id", rowTenantId)
        .eq("unit_id", unitId);
    }

    result.expired += 1;

    const revoke = await maybeRevokeLesseePortalIfNoActiveLeases(admin, {
      tenantId: rowTenantId,
      lesseeId,
      endedLeaseId: leaseId,
    });

    if (revoke.error && !revoke.revoked) {
      result.errors += 1;
    }
    if (revoke.revoked) {
      result.portalRevoked += 1;
    }
    if (revoke.emailSent) {
      result.portalEmailsSent += 1;
    }

    result.entries.push({
      leaseId,
      tenantId: rowTenantId,
      lesseeId,
      portalRevoked: revoke.revoked,
      error: revoke.error,
    });
  }

  return result;
}
