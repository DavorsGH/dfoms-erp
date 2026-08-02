import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  formatRentMoney,
  formatRentPeriod,
  rentOutstandingGhs,
} from "@/app/dashboard/real-estate/rent-ledger-utils";
import type { LandlordType } from "@/app/dashboard/real-estate/landlords-utils";
import { sendHubtelSms } from "@/utils/hubtel-sms";
import { normalizeGhanaPhone } from "@/utils/product-sale-paystack";
import { sendResendEmail } from "@/utils/resend-email";
import { createAdminClient } from "@/utils/supabase/admin";
import { DAVORS_TENANT_ID } from "@/utils/tenant-signup";

/**
 * Milestone cutoffs by rent period length (period_end − period_start, days):
 * - ≥ 700 (~2y): 90, 30, 7, 3
 * - ≥ 300 (~1y): 30, 7, 3
 * - ≥ 25 (monthly / sub-year): 14, 7, 3
 * - < 25: prefer [21, 7, 3] filtered to milestones strictly less than period_days
 *   (so a 20-day period gets [7, 3]; 10-day → [7, 3]; 5-day → [3]; under 3 → none)
 */
export const RENT_DUE_REMINDER_MAX_LEAD_DAYS = 90;

export type RentDueReminderOptions = {
  /** Clock override (ISO date YYYY-MM-DD or Date). Defaults to today UTC. */
  asOf?: Date | string;
  /** Optional single-landlord-tenant scope (omit for platform-wide cron). */
  tenantId?: string;
  admin?: SupabaseClient;
};

export type RentDueReminderEntryResult = {
  entryId: string;
  tenantId: string;
  leaseId: string;
  periodStart: string;
  periodEnd: string;
  periodDays: number;
  daysUntilPeriodEnd: number;
  outstanding: number;
  milestonesFired: number[];
  skipped: boolean;
  skipReason?: string;
  notified?: boolean;
  error?: string;
};

export type RentDueReminderResult = {
  asOfDate: string;
  windowEndDate: string;
  considered: number;
  notified: number;
  skipped: number;
  errors: number;
  entries: RentDueReminderEntryResult[];
};

type LedgerRow = {
  entry_id: string;
  tenant_id: string;
  lease_id: string;
  period_start: string;
  period_end: string;
  amount_due_ghs: number | string;
  amount_paid_ghs: number | string;
  credit_ghs: number | string | null;
  status: string | null;
  reminders_sent: unknown;
};

type LeaseContext = {
  lesseeId: string | null;
  lesseeName: string;
  lesseeEmail: string | null;
  lesseePhone: string | null;
  propertyName: string;
  unitNumber: string;
};

