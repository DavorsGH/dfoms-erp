import "server-only";

import { sendHubtelSms } from "@/utils/hubtel-sms";
import { normalizeGhanaPhone } from "@/utils/product-sale-paystack";
import { tryDebitSmsCredit } from "@/utils/sms-credit";
import { createAdminClient } from "@/utils/supabase/admin";
import { insertEmployeeInAppNotifications } from "@/utils/employee-in-app-notifications";
import { resolveTenantDisplayName } from "@/utils/tenant-display-name";

const ADMIN_DIRECTOR_ROLES = ["super_admin", "director"] as const;

/**
 * Fan-out an in-app notification to every active Admin (super_admin) and Director
 * in the tenant. Best-effort — never throws.
 */
export async function notifyTenantAdminsAndDirectors(
  tenantId: string,
  title: string,
  body: string,
  actionUrl?: string | null,
): Promise<void> {
  const normalizedTenantId = tenantId.trim();
  const normalizedTitle = title.trim();
  const normalizedBody = body.trim();
  const normalizedActionUrl = actionUrl?.trim() || null;

  if (!normalizedTenantId || !normalizedTitle || !normalizedBody) {
    console.warn(
      "[tenant-admin-director-notifications] Skipping: missing tenantId, title, or body.",
    );
    return;
  }

  try {
    const admin = createAdminClient();

    const { data: recipients, error: recipientsError } = await admin
      .from("user_accounts")
      .select("auth_uid")
      .eq("tenant_id", normalizedTenantId)
      .eq("is_active", true)
      .in("role", [...ADMIN_DIRECTOR_ROLES])
      .not("auth_uid", "is", null);

    if (recipientsError) {
      console.error(
        "[tenant-admin-director-notifications] recipient lookup failed:",
        recipientsError.message,
      );
      return;
    }

    const recipientIds = [
      ...new Set(
        (recipients ?? [])
          .map((row) =>
            typeof row.auth_uid === "string" ? row.auth_uid.trim() : "",
          )
          .filter(Boolean),
      ),
    ];

    if (recipientIds.length === 0) {
      return;
    }

    const rows = recipientIds.map((recipient_user_id) => ({
      tenant_id: normalizedTenantId,
      recipient_user_id,
      announcement_id: null,
      title: normalizedTitle,
      body: normalizedBody,
      action_url: normalizedActionUrl,
    }));

    await insertEmployeeInAppNotifications({
      rows,
      context: "tenant-admin-director",
    });
  } catch (error) {
    console.error(
      "[tenant-admin-director-notifications] failed:",
      error instanceof Error ? error.message : error,
    );
  }
}

type AdminDirectorSmsRecipient = {
  authUid: string;
  fullName: string;
  phone: string;
};

async function loadAdminDirectorSmsRecipients(
  tenantId: string,
): Promise<AdminDirectorSmsRecipient[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("user_accounts")
    .select(
      "auth_uid, employees!user_accounts_employee_id_fkey(full_name, phone)",
    )
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .in("role", [...ADMIN_DIRECTOR_ROLES])
    .not("auth_uid", "is", null);

  if (error) {
    console.error(
      "[tenant-admin-director-notifications] SMS recipient lookup failed:",
      error.message,
    );
    return [];
  }

  const recipients: AdminDirectorSmsRecipient[] = [];
  for (const row of data ?? []) {
    const authUid = typeof row.auth_uid === "string" ? row.auth_uid.trim() : "";
    if (!authUid) {
      continue;
    }

    const employee = Array.isArray(row.employees)
      ? row.employees[0]
      : row.employees;
    const phone = employee?.phone?.trim() ?? "";
    if (!phone) {
      continue;
    }

    recipients.push({
      authUid,
      fullName: employee?.full_name?.trim() || "Admin",
      phone,
    });
  }

  return recipients;
}

/**
 * Best-effort SMS to active Admins/Directors in the tenant (same scope as in-app bell).
 */
export async function notifyTenantAdminsAndDirectorsSms(
  tenantId: string,
  content: string,
  context: string,
): Promise<void> {
  const normalizedTenantId = tenantId.trim();
  const normalizedContent = content.trim();
  if (!normalizedTenantId || !normalizedContent) {
    return;
  }

  try {
    const recipients = await loadAdminDirectorSmsRecipients(normalizedTenantId);
    if (recipients.length === 0) {
      return;
    }

    const creditOk = await tryDebitSmsCredit(normalizedTenantId);
    if (!creditOk) {
      console.error(
        `[tenant-admin-director-notifications] SMS skipped (${context}): no SMS credits.`,
      );
      return;
    }

    const admin = createAdminClient();
    const tenantName = await resolveTenantDisplayName(admin, normalizedTenantId);

    await Promise.all(
      recipients.map(async (recipient) => {
        const to = normalizeGhanaPhone(recipient.phone) ?? recipient.phone;
        const result = await sendHubtelSms({
          to,
          content: normalizedContent,
          tenantName,
          recipientName: recipient.fullName,
        });
        if (!result.ok) {
          console.error(
            `[tenant-admin-director-notifications] SMS failed (${context}/${recipient.authUid}):`,
            result.error,
          );
        }
      }),
    );
  } catch (error) {
    console.error(
      `[tenant-admin-director-notifications] SMS failed (${context}):`,
      error instanceof Error ? error.message : error,
    );
  }
}

export const DEFAULT_PRODUCT_SALE_NOTIFICATION_THRESHOLD = 2000;

export async function loadProductSaleNotificationThreshold(
  tenantId: string,
): Promise<number> {
  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId) {
    return DEFAULT_PRODUCT_SALE_NOTIFICATION_THRESHOLD;
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("tax_settings")
      .select("product_sale_notification_threshold")
      .eq("tenant_id", normalizedTenantId)
      .maybeSingle();

    if (error) {
      console.error(
        "[tenant-admin-director-notifications] threshold lookup failed:",
        error.message,
      );
      return DEFAULT_PRODUCT_SALE_NOTIFICATION_THRESHOLD;
    }

    const parsed = Number(data?.product_sale_notification_threshold);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return DEFAULT_PRODUCT_SALE_NOTIFICATION_THRESHOLD;
    }

    return parsed;
  } catch (error) {
    console.error(
      "[tenant-admin-director-notifications] threshold lookup failed:",
      error instanceof Error ? error.message : error,
    );
    return DEFAULT_PRODUCT_SALE_NOTIFICATION_THRESHOLD;
  }
}

/**
 * Notify Admins/Directors when a product sale meets the tenant threshold.
 * Best-effort — never throws.
 */
export async function maybeNotifyLargeProductSale(
  tenantId: string,
  saleAmount: number,
  recordedBy: string,
  actionUrl = "/dashboard/crm/product-sales",
): Promise<void> {
  const amount = Math.round((Number(saleAmount) || 0) * 100) / 100;
  if (amount <= 0) {
    return;
  }

  const threshold = await loadProductSaleNotificationThreshold(tenantId);
  if (amount < threshold) {
    return;
  }

  const creator = recordedBy.trim() || "Unknown user";
  const formattedAmount = `GHS ${amount.toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

  await notifyTenantAdminsAndDirectors(
    tenantId,
    "Large product sale recorded",
    `${formattedAmount} recorded by ${creator}`,
    actionUrl,
  );
}
