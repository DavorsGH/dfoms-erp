import type { VatReturnPeriod } from "./tax-utils";
import type { TaxDueReminderKind, TaxLedgerBalanceSource } from "./tax-ledger-utils";
import { STATUTORY_DUE_KIND_COMPONENTS } from "./tax-ledger-utils";

export type StatutoryDayRule = "day" | "last_day" | "last_working_day";

export type StatutoryDueRule = {
  monthsAfterPeriod: 0 | 1;
  dayRule: StatutoryDayRule;
  dayNumber: number | null;
};

export type StatutoryDueRuleKind = TaxDueReminderKind;

export type TaxSettingsDueRules = {
  vat_return_period: VatReturnPeriod;
  vat_due_months_after_period: 0 | 1;
  vat_due_day_rule: StatutoryDayRule;
  vat_due_day_number: number | null;
  wht_due_months_after_period: 0 | 1;
  wht_due_day_rule: StatutoryDayRule;
  wht_due_day_number: number | null;
  paye_due_months_after_period: 0 | 1;
  paye_due_day_rule: StatutoryDayRule;
  paye_due_day_number: number | null;
  ssnit_due_months_after_period: 0 | 1;
  ssnit_due_day_rule: StatutoryDayRule;
  ssnit_due_day_number: number | null;
  tier2_due_months_after_period: 0 | 1;
  tier2_due_day_rule: StatutoryDayRule;
  tier2_due_day_number: number | null;
};

export const STATUTORY_DUE_RULE_FIELD: Record<
  StatutoryDueRuleKind,
  keyof TaxSettingsDueRules
> = {
  vat: "vat_due_months_after_period",
  wht: "wht_due_months_after_period",
  paye: "paye_due_months_after_period",
  ssnit: "ssnit_due_months_after_period",
  tier2: "tier2_due_months_after_period",
};

export const DEFAULT_VAT_DUE_RULE: StatutoryDueRule = {
  monthsAfterPeriod: 0,
  dayRule: "last_day",
  dayNumber: null,
};

export const DEFAULT_WHT_DUE_RULE: StatutoryDueRule = {
  monthsAfterPeriod: 1,
  dayRule: "day",
  dayNumber: 15,
};

export const DEFAULT_PAYE_DUE_RULE: StatutoryDueRule = {
  monthsAfterPeriod: 1,
  dayRule: "day",
  dayNumber: 15,
};

export const DEFAULT_SSNIT_DUE_RULE: StatutoryDueRule = {
  monthsAfterPeriod: 1,
  dayRule: "day",
  dayNumber: 14,
};

export const DEFAULT_TIER2_DUE_RULE: StatutoryDueRule = {
  monthsAfterPeriod: 1,
  dayRule: "day",
  dayNumber: 14,
};

export const STATUTORY_DUE_RULE_PREVIEW_PERIOD = "2026-09-01";

export function normalizeMonthsAfterPeriod(value: unknown): 0 | 1 {
  return Number(value) === 1 ? 1 : 0;
}

export function normalizeStatutoryDayRule(value: unknown): StatutoryDayRule {
  if (value === "day" || value === "last_day" || value === "last_working_day") {
    return value;
  }
  return "day";
}

export function normalizeOptionalDayNumber(
  value: unknown,
): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const day = Number(value);
  if (!Number.isFinite(day) || day < 1 || day > 31) {
    return null;
  }
  return Math.trunc(day);
}

