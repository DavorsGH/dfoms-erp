import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendHubtelSms } from "@/utils/hubtel-sms";
import { normalizeGhanaPhone } from "@/utils/product-sale-paystack";
import { sendResendEmail } from "@/utils/resend-email";
import { tryDebitSmsCredit } from "@/utils/sms-credit";
import { createAdminClient } from "@/utils/supabase/admin";
import { fireTransactionalNotification } from "@/utils/transactional-notification-trigger";
import { resolveTenantDisplayName } from "@/utils/tenant-display-name";

/** Days before due_date that count as "approaching". */
export const PRODUCT_SALE_DUE_REMINDER_LEAD_DAYS = 3;

/** Re-notify overdue balances at most this often after the first overdue notice. */
export const PRODUCT_SALE_OVERDUE_REENGAGE_DAYS = 7;

export type ProductSaleDueReminderOptions = {
  /** Clock override (ISO date YYYY-MM-DD or Date). Defaults to today UTC. */
  asOf?: Date | string;
  /** Optional single-tenant scope (omit for platform-wide cron). */
  tenantId?: string;
  admin?: SupabaseClient;
};

export type ProductSaleDueReminderSaleResult = {
  incomeId: string;
  tenantId: string;
  clientId: string | null;
  invoiceNo: string | null;
  dueDate: string;
  outstanding: number;
  kind: "approaching" | "overdue";
  skipped: boolean;
  skipReason?: string;
  notified?: boolean;
  error?: string;
};

export type ProductSaleDueReminderResult = {
  asOfDate: string;
  windowEndDate: string;
  considered: number;
  notified: number;
  skipped: number;
  errors: number;
  sales: ProductSaleDueReminderSaleResult[];
};

type SaleRow = {
  id: string;
  tenant_id: string;
  client_id: string | null;
  customer_name: string | null;
  invoice_no: string | null;
  amount: number | string;
  amount_received: number | string;
  outstanding_balance: number | string | null;
  payment_status: string | null;
  due_date: string;
  last_reminder_sent_at: string | null;
  business_unit_id: string | null;
};

function toDateString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function parseAsOf(value: Date | string | undefined): Date {
  if (!value) {
    return new Date();
  }
  if (value instanceof Date) {
    return value;
  }
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return new Date(`${trimmed}T00:00:00.000Z`);
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("asOf must be a valid date");
  }
  return parsed;
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function daysBetweenUtc(earlierYmd: string, laterYmd: string): number {
  const a = Date.parse(`${earlierYmd}T00:00:00.000Z`);
  const b = Date.parse(`${laterYmd}T00:00:00.000Z`);
  return Math.round((b - a) / 86_400_000);
}