type LandlordContacts = {
  landlordType: LandlordType | null;
  name: string | null;
  email: string | null;
  phone: string | null;
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Period length in whole UTC days (inclusive span of start→end). */
export function rentPeriodDays(periodStart: string, periodEnd: string): number {
  return Math.max(
    0,
    daysBetweenUtc(periodStart.slice(0, 10), periodEnd.slice(0, 10)),
  );
}

/**
 * Milestone day-counts before period_end for a given period length.
 * Short periods (< 25d): keep only milestones that still fall after period_start
 * (milestone < period_days), preferring the 21/7/3 set.
 */
export function rentDueReminderMilestones(periodDays: number): number[] {
  if (periodDays >= 700) {
    return [90, 30, 7, 3];
  }
  if (periodDays >= 300) {
    return [30, 7, 3];
  }
  if (periodDays >= 25) {
    return [14, 7, 3];
  }
  return [21, 7, 3].filter((m) => m < periodDays && m > 0);
}

export function parseRemindersSent(raw: unknown): number[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: number[] = [];
  for (const item of raw) {
    const n = typeof item === "number" ? item : Number(item);
    if (Number.isFinite(n) && n > 0 && !out.includes(n)) {
      out.push(n);
    }
  }
  return out;
}

/**
 * Fire unfired milestones where days_until ≤ milestone (exact day match plus
 * catch-up if the cron missed a day), while period_end is still today or later.
 */
export function selectRentDueMilestonesToFire(options: {
  periodDays: number;
  daysUntilPeriodEnd: number;
  alreadySent: number[];
}): number[] {
  if (options.daysUntilPeriodEnd < 0) {
    return [];
  }
  const milestones = rentDueReminderMilestones(options.periodDays);
  return milestones.filter(
    (m) =>
      options.daysUntilPeriodEnd <= m && !options.alreadySent.includes(m),
  );
}

async function loadLeaseContext(
  admin: SupabaseClient,
  landlordTenantId: string,
  leaseId: string,
): Promise<LeaseContext> {
  const fallback: LeaseContext = {
    lesseeId: null,
    lesseeName: "Tenant",
    lesseeEmail: null,
    lesseePhone: null,
    propertyName: "—",
    unitNumber: "—",
  };

  const { data: lease, error: leaseError } = await admin
    .from("leases")
    .select("lessee_id, unit_id")
    .eq("tenant_id", landlordTenantId)
    .eq("lease_id", leaseId)
    .maybeSingle();

  if (leaseError) {
    throw new Error(leaseError.message);
  }
  if (!lease) {
    return fallback;
  }

  const [{ data: lessee }, { data: unit }] = await Promise.all([
    lease.lessee_id
      ? admin
          .from("lessees")
          .select("lessee_id, full_name, email, phone")
          .eq("tenant_id", landlordTenantId)
          .eq("lessee_id", lease.lessee_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    lease.unit_id
      ? admin
          .from("property_units")
          .select("unit_number, property_id")
          .eq("tenant_id", landlordTenantId)
          .eq("unit_id", lease.unit_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  let propertyName = "—";
  if (unit?.property_id) {
    const { data: property } = await admin
      .from("properties")
      .select("name")
      .eq("tenant_id", landlordTenantId)
      .eq("property_id", unit.property_id)
      .maybeSingle();
    propertyName = property?.name?.trim() || "—";
  }

  return {
    lesseeId:
      typeof lessee?.lessee_id === "string" ? lessee.lessee_id : null,
    lesseeName: lessee?.full_name?.trim() || "Tenant",
    lesseeEmail:
      typeof lessee?.email === "string" ? lessee.email.trim() || null : null,
    lesseePhone:
      typeof lessee?.phone === "string" ? lessee.phone.trim() || null : null,
    propertyName,
    unitNumber: unit?.unit_number?.trim() || "—",
  };
}

/**
 * Same landlord_type routing as real-estate-staff-notifications:
 * - davors_managed (or unknown) → Davors Workspace Settings contacts
 * - platform_only → landlords.notification_phone + tenants.email
 */
async function resolveLandlordContacts(
  admin: SupabaseClient,
  landlordTenantId: string,
  cache: Map<string, LandlordContacts>,
): Promise<LandlordContacts> {
  const cached = cache.get(landlordTenantId);
  if (cached) {
    return cached;
  }

  const { data: landlord, error: landlordError } = await admin
    .from("landlords")
    .select("landlord_type, notification_phone")
    .eq("tenant_id", landlordTenantId)
    .maybeSingle();

  if (landlordError) {
    console.error(
      "[rent-due-reminders] landlord lookup failed:",
      landlordError.message,
    );
    const empty: LandlordContacts = {
      landlordType: null,
      name: null,
      email: null,
      phone: null,
    };
    cache.set(landlordTenantId, empty);
    return empty;
  }

  const landlordType = landlord?.landlord_type as LandlordType | null;

  if (landlordType === "platform_only") {
    const { data: tenant, error: tenantError } = await admin
      .from("tenants")
      .select("name, email")
      .eq("id", landlordTenantId)
      .maybeSingle();

    if (tenantError) {
      console.error(
        "[rent-due-reminders] platform_only tenant lookup failed:",
        tenantError.message,
      );
    }

    const contacts: LandlordContacts = {
      landlordType,
      name: typeof tenant?.name === "string" ? tenant.name.trim() || null : null,
      email:
        typeof tenant?.email === "string" ? tenant.email.trim() || null : null,
      phone:
        typeof landlord?.notification_phone === "string"
          ? landlord.notification_phone.trim() || null
          : null,
    };
    cache.set(landlordTenantId, contacts);
    return contacts;
  }

  const { data: davors, error: davorsError } = await admin
    .from("tenants")
    .select("name, email, phone")
    .eq("id", DAVORS_TENANT_ID)
    .maybeSingle();

  if (davorsError) {
    console.error(
      "[rent-due-reminders] Davors workspace contact lookup failed:",
      davorsError.message,
    );
  }

  const contacts: LandlordContacts = {
    landlordType: landlordType ?? "davors_managed",
    name: typeof davors?.name === "string" ? davors.name.trim() || null : null,
    email:
      typeof davors?.email === "string" ? davors.email.trim() || null : null,
    phone:
      typeof davors?.phone === "string" ? davors.phone.trim() || null : null,
  };
  cache.set(landlordTenantId, contacts);
  return contacts;
}

async function notifyLesseeRentDue(options: {
  lesseeName: string;
  email: string | null;
  phone: string | null;
  amountLabel: string;
  periodLabel: string;
  periodEnd: string;
  daysUntil: number;
  propertyName: string;
  unitNumber: string;
}): Promise<boolean> {
  const daysLabel =
    options.daysUntil === 0
      ? "today"
      : options.daysUntil === 1
        ? "in 1 day"
        : `in ${options.daysUntil} days`;
  const subject = `Rent due reminder — ${options.periodLabel}`;
  const lead = `Friendly reminder: ${options.amountLabel} rent for ${options.periodLabel} is due ${daysLabel} (by ${options.periodEnd}).`;
  const place = `${options.propertyName} / Unit ${options.unitNumber}`;

  const text = [
    `Hi ${options.lesseeName},`,
    "",
    lead,
    `Property: ${place}`,
    "",
    "Please arrange payment at your earliest convenience.",
    "Thank you.",
    "Davors Facilities",
  ].join("\n");

  const html = `<p>Hi ${escapeHtml(options.lesseeName)},</p>
<p>${escapeHtml(lead)}</p>
<p>Property: ${escapeHtml(place)}</p>
<p>Please arrange payment at your earliest convenience.<br/>Thank you.<br/>Davors Facilities</p>`;

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
        "[rent-due-reminders] lessee email failed:",
        result.error,
      );
    }
  }

  const phone = normalizeGhanaPhone(options.phone);
  if (phone) {
    const sms = `Davors: Rent ${options.amountLabel} due ${daysLabel} (${options.periodEnd}) for ${place}. Please pay soon.`;
    const result = await sendHubtelSms({ to: phone, content: sms });
    if (result.ok) {
      sent = true;
    } else {
      console.error("[rent-due-reminders] lessee SMS failed:", result.error);
    }
  }

  return sent;
}

/**
 * Best-effort landlord SMS/email. Failures must not block the lessee stamp.
 */
async function notifyLandlordRentDue(options: {
  landlordName: string | null;
  email: string | null;
  phone: string | null;
  lesseeName: string;
  amountLabel: string;
  periodLabel: string;
  periodEnd: string;
  daysUntil: number;
  propertyName: string;
  unitNumber: string;
}): Promise<void> {
  const email = (options.email ?? "").trim();
  const phone = normalizeGhanaPhone(options.phone);
  if (!email && !phone) {
    console.warn(
      "[rent-due-reminders] landlord notify skipped: no email/phone for routing.",
    );
    return;
  }

  const name = options.landlordName?.trim() || "Landlord";
  const daysLabel =
    options.daysUntil === 0
      ? "today"
      : options.daysUntil === 1
        ? "in 1 day"
        : `in ${options.daysUntil} days`;
  const place = `${options.propertyName} / Unit ${options.unitNumber}`;
  const subject = `Rent due soon — ${options.lesseeName}`;
  const lead = `${options.lesseeName} has ${options.amountLabel} rent due ${daysLabel} (by ${options.periodEnd}) for ${options.periodLabel}.`;

  const text = [
    `Hi ${name},`,
    "",
    lead,
    `Property: ${place}`,
    "",
    "A payment reminder was also sent to the tenant.",
    "Davors Facilities",
  ].join("\n");

  const html = `<p>Hi ${escapeHtml(name)},</p>
<p>${escapeHtml(lead)}</p>
<p>Property: ${escapeHtml(place)}</p>
<p>A payment reminder was also sent to the tenant.<br/>Davors Facilities</p>`;

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
          "[rent-due-reminders] landlord email failed:",
          result.error,
        );
      }
    } catch (err) {
      console.error(
        "[rent-due-reminders] landlord email failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  if (phone) {
    try {
      const sms = `Davors RE: ${options.lesseeName} — rent ${options.amountLabel} due ${daysLabel} (${place}). Tenant reminded.`;
      const result = await sendHubtelSms({ to: phone, content: sms });
      if (!result.ok) {
        console.error(
          "[rent-due-reminders] landlord SMS failed:",
          result.error,
        );
      }
    } catch (err) {
      console.error(
        "[rent-due-reminders] landlord SMS failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }
}

/**
 * Find rent_ledger rows with outstanding balance whose period_end falls within
 * the reminder lead window, fire due milestones (deduped via reminders_sent),
 * notify lessee + landlord, then stamp fired milestones.
 */
export async function runRentDueReminders(
  options: RentDueReminderOptions = {},
): Promise<RentDueReminderResult> {
  const admin = options.admin ?? createAdminClient();
  const asOf = parseAsOf(options.asOf);
  const asOfDate = toDateString(asOf);
  const windowEndDate = toDateString(
    addUtcDays(asOf, RENT_DUE_REMINDER_MAX_LEAD_DAYS),
  );
  const landlordContactCache = new Map<string, LandlordContacts>();

  let query = admin
    .from("rent_ledger")
    .select(
      "entry_id, tenant_id, lease_id, period_start, period_end, amount_due_ghs, amount_paid_ghs, credit_ghs, status, reminders_sent",
    )
    .neq("status", "paid")
    .not("period_end", "is", null)
    .gte("period_end", asOfDate)
    .lte("period_end", windowEndDate)
    .order("period_end", { ascending: true });

  if (options.tenantId?.trim()) {
    query = query.eq("tenant_id", options.tenantId.trim());
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(
      `Failed to load rent ledger for due reminders: ${error.message}`,
    );
  }

  const rows = (data as LedgerRow[] | null) ?? [];
  const entries: RentDueReminderEntryResult[] = [];
  let notified = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of rows) {
    const periodStart = row.period_start.slice(0, 10);
    const periodEnd = row.period_end.slice(0, 10);
    const periodDays = rentPeriodDays(periodStart, periodEnd);
    const daysUntil = daysBetweenUtc(asOfDate, periodEnd);
    // credit_ghs may be missing on DBs that have not applied script 134 yet.
    const outstanding = rentOutstandingGhs(
      Number(row.amount_due_ghs) || 0,
      Number(row.amount_paid_ghs) || 0,
      Number(row.credit_ghs) || 0,
    );
    const alreadySent = parseRemindersSent(row.reminders_sent);

    const base: RentDueReminderEntryResult = {
      entryId: row.entry_id,
      tenantId: row.tenant_id,
      leaseId: row.lease_id,
      periodStart,
      periodEnd,
      periodDays,
      daysUntilPeriodEnd: daysUntil,
      outstanding,
      milestonesFired: [],
      skipped: false,
    };

    if (outstanding <= 0) {
      skipped += 1;
      entries.push({ ...base, skipped: true, skipReason: "no_outstanding" });
      continue;
    }

    const toFire = selectRentDueMilestonesToFire({
      periodDays,
      daysUntilPeriodEnd: daysUntil,
      alreadySent,
    });

    if (toFire.length === 0) {
      skipped += 1;
      entries.push({
        ...base,
        skipped: true,
        skipReason:
          rentDueReminderMilestones(periodDays).length === 0
            ? "no_milestones_for_period"
            : "no_milestone_due",
      });
      continue;
    }

    try {
      const ctx = await loadLeaseContext(
        admin,
        row.tenant_id,
        row.lease_id,
      );
      const amountLabel = formatRentMoney(outstanding);
      const periodLabel = formatRentPeriod(periodStart, periodEnd);

      const delivered = await notifyLesseeRentDue({
        lesseeName: ctx.lesseeName,
        email: ctx.lesseeEmail,
        phone: ctx.lesseePhone,
        amountLabel,
        periodLabel,
        periodEnd,
        daysUntil,
        propertyName: ctx.propertyName,
        unitNumber: ctx.unitNumber,
      });

      if (!delivered) {
        skipped += 1;
        entries.push({
          ...base,
          skipped: true,
          skipReason: "no_delivery_channel",
        });
        continue;
      }

      const landlord = await resolveLandlordContacts(
        admin,
        row.tenant_id,
        landlordContactCache,
      );
      await notifyLandlordRentDue({
        landlordName: landlord.name,
        email: landlord.email,
        phone: landlord.phone,
        lesseeName: ctx.lesseeName,
        amountLabel,
        periodLabel,
        periodEnd,
        daysUntil,
        propertyName: ctx.propertyName,
        unitNumber: ctx.unitNumber,
      });

      const nextSent = [...alreadySent];
      for (const m of toFire) {
        if (!nextSent.includes(m)) {
          nextSent.push(m);
        }
      }
      nextSent.sort((a, b) => b - a);

      const { error: stampError } = await admin
        .from("rent_ledger")
        .update({
          reminders_sent: nextSent,
          updated_at: new Date().toISOString(),
        })
        .eq("entry_id", row.entry_id)
        .eq("tenant_id", row.tenant_id);

      if (stampError) {
        throw new Error(stampError.message);
      }

      notified += 1;
      entries.push({
        ...base,
        milestonesFired: toFire,
        skipped: false,
        notified: true,
      });
    } catch (err) {
      errors += 1;
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[rent-due-reminders] failed for ${row.entry_id}:`,
        message,
      );
      entries.push({ ...base, skipped: false, error: message });
    }
  }

  return {
    asOfDate,
    windowEndDate,
    considered: rows.length,
    notified,
    skipped,
    errors,
    entries,
  };
}