export function pickDueRuleFromSettings(
  settings: TaxSettingsDueRules,
  kind: StatutoryDueRuleKind,
): StatutoryDueRule {
  switch (kind) {
    case "vat":
      return {
        monthsAfterPeriod: normalizeMonthsAfterPeriod(
          settings.vat_due_months_after_period,
        ),
        dayRule: normalizeStatutoryDayRule(settings.vat_due_day_rule),
        dayNumber: normalizeOptionalDayNumber(settings.vat_due_day_number),
      };
    case "wht":
      return {
        monthsAfterPeriod: normalizeMonthsAfterPeriod(
          settings.wht_due_months_after_period,
        ),
        dayRule: normalizeStatutoryDayRule(settings.wht_due_day_rule),
        dayNumber: normalizeOptionalDayNumber(settings.wht_due_day_number),
      };
    case "paye":
      return {
        monthsAfterPeriod: normalizeMonthsAfterPeriod(
          settings.paye_due_months_after_period,
        ),
        dayRule: normalizeStatutoryDayRule(settings.paye_due_day_rule),
        dayNumber: normalizeOptionalDayNumber(settings.paye_due_day_number),
      };
    case "ssnit":
      return {
        monthsAfterPeriod: normalizeMonthsAfterPeriod(
          settings.ssnit_due_months_after_period,
        ),
        dayRule: normalizeStatutoryDayRule(settings.ssnit_due_day_rule),
        dayNumber: normalizeOptionalDayNumber(settings.ssnit_due_day_number),
      };
    case "tier2":
      return {
        monthsAfterPeriod: normalizeMonthsAfterPeriod(
          settings.tier2_due_months_after_period,
        ),
        dayRule: normalizeStatutoryDayRule(settings.tier2_due_day_rule),
        dayNumber: normalizeOptionalDayNumber(settings.tier2_due_day_number),
      };
  }
}

export function defaultDueRulesPartial(): Pick<
  TaxSettingsDueRules,
  | "vat_due_months_after_period"
  | "vat_due_day_rule"
  | "vat_due_day_number"
  | "wht_due_months_after_period"
  | "wht_due_day_rule"
  | "wht_due_day_number"
  | "paye_due_months_after_period"
  | "paye_due_day_rule"
  | "paye_due_day_number"
  | "ssnit_due_months_after_period"
  | "ssnit_due_day_rule"
  | "ssnit_due_day_number"
  | "tier2_due_months_after_period"
  | "tier2_due_day_rule"
  | "tier2_due_day_number"