function roundMoney(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function formatMoneyLabel(value: number): string {
  return `GHS ${roundMoney(value).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Customer-facing due/overdue reminder SMS body (Issue A tenant branding). */
export function buildProductSaleDueReminderCustomerSms(options: {
  tenantName: string;
  invoiceNo: string;
  amountLabel: string;
  dueDate: string;
  kind: "approaching" | "overdue";
}): string {
  const dueLabel = options.dueDate;
  return options.kind === "overdue"
    ? `${options.tenantName}: Your invoice ${options.invoiceNo} balance ${options.amountLabel} was due ${dueLabel} and is overdue. Please pay soon.`
    : `${options.tenantName}: Reminder — Your invoice ${options.invoiceNo} balance ${options.amountLabel} is due by ${dueLabel}. Please pay soon.`;
}

export function formatProductSaleDueReminderSmsMoney(value: number): string {
  return formatMoneyLabel(value);
}

function resolveOutstanding(row: SaleRow): number {
  if (row.outstanding_balance !== null && row.outstanding_balance !== undefined) {
    return Math.max(0, roundMoney(Number(row.outstanding_balance)));
  }
  return Math.max(
    0,
    roundMoney(Number(row.amount) - Number(row.amount_received)),
  );
}

/**
 * Dedup rules (uses last_reminder_sent_at):
 * - Approaching (due today..+leadDays): notify at most once.
 * - Overdue: notify if never reminded, or last remind was on/before due date
 *   (approaching notice only), or last remind was ≥ OVERDUE_REENGAGE_DAYS ago.
 */
export function shouldSendProductSaleDueReminder(options: {
  dueDate: string;
  asOfDate: string;
  lastReminderSentAt: string | null | undefined;
  leadDays?: number;
  overdueReengageDays?: number;
}): { send: boolean; kind: "approaching" | "overdue"; reason?: string } {
  const leadDays = options.leadDays ?? PRODUCT_SALE_DUE_REMINDER_LEAD_DAYS;
  const reengage =
    options.overdueReengageDays ?? PRODUCT_SALE_OVERDUE_REENGAGE_DAYS;
  const dueDate = options.dueDate.slice(0, 10);
  const asOfDate = options.asOfDate.slice(0, 10);
  const windowEnd = toDateString(
    addUtcDays(new Date(`${asOfDate}T00:00:00.000Z`), leadDays),
  );

  if (dueDate > windowEnd) {
    return { send: false, kind: "approaching", reason: "outside_window" };
  }

  const overdue = dueDate < asOfDate;
  const kind = overdue ? "overdue" : "approaching";
  const lastRaw = options.lastReminderSentAt?.trim() || null;
  const lastDate = lastRaw ? lastRaw.slice(0, 10) : null;

  if (!lastDate) {
    return { send: true, kind };
  }

  if (overdue) {
    if (lastDate <= dueDate) {
      return { send: true, kind };
    }
    if (daysBetweenUtc(lastDate, asOfDate) >= reengage) {
      return { send: true, kind };
    }
    return { send: false, kind, reason: "recently_reminded" };
  }

  return { send: false, kind, reason: "already_reminded_approaching" };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function hasActivePaymentDueRule(
  admin: SupabaseClient,
  tenantId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("transactional_notification_rules")
    .select("id, template_id, is_active")
    .eq("tenant_id", tenantId)
    .eq("event_type", "payment_due_reminder")
    .maybeSingle();

  if (error) {
    console.error(
      "[product-sale-due-reminders] rule lookup failed:",
      error.message,
    );
    return false;
  }

  return Boolean(data && data.is_active === true && data.template_id);
}

async function sendFallbackDueReminder(options: {
  tenantId: string;
  tenantName: string;
  customerName: string;
  email: string | null;
  phone: string | null;
  invoiceNo: string;
  amountLabel: string;
  dueDate: string;
  kind: "approaching" | "overdue";
}): Promise<boolean> {
  const dueLabel = options.dueDate;
  const subject =
    options.kind === "overdue"
      ? `Overdue balance — invoice ${options.invoiceNo}`
      : `Payment reminder — invoice ${options.invoiceNo}`;
  const lead =
    options.kind === "overdue"
      ? `Your balance of ${options.amountLabel} on invoice ${options.invoiceNo} was due on ${dueLabel} and is now overdue.`
      : `Friendly reminder: ${options.amountLabel} remains due on invoice ${options.invoiceNo} by ${dueLabel}.`;

  const text = [
    `Hi ${options.customerName},`,
    "",
    lead,
    "",
    "Please arrange payment at your earliest convenience.",
    "Thank you.",
  ].join("\n");

  const html = `<p>Hi ${escapeHtml(options.customerName)},</p>
<p>${escapeHtml(lead)}</p>
<p>Please arrange payment at your earliest convenience.<br/>Thank you.</p>`;

  let sent = false;

  const email = (options.email ?? "").trim();
  if (email) {
    const result = await sendResendEmail({
      to: email,
      subject,
      html,
      text,
    });
    if (result.ok) {
      sent = true;
    } else {
      console.error(
        "[product-sale-due-reminders] fallback email failed:",
        result.error,
      );
    }
  }

  const phone = normalizeGhanaPhone(options.phone);
  if (phone) {
    const creditOk = await tryDebitSmsCredit(options.tenantId);
    if (creditOk) {
      const sms = buildProductSaleDueReminderCustomerSms({
        tenantName: options.tenantName,
        invoiceNo: options.invoiceNo,
        amountLabel: options.amountLabel,
        dueDate: options.dueDate,
        kind: options.kind,
      });
      const result = await sendHubtelSms({
        to: phone,
        content: sms,
        tenantName: options.tenantName,
        recipientName: options.customerName,
      });
      if (result.ok) {
        sent = true;
      } else {
        console.error(
          "[product-sale-due-reminders] fallback SMS failed:",
          result.error,
        );
      }
    }
  }

  return sent;
}

type TenantOwnerContacts = {
  name: string | null;
  email: string | null;
  phone: string | null;
};

/**
 * Workspace Settings contacts (`tenants.email` / `tenants.phone`) — same fields
 * used for Davors RE staff / landlord workspace notices.
 */
async function loadTenantOwnerContacts(
  admin: SupabaseClient,
  tenantId: string,
  cache: Map<string, TenantOwnerContacts>,
): Promise<TenantOwnerContacts> {
  const cached = cache.get(tenantId);
  if (cached) {
    return cached;
  }

  const { data, error } = await admin
    .from("tenants")
    .select("name, email, phone")
    .eq("id", tenantId)
    .maybeSingle();

  if (error) {
    console.error(
      "[product-sale-due-reminders] owner contact lookup failed:",
      error.message,
    );
    const empty: TenantOwnerContacts = {
      name: null,
      email: null,
      phone: null,
    };
    cache.set(tenantId, empty);
    return empty;
  }

  const contacts: TenantOwnerContacts = {
    name: typeof data?.name === "string" ? data.name.trim() || null : null,
    email: typeof data?.email === "string" ? data.email.trim() || null : null,
    phone: typeof data?.phone === "string" ? data.phone.trim() || null : null,
  };
  cache.set(tenantId, contacts);
  return contacts;
}

/**
 * Best-effort SMS/email to the business owner. Never throws; missing contacts
 * or send failures are logged only and must not block the customer leg.
 */
async function notifyBusinessOwnerDueReminder(options: {
  tenantId: string;
  ownerName: string | null;
  email: string | null;
  phone: string | null;
  customerName: string;
  invoiceNo: string;
  amountLabel: string;
  dueDate: string;
  kind: "approaching" | "overdue";
}): Promise<void> {
  const email = (options.email ?? "").trim();
  const phone = normalizeGhanaPhone(options.phone);
  if (!email && !phone) {
    console.warn(
      `[product-sale-due-reminders] owner notify skipped for tenant ${options.tenantId}: no tenants.email/phone (Workspace Settings).`,
    );
    return;
  }

  const ownerName = options.ownerName?.trim() || "Business owner";
  const dueLabel = options.dueDate;
  const subject =
    options.kind === "overdue"
      ? `Customer overdue — invoice ${options.invoiceNo}`
      : `Customer payment due — invoice ${options.invoiceNo}`;
  const lead =
    options.kind === "overdue"
      ? `${options.customerName} has an overdue balance of ${options.amountLabel} on invoice ${options.invoiceNo} (due ${dueLabel}).`
      : `${options.customerName} has ${options.amountLabel} due by ${dueLabel} on invoice ${options.invoiceNo}.`;

  const text = [
    `Hi ${ownerName},`,
    "",
    lead,
    "",
    "A payment reminder was also sent to the customer.",
  ].join("\n");

  const html = `<p>Hi ${escapeHtml(ownerName)},</p>
<p>${escapeHtml(lead)}</p>
<p>A payment reminder was also sent to the customer.</p>`;

  if (email) {
    try {
      const result = await sendResendEmail({
        to: email,
        subject,
        html,
        text,
      });
      if (!result.ok) {
        console.error(
          "[product-sale-due-reminders] owner email failed:",
          result.error,
        );
      }
    } catch (err) {
      console.error(
        "[product-sale-due-reminders] owner email failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  if (phone) {
    try {
      const sms =
        options.kind === "overdue"
          ? `${options.ownerName?.trim() || "Workspace"}: ${options.customerName} overdue ${options.amountLabel} on invoice ${options.invoiceNo} (due ${dueLabel}). Customer reminded.`
          : `${options.ownerName?.trim() || "Workspace"}: ${options.customerName} — ${options.amountLabel} due by ${dueLabel} on invoice ${options.invoiceNo}. Customer reminded.`;
      const result = await sendHubtelSms({
        to: phone,
        content: sms,
        tenantName: options.ownerName,
        recipientName: ownerName,
      });
      if (!result.ok) {
        console.error(
          "[product-sale-due-reminders] owner SMS failed:",
          result.error,
        );
      }
    } catch (err) {
      console.error(
        "[product-sale-due-reminders] owner SMS failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }
}

/**
 * Find active product sales with outstanding balance whose due date is within
 * the approaching window or already overdue, notify customers (and the
 * business owner via Workspace Settings contacts), and stamp
 * last_reminder_sent_at once after both legs to avoid duplicate sends.
 */
export async function runProductSaleDueReminders(
  options: ProductSaleDueReminderOptions = {},
): Promise<ProductSaleDueReminderResult> {
  const admin = options.admin ?? createAdminClient();
  const asOf = parseAsOf(options.asOf);
  const asOfDate = toDateString(asOf);
  const windowEndDate = toDateString(
    addUtcDays(asOf, PRODUCT_SALE_DUE_REMINDER_LEAD_DAYS),
  );
  const ownerContactCache = new Map<string, TenantOwnerContacts>();
  const tenantDisplayNameCache = new Map<string, string>();

  let query = admin
    .from("income_register")
    .select(
      "id, tenant_id, client_id, customer_name, invoice_no, amount, amount_received, outstanding_balance, payment_status, due_date, last_reminder_sent_at, business_unit_id",
    )
    .eq("entry_type", "product_sale")
    .eq("sale_status", "active")
    .gt("outstanding_balance", 0)
    .not("due_date", "is", null)
    .lte("due_date", windowEndDate)
    .order("due_date", { ascending: true });

  if (options.tenantId?.trim()) {
    query = query.eq("tenant_id", options.tenantId.trim());
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(
      `Failed to load product sales for due reminders: ${error.message}`,
    );
  }

  const rows = (data as SaleRow[] | null) ?? [];
  const sales: ProductSaleDueReminderSaleResult[] = [];
  let notified = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of rows) {
    const outstanding = resolveOutstanding(row);
    const base: ProductSaleDueReminderSaleResult = {
      incomeId: row.id,
      tenantId: row.tenant_id,
      clientId: row.client_id,
      invoiceNo: row.invoice_no,
      dueDate: row.due_date,
      outstanding,
      kind: row.due_date < asOfDate ? "overdue" : "approaching",
      skipped: false,
    };

    if (outstanding <= 0) {
      skipped += 1;
      sales.push({ ...base, skipped: true, skipReason: "no_outstanding" });
      continue;
    }

    const decision = shouldSendProductSaleDueReminder({
      dueDate: row.due_date,
      asOfDate,
      lastReminderSentAt: row.last_reminder_sent_at,
    });
    base.kind = decision.kind;

    if (!decision.send) {
      skipped += 1;
      sales.push({
        ...base,
        skipped: true,
        skipReason: decision.reason ?? "dedup",
      });
      continue;
    }

    const clientId = row.client_id?.trim() || null;
    if (!clientId) {
      skipped += 1;
      sales.push({
        ...base,
        skipped: true,
        skipReason: "no_client_id",
      });
      continue;
    }

    try {
      const { data: customer, error: customerError } = await admin
        .from("customers")
        .select("client_id, client_name, email, phone")
        .eq("tenant_id", row.tenant_id)
        .eq("client_id", clientId)
        .maybeSingle();

      if (customerError) {
        throw new Error(customerError.message);
      }

      if (!customer) {
        skipped += 1;
        sales.push({
          ...base,
          skipped: true,
          skipReason: "customer_not_found",
        });
        continue;
      }

      const customerName =
        customer.client_name?.trim() ||
        row.customer_name?.trim() ||
        clientId;
      const invoiceNo = row.invoice_no?.trim() || row.id.slice(0, 8);
      const amountLabel = formatMoneyLabel(outstanding);
      const variables = {
        customer_name: customerName,
        invoice_no: invoiceNo,
        amount: amountLabel,
        outstanding_balance: amountLabel,
        due_date: row.due_date,
        reminder_kind: decision.kind,
      };

      const useTransactional = await hasActivePaymentDueRule(
        admin,
        row.tenant_id,
      );

      const tenantName = tenantDisplayNameCache.has(row.tenant_id)
        ? tenantDisplayNameCache.get(row.tenant_id)!
        : await resolveTenantDisplayName(admin, row.tenant_id).then((name) => {
            tenantDisplayNameCache.set(row.tenant_id, name);
            return name;
          });

      let delivered = false;

      if (useTransactional) {
        await fireTransactionalNotification(
          row.tenant_id,
          "payment_due_reminder",
          clientId,
          variables,
          {
            businessUnitId:
              (row.business_unit_id as string | null | undefined)?.trim() || null,
          },
        );
        // Rule path is best-effort; stamp when customer has a reachable channel.
        delivered = Boolean(
          (customer.email ?? "").trim() || (customer.phone ?? "").trim(),
        );
      } else {
        delivered = await sendFallbackDueReminder({
          tenantId: row.tenant_id,
          tenantName,
          customerName,
          email: customer.email,
          phone: customer.phone,
          invoiceNo,
          amountLabel,
          dueDate: row.due_date,
          kind: decision.kind,
        });
      }

      if (!delivered) {
        skipped += 1;
        sales.push({
          ...base,
          skipped: true,
          skipReason: "no_delivery_channel",
        });
        continue;
      }

      // Owner leg is best-effort; failures must not block customer stamp.
      const owner = await loadTenantOwnerContacts(
        admin,
        row.tenant_id,
        ownerContactCache,
      );
      await notifyBusinessOwnerDueReminder({
        tenantId: row.tenant_id,
        ownerName: owner.name,
        email: owner.email,
        phone: owner.phone,
        customerName,
        invoiceNo,
        amountLabel,
        dueDate: row.due_date,
        kind: decision.kind,
      });

      // Single stamp covers customer + owner legs for this cron cycle.
      const nowIso = new Date().toISOString();
      const patch: {
        last_reminder_sent_at: string;
        payment_status?: string;
      } = { last_reminder_sent_at: nowIso };

      if (
        decision.kind === "overdue" &&
        (row.payment_status ?? "").trim().toLowerCase() !== "paid"
      ) {
        patch.payment_status = "Overdue";
      }

      const { error: stampError } = await admin
        .from("income_register")
        .update(patch)
        .eq("id", row.id)
        .eq("tenant_id", row.tenant_id);

      if (stampError) {
        throw new Error(stampError.message);
      }

      notified += 1;
      sales.push({ ...base, skipped: false, notified: true });
    } catch (err) {
      errors += 1;
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[product-sale-due-reminders] failed for ${row.id}:`,
        message,
      );
      sales.push({ ...base, skipped: false, error: message });
    }
  }

  return {
    asOfDate,
    windowEndDate,
    considered: rows.length,
    notified,
    skipped,
    errors,
    sales,
  };
}
