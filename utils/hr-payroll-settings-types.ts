export const HR_PAYROLL_SETTINGS_SELECT =
  "tenant_id, business_unit_id, default_welfare_deduction_rate, created_at, updated_at" as const;

export const HR_PAYROLL_SETTINGS_ON_CONFLICT =
  "tenant_id,business_unit_id" as const;

export type HrPayrollSettingsRow = {
  tenant_id: string;
  business_unit_id: string | null;
  default_welfare_deduction_rate: number | null;
  created_at: string;
  updated_at: string;
};

export function normalizeHrPayrollSettingsRow(
  row: HrPayrollSettingsRow | null | undefined,
): HrPayrollSettingsRow | null {
  if (!row) {
    return null;
  }

  const rate = row.default_welfare_deduction_rate;
  return {
    ...row,
    default_welfare_deduction_rate:
      rate === null || rate === undefined ? null : Number(rate),
  };
}

export function formatDefaultWelfareDeductionRate(
  rate: number | null | undefined,
): string {
  if (rate === null || rate === undefined || Number.isNaN(Number(rate))) {
    return "";
  }

  return String(rate);
}

export function parseDefaultWelfareDeductionRateInput(
  value: string,
): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

export const WELFARE_DEDUCTION_RATE_HELPER_TEXT =
  "Applied automatically each payroll period as a percentage of that period's gross pay (e.g. 2.50 = 2.5%).";
