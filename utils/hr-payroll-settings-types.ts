export const HR_PAYROLL_SETTINGS_SELECT =
  "tenant_id, business_unit_id, default_welfare_deduction_rate, include_overtime_in_welfare, created_at, updated_at" as const;

export const HR_PAYROLL_SETTINGS_ON_CONFLICT =
  "tenant_id,business_unit_id" as const;

export type HrPayrollSettingsRow = {
  tenant_id: string;
  business_unit_id: string | null;
  default_welfare_deduction_rate: number | null;
  include_overtime_in_welfare: boolean;
  created_at: string;
  updated_at: string;
};

export type PayrollWelfareConfig = {
  includeOvertimeInWelfare: boolean;
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
    include_overtime_in_welfare: row.include_overtime_in_welfare !== false,
  };
}

export function resolvePayrollWelfareConfigForEmployee(
  employeeBusinessUnitId: string | null | undefined,
  settingsRows: HrPayrollSettingsRow[],
): PayrollWelfareConfig {
  if (settingsRows.length === 0) {
    return { includeOvertimeInWelfare: true };
  }

  const buKey = employeeBusinessUnitId ?? null;
  const exact = settingsRows.find((row) => row.business_unit_id === buKey);
  if (exact) {
    return {
      includeOvertimeInWelfare: exact.include_overtime_in_welfare !== false,
    };
  }

  const tenantWide = settingsRows.find((row) => row.business_unit_id === null);
  if (tenantWide) {
    return {
      includeOvertimeInWelfare: tenantWide.include_overtime_in_welfare !== false,
    };
  }

  return { includeOvertimeInWelfare: true };
}

export const INCLUDE_OVERTIME_IN_WELFARE_HELPER_TEXT =
  "When unticked, welfare is calculated on regular pay only (basic + allowances); overtime is not reduced by welfare.";

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
