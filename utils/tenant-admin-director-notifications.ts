import "server-only";

import { createAdminClient } from "@/utils/supabase/admin";
import { isMissingActionUrlColumnError } from "@/utils/employee-notifications-types";

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

    let { error } = await admin.from("employee_notifications").insert(rows);

    if (
      error &&
      normalizedActionUrl &&
      isMissingActionUrlColumnError(error.message)
    ) {
      const legacyRows = recipientIds.map((recipient_user_id) => ({
        tenant_id: normalizedTenantId,
        recipient_user_id,
        announcement_id: null,
        title: normalizedTitle,
        body: normalizedActionUrl
          ? `${normalizedBody}\n${normalizedActionUrl}`
          : normalizedBody,
      }));
      ({ error } = await admin.from("employee_notifications").insert(legacyRows));
    }

    if (error) {
      console.error(
        "[tenant-admin-director-notifications] insert failed:",
        error.message,
      );
    }
  } catch (error) {
    console.error(
      "[tenant-admin-director-notifications] failed:",
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
