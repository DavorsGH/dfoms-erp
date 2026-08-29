import "server-only";

import { sendHubtelSms } from "@/utils/hubtel-sms";
import { logSystemEvent } from "@/lib/system-event-log";
import { normalizeGhanaPhone } from "@/utils/product-sale-paystack";
import { tryDebitSmsCredit } from "@/utils/sms-credit";
import { createAdminClient } from "@/utils/supabase/admin";
import { insertEmployeeInAppNotifications } from "@/utils/employee-in-app-notifications";
import { resolveTenantDisplayName } from "@/utils/tenant-display-name";
import { isDavorsPlatformTenant } from "@/utils/tenant-signup";
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

type AdminDirectorSmsRecipientProbe = {
  authUid: string;
  email: string;
  role: string;
  employeeId: string | null;
  fullName: string | null;
  phone: string | null;
  skipReason: string | null;
};

async function loadAdminDirectorSmsRecipients(
  tenantId: string,
): Promise<{
  recipients: AdminDirectorSmsRecipient[];
  probes: AdminDirectorSmsRecipientProbe[];
}> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("user_accounts")
    .select(
      "auth_uid, email, role, employee_id, employees!user_accounts_employee_id_fkey(full_name, phone)",
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
    return { recipients: [], probes: [] };
  }

  const recipients: AdminDirectorSmsRecipient[] = [];
  const probes: AdminDirectorSmsRecipientProbe[] = [];

  for (const row of data ?? []) {
    const authUid = typeof row.auth_uid === "string" ? row.auth_uid.trim() : "";
    const email = typeof row.email === "string" ? row.email.trim() : "";
    const role = typeof row.role === "string" ? row.role.trim() : "";
    const employeeId =
      typeof row.employee_id === "string" ? row.employee_id.trim() : null;

    const employee = Array.isArray(row.employees)
      ? row.employees[0]
      : row.employees;
    const fullName = employee?.full_name?.trim() || null;
    const phone = employee?.phone?.trim() || null;

    let skipReason: string | null = null;
    if (!authUid) {
      skipReason = "missing auth_uid";
    } else if (!employeeId) {
      skipReason = "user_accounts.employee_id not linked";
    } else if (!phone) {
      skipReason = "employees.phone blank (link HR employee phone)";
    }

    probes.push({
      authUid,
      email,
      role,
      employeeId,
      fullName,
      phone,
      skipReason,
    });

    if (skipReason || !authUid || !phone) {
      continue;
    }

    recipients.push({
      authUid,
      fullName: fullName || "Admin",
      phone,
    });
  }

  return { recipients, probes };
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
    const { recipients, probes } =
      await loadAdminDirectorSmsRecipients(normalizedTenantId);
    if (recipients.length === 0) {
      const skipped = probes.filter((probe) => probe.skipReason);
      console.warn(
        `[tenant-admin-director-notifications] SMS skipped (${context}): no deliverable Admin/Director phone numbers.`,
        skipped,
      );
      await logSystemEvent({
        eventType: "cron",
        eventName: "admin_director_sms_skipped",
        status: "warning",
        message: `No Admin/Director SMS recipients for ${context}`,
        metadata: {
          tenantId: normalizedTenantId,
          context,
          probes: skipped,
        },
      });
      return;
    }

    const creditOk = await tryDebitSmsCredit(normalizedTenantId);
    if (!creditOk) {
      console.error(
        `[tenant-admin-director-notifications] SMS skipped (${context}): SMS credit gate returned false.`,
      );
      await logSystemEvent({
        eventType: "cron",
        eventName: "admin_director_sms_skipped",
        status: "warning",
        message: `SMS credit gate blocked ${context}`,
        metadata: {
          tenantId: normalizedTenantId,
          context,
          recipientCount: recipients.length,
          platformTenant: isDavorsPlatformTenant(normalizedTenantId),
        },
      });
      return;
    }

    const admin = createAdminClient();
    const tenantName = await resolveTenantDisplayName(admin, normalizedTenantId);

    const sendResults = await Promise.all(
      recipients.map(async (recipient) => {
        const to = normalizeGhanaPhone(recipient.phone) ?? recipient.phone;
        const result = await sendHubtelSms({
          to,
          content: normalizedContent,
          tenantName,
          recipientName: recipient.fullName,
          tenantId: normalizedTenantId,
        });
        return { recipient, to, result };
      }),
    );

    const failures = sendResults.filter(
      (entry): entry is typeof entry & { result: { ok: false; error: string } } =>
        !entry.result.ok,
    );
    if (failures.length > 0) {
      for (const failure of failures) {
        console.error(
          `[tenant-admin-director-notifications] SMS failed (${context}/${failure.recipient.authUid}):`,
          failure.result.error,
        );
      }
      await logSystemEvent({
        eventType: "cron",
        eventName: "admin_director_sms_failed",
        status: "failure",
        message: `Hubtel SMS failed for ${context}`,
        metadata: {
          tenantId: normalizedTenantId,
          context,
          failures: failures.map((failure) => ({
            authUid: failure.recipient.authUid,
            to: failure.to,
            error: failure.result.error,
          })),
        },
      });
    }

    const successes = sendResults.filter(
      (entry): entry is typeof entry & { result: { ok: true; id: string | null } } =>
        entry.result.ok,
    );
    if (successes.length > 0) {
      await logSystemEvent({
        eventType: "cron",
        eventName: "admin_director_sms_sent",
        status: "success",
        message: `Admin/Director SMS sent for ${context}`,
        metadata: {
          tenantId: normalizedTenantId,
          context,
          sent: successes.map((entry) => ({
            authUid: entry.recipient.authUid,
            to: entry.to,
            hubtelMessageId: entry.result.id,
          })),
        },
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[tenant-admin-director-notifications] SMS failed (${context}):`,
      message,
    );
    await logSystemEvent({
      eventType: "cron",
      eventName: "admin_director_sms_failed",
      status: "failure",
      message: `Admin/Director SMS error for ${context}: ${message}`,
      metadata: {
        tenantId: normalizedTenantId,
        context,
      },
    });
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
      .is("business_unit_id", null)
      .maybeSingle();

    if (error) {
      console.error(
        "[tenant-admin-director-notifications] threshold lookup failed:",
        error.message,
      );
      return DEFAULT_PRODUCT_SALE_NOTIFICATION_THRESHOLD;
    }

    let thresholdValue = data?.product_sale_notification_threshold;
    if (thresholdValue == null) {
      const { data: fallback, error: fallbackError } = await admin
        .from("tax_settings")
        .select("product_sale_notification_threshold")
        .eq("tenant_id", normalizedTenantId)
        .limit(1)
        .maybeSingle();
      if (fallbackError) {
        console.error(
          "[tenant-admin-director-notifications] threshold fallback failed:",
          fallbackError.message,
        );
        return DEFAULT_PRODUCT_SALE_NOTIFICATION_THRESHOLD;
      }
      thresholdValue = fallback?.product_sale_notification_threshold;
    }

    const parsed = Number(thresholdValue);
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
