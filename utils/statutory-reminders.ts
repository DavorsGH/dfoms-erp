import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  listStatutoryPeriodObligations,
  OBLIGATION_KIND_LABELS,
  todayAccraIsoDate,
  type StatutoryDueRuleKind,
  type StatutoryPeriodObligation,
} from "@/app/dashboard/finance/statutory-due-rules";
import { formatDate, formatGHS } from "@/app/dashboard/finance/income-register-utils";
import { formatPeriodMonthLabel } from "@/app/dashboard/finance/tax-ledger-utils";
import {
  emptyTaxSettings,
  normalizeTaxSettings,
  TAX_SETTINGS_FULL_SELECT,
  type TaxSettings,
} from "@/app/dashboard/finance/tax-utils";
import {
  normalizeTaxLedgerEntry,
  TAX_LEDGER_SELECT,
  type TaxLedgerEntry,
} from "@/app/dashboard/finance/tax-ledger-utils";
import { insertEmployeeInAppNotifications } from "@/utils/employee-in-app-notifications";
import { sendHubtelSms } from "@/utils/hubtel-sms";
import { normalizeGhanaPhone } from "@/utils/product-sale-paystack";
import { tryDebitSmsCredit } from "@/utils/sms-credit";
import { createAdminClient } from "@/utils/supabase/admin";
import { resolveTenantDisplayName } from "@/utils/tenant-display-name";

export const STATUTORY_REMINDER_RECIPIENT_ROLES = [
  "super_admin",
  "finance",
  "director",
] as const;

export type StatutoryReminderKind =
  | "D-3"
  | "D-2"
  | "D-1"
  | "D0"
  | "D+1";

export type StatutoryReminderChannel = "in_app" | "sms";

export type StatutoryReminderRunOptions = {
  /** Africa/Accra calendar date YYYY-MM-DD; defaults to today in Accra. */
  asOf?: string;
  tenantId?: string;
  dryRun?: boolean;
  admin?: SupabaseClient;
};

const TAX_SETTINGS_REMINDER_SELECT =
  `${TAX_SETTINGS_FULL_SELECT}, business_unit_id` as const;

const TAX_LEDGER_REMINDER_SELECT =
  `${TAX_LEDGER_SELECT}, business_unit_id` as const;

type TaxLedgerEntryWithBu = TaxLedgerEntry & {
  business_unit_id: string | null;
};

type TaggedStatutoryObligation = StatutoryPeriodObligation & {
  businessUnitId: string | null;
};

export type StatutoryReminderObligationDebug = {
  statutoryType: StatutoryDueRuleKind;
  periodMonth: string;
  businessUnitId: string | null;
  openAmount: number;
  dueDate: string;
  daysUntil: number;
  milestone: StatutoryReminderKind | null;
  excludeReason: string | null;
};

export type StatutoryReminderDeliveryPlan = {
  tenantId: string;
  businessUnitId: string | null;
  statutoryType: StatutoryDueRuleKind;
  periodMonth: string;
  dueDate: string;
  reminderKind: StatutoryReminderKind;
  openAmount: number;
  recipientUserId: string;
  recipientRole: string;
  recipientName: string | null;
  channel: StatutoryReminderChannel;
  wouldSend: boolean;
  skipReason?: string;
  smsBody?: string;
  inAppTitle?: string;
  inAppBody?: string;
};

export type StatutoryReminderRunResult = {
  asOfDate: string;
  dryRun: boolean;
  tenantsConsidered: number;
  obligationsConsidered: number;
  planned: number;
  sentInApp: number;
  sentSms: number;
  skipped: number;
  errors: number;
  plans: StatutoryReminderDeliveryPlan[];
  debug?: {
    obligations: StatutoryReminderObligationDebug[];
    businessUnitsUsingFallbackSettings: StatutoryReminderFallbackSettingsDebug[];
  };
};

export type StatutoryReminderFallbackSettingsDebug = {
  businessUnitId: string | null;
  fallback: "empty_default_settings";
};

type ResolvedStatutoryReminderTaxSettings = {
  settings: TaxSettings;
  usedFallback: boolean;
};

type ReminderRecipient = {
  authUid: string;
  role: string;
  fullName: string | null;
  phone: string | null;
};

const GRA_SMS_TYPE_LABEL: Record<StatutoryDueRuleKind, string> = {
  vat: "GRA VAT",
  wht: "GRA WHT",
  paye: "GRA PAYE",
  ssnit: "SSNIT",
  tier2: "SSNIT Tier 2",
};

