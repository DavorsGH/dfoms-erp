import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { formatRentMoney } from "@/app/dashboard/real-estate/rent-ledger-utils";
import {
  formatLeaseChargeCategoryLabel,
  isLeaseChargeCategory,
  type LeaseChargeCategory,
} from "@/utils/lease-charge-categories";
import { sendHubtelSms } from "@/utils/hubtel-sms";
import { insertLesseePortalNotification } from "@/utils/lessee-portal-notifications";
import { normalizeGhanaPhone } from "@/utils/product-sale-paystack";
import { sendResendEmail } from "@/utils/resend-email";
import { resolveTenantDisplayName } from "@/utils/tenant-display-name";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Best-effort tenant notification when a one-time rent_ledger charge is created.
 * Matches rent-due / payment-receipt channels: in-app + email + SMS.
 */
export async function notifyLesseeOneTimeChargeAdded(options: {
  admin: SupabaseClient;
  landlordTenantId: string;
  leaseId: string;
  entryId: string;
  description: string;
  amountGhs: number;
  chargeCategory?: LeaseChargeCategory | null;
}): Promise<void> {
  const { data: lease, error: leaseError } = await options.admin
    .from("leases")
    .select("lessee_id, unit_id")
    .eq("tenant_id", options.landlordTenantId)
    .eq("lease_id", options.leaseId)
    .maybeSingle();

  if (leaseError) {
    console.error(
      "[one-time-charge-notify] lease lookup failed:",
      leaseError.message,
    );
    return;
  }

  const lesseeId =
    typeof lease?.lessee_id === "string" ? lease.lessee_id.trim() : "";
  if (!lesseeId) {
    return;
  }

  const [{ data: lessee }, { data: unit }] = await Promise.all([
    options.admin
      .from("lessees")
      .select("full_name, email, phone")
      .eq("tenant_id", options.landlordTenantId)
      .eq("lessee_id", lesseeId)
      .maybeSingle(),
    lease?.unit_id
      ? options.admin
          .from("property_units")
          .select("unit_number, property_id")
          .eq("tenant_id", options.landlordTenantId)
          .eq("unit_id", lease.unit_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  let propertyName = "—";
  if (unit?.property_id) {
    const { data: property } = await options.admin
      .from("properties")
      .select("name")
      .eq("tenant_id", options.landlordTenantId)
      .eq("property_id", unit.property_id)
      .maybeSingle();
    propertyName = property?.name?.trim() || "—";
  }

  const lesseeName = lessee?.full_name?.trim() || "Tenant";
  const tenantName = await resolveTenantDisplayName(
    options.admin,
    options.landlordTenantId,
  );
  const unitNumber = unit?.unit_number?.trim() || "—";
  const amountLabel = formatRentMoney(options.amountGhs);
  const description = options.description.trim();
  const categoryLabel =
    options.chargeCategory && isLeaseChargeCategory(options.chargeCategory)
      ? formatLeaseChargeCategoryLabel(options.chargeCategory)
      : null;
  const chargeLabel = categoryLabel ?? description;
  const place = `${propertyName} / Unit ${unitNumber}`;
  const subject = `New charge on your lease — ${amountLabel}`;
  const lead = categoryLabel
    ? `A ${categoryLabel} charge of ${amountLabel} was added to your lease.`
    : `A one-time charge of ${amountLabel} was added to your lease: ${description}.`;
  const body = [lead, `Property: ${place}`, "Sign in to your portal to pay."].join(
    "\n",
  );

  const text = [
    `Hi ${lesseeName},`,
    "",
    lead,
    `Property: ${place}`,
    "",
    "Sign in to your tenant portal to review and pay this charge.",
    "Thank you.",
    "Davors Facilities",
  ].join("\n");

  const html = `<p>Hi ${escapeHtml(lesseeName)},</p>
<p>${escapeHtml(lead)}</p>
<p>Property: ${escapeHtml(place)}</p>
<p>Sign in to your tenant portal to review and pay this charge.<br/>Thank you.<br/>Davors Facilities</p>`;

  const email = typeof lessee?.email === "string" ? lessee.email.trim() : "";
  if (email) {
    const result = await sendResendEmail({
      to: email,
      subject,
      html,
      text,
    });
    if (!result.ok) {
      console.error(
        "[one-time-charge-notify] lessee email failed:",
        result.error,
      );
    }
  }

  const phone = normalizeGhanaPhone(lessee?.phone);
  if (phone) {
    const sms = `Davors: New charge ${amountLabel} (${chargeLabel}) on ${place}. Sign in to your portal to pay.`;
    const result = await sendHubtelSms({
      to: phone,
      content: sms,
      tenantName,
      recipientName: lesseeName,
    });
    if (!result.ok) {
      console.error("[one-time-charge-notify] lessee SMS failed:", result.error);
    }
  }

  await insertLesseePortalNotification({
    landlordTenantId: options.landlordTenantId,
    lesseeId,
    title: "New charge on your lease",
    body,
    actionUrl: "/portal/dashboard",
    context: `one-time-charge:${options.entryId}`,
  });
}