> {
  return {
    vat_due_months_after_period: DEFAULT_VAT_DUE_RULE.monthsAfterPeriod,
    vat_due_day_rule: DEFAULT_VAT_DUE_RULE.dayRule,
    vat_due_day_number: DEFAULT_VAT_DUE_RULE.dayNumber,
    wht_due_months_after_period: DEFAULT_WHT_DUE_RULE.monthsAfterPeriod,
    wht_due_day_rule: DEFAULT_WHT_DUE_RULE.dayRule,
    wht_due_day_number: DEFAULT_WHT_DUE_RULE.dayNumber,
    paye_due_months_after_period: DEFAULT_PAYE_DUE_RULE.monthsAfterPeriod,
    paye_due_day_rule: DEFAULT_PAYE_DUE_RULE.dayRule,
    paye_due_day_number: DEFAULT_PAYE_DUE_RULE.dayNumber,
    ssnit_due_months_after_period: DEFAULT_SSNIT_DUE_RULE.monthsAfterPeriod,
    ssnit_due_day_rule: DEFAULT_SSNIT_DUE_RULE.dayRule,
    ssnit_due_day_number: DEFAULT_SSNIT_DUE_RULE.dayNumber,
    tier2_due_months_after_period: DEFAULT_TIER2_DUE_RULE.monthsAfterPeriod,
    tier2_due_day_rule: DEFAULT_TIER2_DUE_RULE.dayRule,
    tier2_due_day_number: DEFAULT_TIER2_DUE_RULE.dayNumber,
  };
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function parsePeriodMonth(periodMonth: string): { year: number; month: number } {
  const iso = periodMonth.slice(0, 10);
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  return { year, month };
}

function daysInCalendarMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function addCalendarMonths(
  year: number,
  month: number,
  offset: number,
): { year: number; month: number } {
  const absolute = year * 12 + (month - 1) + offset;
  return {
    year: Math.floor(absolute / 12),
    month: (absolute % 12) + 1,
  };
}

function formatIsoDate(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function lastWorkingDayInMonth(year: number, month: number): number {
  let day = daysInCalendarMonth(year, month);
  while (day >= 1) {
    const dow = new Date(year, month - 1, day).getDay();
    if (dow >= 1 && dow <= 5) {
      return day;
    }
    day -= 1;
  }
  return 1;
}

export function computeStatutoryDueDate(
  periodMonth: string,
  rule: StatutoryDueRule,
): string {
  const { year, month } = parsePeriodMonth(periodMonth);
  const target = addCalendarMonths(year, month, rule.monthsAfterPeriod);
  const targetYear = target.year;
  const targetMonth = target.month;

  if (rule.dayRule === "last_day") {
    const day = daysInCalendarMonth(targetYear, targetMonth);
    return formatIsoDate(targetYear, targetMonth, day);
  }

  if (rule.dayRule === "last_working_day") {
    const day = lastWorkingDayInMonth(targetYear, targetMonth);
    return formatIsoDate(targetYear, targetMonth, day);
  }

  const rawDay = rule.dayNumber ?? 1;
  const day = Math.min(
    Math.max(1, Math.trunc(rawDay)),
    daysInCalendarMonth(targetYear, targetMonth),
  );
  return formatIsoDate(targetYear, targetMonth, day);
}

export function quarterEndPeriodMonth(periodMonth: string): string {
  const { year, month } = parsePeriodMonth(periodMonth);
  const quarterEndMonth = Math.ceil(month / 3) * 3;
  return formatIsoDate(year, quarterEndMonth, 1);
}

export function vatObligationPeriodKey(
  periodMonth: string,
  vatReturnPeriod: VatReturnPeriod,
): string {
  const iso = periodMonth.slice(0, 10);
  if (vatReturnPeriod === "quarterly") {
    return quarterEndPeriodMonth(iso);
  }
  return iso;
}

export function todayAccraIsoDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Accra",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function daysUntilAccraDate(
  dueIso: string,
  todayIso = todayAccraIsoDate(),
): number {
  const due = dueIso.slice(0, 10);
  const today = todayIso.slice(0, 10);
  const a = Date.parse(`${due}T12:00:00.000Z`);
  const b = Date.parse(`${today}T12:00:00.000Z`);
  return Math.round((a - b) / 86_400_000);
}

export type StatutoryPeriodObligation = {
  kind: StatutoryDueRuleKind;
  periodMonth: string;
  dueDate: string;
  daysUntil: number;
  openAmount: number;
  isOverdue: boolean;
};

function entryMatchesKind(
  entry: TaxLedgerBalanceSource,
  kind: StatutoryDueRuleKind,
): boolean {
  if (entry.status !== "open") {
    return false;
  }
  const components = STATUTORY_DUE_KIND_COMPONENTS[kind];
  if (!components.includes(entry.tax_component)) {
    return false;
  }
  if (kind === "wht") {
    return entry.direction === "wht_payable";
  }
  if (kind === "vat") {
    return entry.direction === "output" || entry.direction === "input";
  }
  return entry.direction === "statutory_payable";
}

function sumOpenForKindPeriod(
  entries: TaxLedgerBalanceSource[],
  kind: StatutoryDueRuleKind,
  periodKey: string,
  vatReturnPeriod: VatReturnPeriod,
): number {
  let output = 0;
  let input = 0;
  let whtPayable = 0;
  let paye = 0;
  let ssnitEmployee = 0;
  let ssnitEmployer = 0;
  let tier2 = 0;

  for (const entry of entries) {
    if (entry.status !== "open") {
      continue;
    }
    const key =
      kind === "vat"
        ? vatObligationPeriodKey(entry.period_month, vatReturnPeriod)
        : entry.period_month.slice(0, 10);
    if (key !== periodKey) {
      continue;
    }
    const amount = Number(entry.tax_amount) || 0;
    if (kind === "vat") {
      if (entry.direction === "output") {
        output += amount;
      } else if (entry.direction === "input") {
        input += amount;
      }
      continue;
    }
    if (!entryMatchesKind(entry, kind)) {
      continue;
    }
    if (kind === "wht") {
      whtPayable += amount;
    } else if (kind === "paye") {
      paye += amount;
    } else if (kind === "ssnit") {
      if (entry.tax_component === "ssnit_employee") {
        ssnitEmployee += amount;
      } else if (entry.tax_component === "ssnit_employer_tier1") {
        ssnitEmployer += amount;
      }
    } else if (kind === "tier2") {
      tier2 += amount;
    }
  }

  if (kind === "vat") {
    return Math.round((output - input) * 100) / 100;
  }
  if (kind === "wht") {
    return Math.round(whtPayable * 100) / 100;
  }
  if (kind === "paye") {
    return Math.round(paye * 100) / 100;
  }
  if (kind === "ssnit") {
    return Math.round((ssnitEmployee + ssnitEmployer) * 100) / 100;
  }
  return Math.round(tier2 * 100) / 100;
}

export function listStatutoryPeriodObligations(options: {
  entries: TaxLedgerBalanceSource[];
  settings: TaxSettingsDueRules;
  kinds?: StatutoryDueRuleKind[];
  todayIso?: string;
}): StatutoryPeriodObligation[] {
  const kinds = options.kinds ?? [
    "vat",
    "wht",
    "paye",
    "ssnit",
    "tier2",
  ];
  const todayIso = options.todayIso ?? todayAccraIsoDate();
  const periodKeys = new Map<string, Set<StatutoryDueRuleKind>>();

  for (const entry of options.entries) {
    if (entry.status !== "open") {
      continue;
    }
    for (const kind of kinds) {
      if (!entryMatchesKind(entry, kind)) {
        continue;
      }
      const key =
        kind === "vat"
          ? vatObligationPeriodKey(
              entry.period_month,
              options.settings.vat_return_period,
            )
          : entry.period_month.slice(0, 10);
      if (!periodKeys.has(key)) {
        periodKeys.set(key, new Set());
      }
      periodKeys.get(key)!.add(kind);
    }
  }

  const obligations: StatutoryPeriodObligation[] = [];

  for (const [periodKey, kindSet] of periodKeys) {
    for (const kind of kindSet) {
      const anchorPeriod =
        kind === "vat" ? periodKey : periodKey;
      const rule = pickDueRuleFromSettings(options.settings, kind);
      const dueDate = computeStatutoryDueDate(anchorPeriod, rule);
      const daysUntil = daysUntilAccraDate(dueDate, todayIso);
      const openAmount = sumOpenForKindPeriod(
        options.entries,
        kind,
        periodKey,
        options.settings.vat_return_period,
      );
      obligations.push({
        kind,
        periodMonth: periodKey,
        dueDate,
        daysUntil,
        openAmount,
        isOverdue: daysUntil < 0,
      });
    }
  }

  obligations.sort((left, right) => {
    if (left.dueDate !== right.dueDate) {
      return left.dueDate.localeCompare(right.dueDate);
    }
    if (left.kind !== right.kind) {
      return left.kind.localeCompare(right.kind);
    }
    return left.periodMonth.localeCompare(right.periodMonth);
  });

  return obligations;
}

export function formatDueRulePreview(
  periodMonth: string,
  rule: StatutoryDueRule,
  formatPeriodLabel: (period: string) => string,
  formatDateLabel: (iso: string) => string,
): string {
  const due = computeStatutoryDueDate(periodMonth, rule);
  return `${formatPeriodLabel(periodMonth)} → due ${formatDateLabel(due)}`;
}

export const OBLIGATION_KIND_LABELS: Record<StatutoryDueRuleKind, string> = {
  vat: "VAT",
  wht: "WHT",
  paye: "PAYE",
  ssnit: "SSNIT Tier 1",
  tier2: "Tier 2",
};

export type GraReconciliationKind = "vat" | "wht" | "paye";

export const GRA_RECONCILIATION_TOLERANCE = 0.01;