export function resolveStatutoryReminderKindForDaysUntil(
  daysUntil: number,
): StatutoryReminderKind | null {
  if (daysUntil === 3) {
    return "D-3";
  }
  if (daysUntil === 2) {
    return "D-2";
  }
  if (daysUntil === 1) {
    return "D-1";
  }
  if (daysUntil === 0) {
    return "D0";
  }
  if (daysUntil === -1) {
    return "D+1";
  }
  return null;
}

function roundMoney(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function parseAsOfDate(value: string | undefined): string {
  const trimmed = value?.trim();
  if (trimmed && /^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  return todayAccraIsoDate();
}

type StatutoryReminderMessageScope = {
  multiBusinessUnit: boolean;
  businessUnitName: string | null;
};

function prefixStatutoryReminderText(
  text: string,
  scope: StatutoryReminderMessageScope,
): string {
  if (!scope.multiBusinessUnit) {
    return text;
  }
  const name = scope.businessUnitName?.trim();
  if (!name) {
    return text;
  }
  return `${name}: ${text}`;
}

export function buildStatutoryReminderSmsBody(options: {
  kind: StatutoryDueRuleKind;
  periodMonth: string;
  dueDate: string;
  openAmount: number;
  reminderKind: StatutoryReminderKind;
  multiBusinessUnit?: boolean;
  businessUnitName?: string | null;
}): string {
  const scope: StatutoryReminderMessageScope = {
    multiBusinessUnit: Boolean(options.multiBusinessUnit),
    businessUnitName: options.businessUnitName ?? null,
  };
  const typeLabel = GRA_SMS_TYPE_LABEL[options.kind];
  const periodLabel = formatPeriodMonthLabel(options.periodMonth);
  const dueLabel = formatDate(options.dueDate);
  const amountLabel = formatGHS(roundMoney(options.openAmount));

  if (options.reminderKind === "D+1") {
    return prefixStatutoryReminderText(
      `${typeLabel} for ${periodLabel} was due on ${dueLabel} and is now 1 day overdue. Late payment attracts GRA penalties.`,
      scope,
    );
  }

  const daysPhrase =
    options.reminderKind === "D0"
      ? "today"
      : options.reminderKind === "D-1"
        ? "in 1 day"
        : options.reminderKind === "D-2"
          ? "in 2 days"
          : "in 3 days";

  return prefixStatutoryReminderText(
    `${typeLabel} for ${periodLabel} is due on ${dueLabel} (${daysPhrase}). Amount: ${amountLabel}. Record the payment in the Statutory Ledger once paid.`,
    scope,
  );
}

export function buildStatutoryReminderInAppContent(options: {
  kind: StatutoryDueRuleKind;
  periodMonth: string;
  dueDate: string;
  openAmount: number;
  reminderKind: StatutoryReminderKind;
  multiBusinessUnit?: boolean;
  businessUnitName?: string | null;
}): { title: string; body: string } {
  const scope: StatutoryReminderMessageScope = {
    multiBusinessUnit: Boolean(options.multiBusinessUnit),
    businessUnitName: options.businessUnitName ?? null,
  };
  const label = OBLIGATION_KIND_LABELS[options.kind];
  const periodLabel = formatPeriodMonthLabel(options.periodMonth);
  const dueLabel = formatDate(options.dueDate);
  const amountLabel = formatGHS(roundMoney(options.openAmount));

  const typeLabel = GRA_SMS_TYPE_LABEL[options.kind];

  if (options.reminderKind === "D+1") {
    return {
      title: prefixStatutoryReminderText(`${typeLabel} overdue`, scope),
      body: prefixStatutoryReminderText(
        `${label} for ${periodLabel} was due ${dueLabel} and is 1 day overdue. Open amount ${amountLabel}. Mark the period remitted in Statutory Ledger after payment.`,
        scope,
      ),
    };
  }

  const timing =
    options.reminderKind === "D0"
      ? "due today"
      : options.reminderKind === "D-1"
        ? "due in 1 day"
        : options.reminderKind === "D-2"
          ? "due in 2 days"
          : "due in 3 days";

  return {
    title: prefixStatutoryReminderText(`${typeLabel} reminder`, scope),
    body: prefixStatutoryReminderText(
      `${label} for ${periodLabel} is ${timing} (${dueLabel}). Open amount ${amountLabel}. Record remittance in Statutory Ledger once paid.`,
      scope,
    ),
  };
}

async function loadTenantBusinessUnitMessageContext(
  admin: SupabaseClient,
  tenantId: string,
): Promise<{ multiBusinessUnit: boolean; nameById: Map<string, string> }> {
  const { data, error } = await admin
    .from("business_units")
    .select("id, name")
    .eq("tenant_id", tenantId);

  if (error) {
    throw new Error(
      `Failed to load business units for statutory reminders (${tenantId}): ${error.message}`,
    );
  }

  const nameById = new Map<string, string>();
  for (const row of data ?? []) {
    const id = typeof row.id === "string" ? row.id.trim() : "";
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (id && name) {
      nameById.set(id, name);
    }
  }

  return { multiBusinessUnit: nameById.size > 1, nameById };
}

async function loadReminderRecipients(
  admin: SupabaseClient,
  tenantId: string,
): Promise<ReminderRecipient[]> {
  const { data, error } = await admin
    .from("user_accounts")
    .select(
      "auth_uid, role, employee_id, employees!user_accounts_employee_id_fkey(full_name, phone)",
    )
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .in("role", [...STATUTORY_REMINDER_RECIPIENT_ROLES])
    .not("auth_uid", "is", null);

  if (error) {
    throw new Error(
      `Failed to load statutory reminder recipients: ${error.message}`,
    );
  }

  const recipients: ReminderRecipient[] = [];
  for (const row of data ?? []) {
    const authUid = typeof row.auth_uid === "string" ? row.auth_uid.trim() : "";
    if (!authUid) {
      continue;
    }
    const role = typeof row.role === "string" ? row.role.trim() : "";
    const employee = Array.isArray(row.employees)
      ? row.employees[0]
      : row.employees;
    recipients.push({
      authUid,
      role,
      fullName: employee?.full_name?.trim() || null,
      phone: employee?.phone?.trim() || null,
    });
  }
  return recipients;
}

function normalizeBusinessUnitId(value: unknown): string | null {
  if (value == null || value === "") {
    return null;
  }
  return String(value);
}

function businessUnitsMatch(
  entryBusinessUnitId: string | null,
  settingsBusinessUnitId: string | null,
): boolean {
  return entryBusinessUnitId === settingsBusinessUnitId;
}

function normalizeReminderLedgerEntry(
  row: Record<string, unknown>,
): TaxLedgerEntryWithBu {
  const base = normalizeTaxLedgerEntry(row as TaxLedgerEntry);
  return {
    ...base,
    business_unit_id: normalizeBusinessUnitId(row.business_unit_id),
  };
}

function pickTaxSettingsRowForBusinessUnit(
  rows: Record<string, unknown>[],
  businessUnitId: string | null,
): Record<string, unknown> | null {
  for (const row of rows) {
    if (
      businessUnitsMatch(
        normalizeBusinessUnitId(row.business_unit_id),
        businessUnitId,
      )
    ) {
      return row;
    }
  }
  return null;
}

export function resolveStatutoryReminderTaxSettingsForBusinessUnit(
  tenantId: string,
  businessUnitId: string | null,
  tenantSettingsRows: Record<string, unknown>[],
): ResolvedStatutoryReminderTaxSettings {
  const scopedRow = pickTaxSettingsRowForBusinessUnit(
    tenantSettingsRows,
    businessUnitId,
  );
  if (scopedRow) {
    const settings =
      normalizeTaxSettings(scopedRow as TaxSettings) ??
      emptyTaxSettings(tenantId);
    return { settings, usedFallback: false };
  }
  return {
    settings: emptyTaxSettings(tenantId),
    usedFallback: true,
  };
}

export function explainStatutoryReminderObligation(
  obligation: StatutoryPeriodObligation,
): Pick<StatutoryReminderObligationDebug, "milestone" | "excludeReason"> {
  if (roundMoney(obligation.openAmount) <= 0) {
    return {
      milestone: null,
      excludeReason: "open_amount_not_positive",
    };
  }
  const milestone = resolveStatutoryReminderKindForDaysUntil(
    obligation.daysUntil,
  );
  if (!milestone) {
    return {
      milestone: null,
      excludeReason: `days_until_${obligation.daysUntil}_not_a_reminder_milestone`,
    };
  }
  return { milestone, excludeReason: null };
}

function listTaggedObligationsForBusinessUnit(options: {
  entries: TaxLedgerEntryWithBu[];
  settings: TaxSettings;
  businessUnitId: string | null;
  todayIso: string;
}): TaggedStatutoryObligation[] {
  const scopedEntries = options.entries.filter((entry) =>
    businessUnitsMatch(entry.business_unit_id, options.businessUnitId),
  );
  return listStatutoryPeriodObligations({
    entries: scopedEntries,
    settings: options.settings,
    todayIso: options.todayIso,
  }).map((row) => ({
    ...row,
    businessUnitId: options.businessUnitId,
  }));
}

async function reminderLogExists(
  admin: SupabaseClient,
  row: {
    tenant_id: string;
    business_unit_id: string | null;
    statutory_type: string;
    period_month: string;
    reminder_kind: string;
    channel: StatutoryReminderChannel;
    recipient_user_id: string;
  },
): Promise<boolean> {
  let query = admin
    .from("statutory_reminder_log")
    .select("id")
    .eq("tenant_id", row.tenant_id)
    .eq("statutory_type", row.statutory_type)
    .eq("period_month", row.period_month)
    .eq("reminder_kind", row.reminder_kind)
    .eq("channel", row.channel)
    .eq("recipient_user_id", row.recipient_user_id);

  query =
    row.business_unit_id == null
      ? query.is("business_unit_id", null)
      : query.eq("business_unit_id", row.business_unit_id);

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error(`statutory_reminder_log lookup failed: ${error.message}`);
  }
  return Boolean(data?.id);
}

async function insertReminderLog(
  admin: SupabaseClient,
  row: {
    tenant_id: string;
    business_unit_id: string | null;
    statutory_type: string;
    period_month: string;
    reminder_kind: string;
    channel: StatutoryReminderChannel;
    recipient_user_id: string;
    status: "sent";
  },
): Promise<boolean> {
  const { error } = await admin.from("statutory_reminder_log").insert(row);
  if (error?.code === "23505") {
    return false;
  }
  if (error) {
    throw new Error(`statutory_reminder_log insert failed: ${error.message}`);
  }
  return true;
}

function obligationEligible(obligation: StatutoryPeriodObligation): boolean {
  return explainStatutoryReminderObligation(obligation).milestone != null;
}

export async function runStatutoryReminders(
  options: StatutoryReminderRunOptions = {},
): Promise<StatutoryReminderRunResult> {
  const admin = options.admin ?? createAdminClient();
  const asOfDate = parseAsOfDate(options.asOf);
  const dryRun = Boolean(options.dryRun);

  let entriesQuery = admin
    .from("tax_ledger_entries")
    .select(`${TAX_LEDGER_REMINDER_SELECT}, tenant_id`)
    .eq("status", "open");

  if (options.tenantId?.trim()) {
    entriesQuery = entriesQuery.eq("tenant_id", options.tenantId.trim());
  }

  const { data: entriesData, error: entriesError } = await entriesQuery;
  if (entriesError) {
    throw new Error(
      `Failed to load open tax_ledger_entries for statutory reminders: ${entriesError.message}`,
    );
  }

  const entriesByTenant = new Map<string, TaxLedgerEntryWithBu[]>();
  for (const raw of (entriesData as Record<string, unknown>[] | null) ?? []) {
    const tenantId =
      typeof raw.tenant_id === "string" ? raw.tenant_id.trim() : "";
    if (!tenantId) {
      continue;
    }
    const list = entriesByTenant.get(tenantId) ?? [];
    list.push(normalizeReminderLedgerEntry(raw));
    entriesByTenant.set(tenantId, list);
  }

  const tenantIds = [...entriesByTenant.keys()];
  const plans: StatutoryReminderDeliveryPlan[] = [];
  const debugObligations: StatutoryReminderObligationDebug[] = [];
  const debugBusinessUnitsUsingFallbackSettings: StatutoryReminderFallbackSettingsDebug[] =
    [];
  let obligationsConsidered = 0;
  let sentInApp = 0;
  let sentSms = 0;
  let skipped = 0;
  let errors = 0;

  for (const tenantId of tenantIds) {
    const entries = entriesByTenant.get(tenantId) ?? [];

    const { data: settingsRows, error: settingsError } = await admin
      .from("tax_settings")
      .select(TAX_SETTINGS_REMINDER_SELECT)
      .eq("tenant_id", tenantId);

    if (settingsError) {
      errors += 1;
      console.error(
        `[statutory-reminders] tax_settings load failed (${tenantId}):`,
        settingsError.message,
      );
      continue;
    }

    const tenantSettingsRows = (settingsRows ?? []) as Record<
      string,
      unknown
    >[];

    const entryBusinessUnitIds = [
      ...new Set(entries.map((entry) => entry.business_unit_id)),
    ];

    const obligations: TaggedStatutoryObligation[] = [];
    for (const businessUnitId of entryBusinessUnitIds) {
      const resolved = resolveStatutoryReminderTaxSettingsForBusinessUnit(
        tenantId,
        businessUnitId,
        tenantSettingsRows,
      );

      if (!resolved.settings.reminder_enabled) {
        continue;
      }

      if (dryRun && resolved.usedFallback) {
        debugBusinessUnitsUsingFallbackSettings.push({
          businessUnitId,
          fallback: "empty_default_settings",
        });
      }

      obligations.push(
        ...listTaggedObligationsForBusinessUnit({
          entries,
          settings: resolved.settings,
          businessUnitId,
          todayIso: asOfDate,
        }),
      );
    }

    if (dryRun) {
      for (const obligation of obligations) {
        const { milestone, excludeReason } =
          explainStatutoryReminderObligation(obligation);
        debugObligations.push({
          statutoryType: obligation.kind,
          periodMonth: obligation.periodMonth,
          businessUnitId: obligation.businessUnitId,
          openAmount: obligation.openAmount,
          dueDate: obligation.dueDate,
          daysUntil: obligation.daysUntil,
          milestone,
          excludeReason,
        });
      }
    }

    const dueToday = obligations.filter(obligationEligible);
    obligationsConsidered += dueToday.length;

    if (dueToday.length === 0) {
      continue;
    }

    let recipients: ReminderRecipient[] = [];
    try {
      recipients = await loadReminderRecipients(admin, tenantId);
    } catch (error) {
      errors += 1;
      console.error(
        `[statutory-reminders] recipients failed (${tenantId}):`,
        error instanceof Error ? error.message : error,
      );
      continue;
    }

    if (recipients.length === 0) {
      skipped += dueToday.length;
      continue;
    }

    let businessUnitMessageContext: {
      multiBusinessUnit: boolean;
      nameById: Map<string, string>;
    };
    try {
      businessUnitMessageContext = await loadTenantBusinessUnitMessageContext(
        admin,
        tenantId,
      );
    } catch (error) {
      errors += 1;
      console.error(
        `[statutory-reminders] business units failed (${tenantId}):`,
        error instanceof Error ? error.message : error,
      );
      continue;
    }

    let smsCreditReserved = false;
    const needsSms = recipients.some((recipient) => recipient.phone);

    if (!dryRun && needsSms) {
      smsCreditReserved = await tryDebitSmsCredit(tenantId);
      if (!smsCreditReserved) {
        console.warn(
          `[statutory-reminders] SMS credit gate blocked tenant ${tenantId}`,
        );
      }
    }

    const tenantName = dryRun
      ? null
      : await resolveTenantDisplayName(admin, tenantId);

    for (const obligation of dueToday) {
      const reminderKind = resolveStatutoryReminderKindForDaysUntil(
        obligation.daysUntil,
      )!;
      const businessUnitName =
        obligation.businessUnitId != null
          ? (businessUnitMessageContext.nameById.get(obligation.businessUnitId) ??
            null)
          : null;
      const messageScope = {
        multiBusinessUnit: businessUnitMessageContext.multiBusinessUnit,
        businessUnitName,
      };
      const smsBody = buildStatutoryReminderSmsBody({
        kind: obligation.kind,
        periodMonth: obligation.periodMonth,
        dueDate: obligation.dueDate,
        openAmount: obligation.openAmount,
        reminderKind,
        ...messageScope,
      });
      const inApp = buildStatutoryReminderInAppContent({
        kind: obligation.kind,
        periodMonth: obligation.periodMonth,
        dueDate: obligation.dueDate,
        openAmount: obligation.openAmount,
        reminderKind,
        ...messageScope,
      });

      for (const recipient of recipients) {
        for (const channel of ["in_app", "sms"] as const) {
          const basePlan: StatutoryReminderDeliveryPlan = {
            tenantId,
            businessUnitId: obligation.businessUnitId,
            statutoryType: obligation.kind,
            periodMonth: obligation.periodMonth,
            dueDate: obligation.dueDate,
            reminderKind,
            openAmount: obligation.openAmount,
            recipientUserId: recipient.authUid,
            recipientRole: recipient.role,
            recipientName: recipient.fullName,
            channel,
            wouldSend: false,
            smsBody: channel === "sms" ? smsBody : undefined,
            inAppTitle: channel === "in_app" ? inApp.title : undefined,
            inAppBody: channel === "in_app" ? inApp.body : undefined,
          };

          if (channel === "sms" && !recipient.phone) {
            skipped += 1;
            plans.push({
              ...basePlan,
              skipReason: "no_valid_phone",
            });
            console.warn(
              `[statutory-reminders] SMS skipped (${tenantId}/${recipient.authUid}): no valid phone`,
            );
            continue;
          }

          if (channel === "sms" && !dryRun && !smsCreditReserved) {
            skipped += 1;
            plans.push({
              ...basePlan,
              skipReason: "sms_credit_gate",
            });
            continue;
          }

          if (dryRun) {
            plans.push({ ...basePlan, wouldSend: true });
            continue;
          }

          try {
            const alreadySent = await reminderLogExists(admin, {
              tenant_id: tenantId,
              business_unit_id: obligation.businessUnitId,
              statutory_type: obligation.kind,
              period_month: obligation.periodMonth.slice(0, 10),
              reminder_kind: reminderKind,
              channel,
              recipient_user_id: recipient.authUid,
            });
            if (alreadySent) {
              skipped += 1;
              plans.push({ ...basePlan, skipReason: "already_sent" });
              continue;
            }

            if (channel === "in_app") {
              const ok = await insertEmployeeInAppNotifications({
                context: "statutory-reminder",
                rows: [
                  {
                    tenant_id: tenantId,
                    recipient_user_id: recipient.authUid,
                    title: inApp.title,
                    body: inApp.body,
                    action_url: "/dashboard/finance/tax-ledger",
                  },
                ],
                supabase: admin,
              });
              if (!ok) {
                errors += 1;
                plans.push({
                  ...basePlan,
                  wouldSend: false,
                  skipReason: "in_app_insert_failed",
                });
                continue;
              }
              const logged = await insertReminderLog(admin, {
                tenant_id: tenantId,
                business_unit_id: obligation.businessUnitId,
                statutory_type: obligation.kind,
                period_month: obligation.periodMonth.slice(0, 10),
                reminder_kind: reminderKind,
                channel,
                recipient_user_id: recipient.authUid,
                status: "sent",
              });
              if (!logged) {
                skipped += 1;
                plans.push({ ...basePlan, skipReason: "dedup_race" });
                continue;
              }
              sentInApp += 1;
              plans.push({ ...basePlan, wouldSend: true });
              continue;
            }

            const to =
              normalizeGhanaPhone(recipient.phone!) ?? recipient.phone!.trim();
            const smsResult = await sendHubtelSms({
              to,
              content: smsBody,
              purpose: "transactional",
              tenantName,
              recipientName: recipient.fullName,
              tenantId,
            });

            if (!smsResult.ok) {
              errors += 1;
              plans.push({
                ...basePlan,
                skipReason: smsResult.error,
              });
              continue;
            }

            const logged = await insertReminderLog(admin, {
              tenant_id: tenantId,
              business_unit_id: obligation.businessUnitId,
              statutory_type: obligation.kind,
              period_month: obligation.periodMonth.slice(0, 10),
              reminder_kind: reminderKind,
              channel,
              recipient_user_id: recipient.authUid,
              status: "sent",
            });
            if (!logged) {
              skipped += 1;
              plans.push({ ...basePlan, skipReason: "dedup_race" });
              continue;
            }
            sentSms += 1;
            plans.push({ ...basePlan, wouldSend: true });
          } catch (error) {
            errors += 1;
            console.error(
              `[statutory-reminders] delivery failed (${tenantId}/${obligation.kind}/${channel}):`,
              error instanceof Error ? error.message : error,
            );
          }
        }
      }
    }
  }

  const result: StatutoryReminderRunResult = {
    asOfDate,
    dryRun,
    tenantsConsidered: tenantIds.length,
    obligationsConsidered,
    planned: plans.filter((plan) => plan.wouldSend).length,
    sentInApp,
    sentSms,
    skipped,
    errors,
    plans,
  };

  if (dryRun) {
    result.debug = {
      obligations: debugObligations,
      businessUnitsUsingFallbackSettings:
        debugBusinessUnitsUsingFallbackSettings,
    };
  }

  return result;
}
