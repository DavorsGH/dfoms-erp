export const GRA_OVERTIME_TAX_EFFECTIVE_DATE = "2026-10-01";

export type GraOvertimeTaxConfig = {
  effective_date: string;
  junior_annual_income_threshold: number;
  basic_salary_split_ratio: number;
  rate_within_split: number;
  rate_above_split: number;
};

export function isGraOvertimeTaxRuleActive(asOf: string): boolean {
  return asOf.slice(0, 10) >= GRA_OVERTIME_TAX_EFFECTIVE_DATE;
}

export function normalizeStatutoryRate(rate: number): number {
  if (!Number.isFinite(rate)) {
    return 0;
  }
  return rate > 1 ? rate / 100 : rate;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Annual qualifying test: regular monthly emoluments (excl. overtime) × 12. */
export function qualifiesAsJuniorEmployee(
  regularMonthlyEmolumentsExcludingOvertime: number,
  annualThreshold: number,
): boolean {
  const monthly = Math.max(0, Number(regularMonthlyEmolumentsExcludingOvertime) || 0);
  const threshold = Math.max(0, Number(annualThreshold) || 0);
  return monthly * 12 <= threshold + 1e-9;
}

/**
 * Final tax on overtime for qualifying juniors.
 * Split uses full monthly basic from salary policy (not pro-rated period basic).
 */
export function calculateJuniorOvertimeTax(options: {
  overtimeAmount: number;
  monthlyBasicSalary: number;
  config: GraOvertimeTaxConfig;
}): number {
  const overtime = Math.max(0, Number(options.overtimeAmount) || 0);
  if (overtime <= 0) {
    return 0;
  }

  const monthlyBasic = Math.max(0, Number(options.monthlyBasicSalary) || 0);
  const splitRatio = normalizeStatutoryRate(
    Number(options.config.basic_salary_split_ratio) || 0.5,
  );
  const rateWithin = normalizeStatutoryRate(
    Number(options.config.rate_within_split) || 0,
  );
  const rateAbove = normalizeStatutoryRate(
    Number(options.config.rate_above_split) || 0,
  );

  const splitCap = roundMoney(monthlyBasic * splitRatio);
  const withinAmount = Math.min(overtime, splitCap);
  const aboveAmount = Math.max(overtime - splitCap, 0);

  return roundMoney(
    withinAmount * rateWithin + aboveAmount * rateAbove,
  );
}

export function calculateCasualOvertimeTax(
  overtimeAmount: number,
  flatRate: number,
): number {
  const overtime = Math.max(0, Number(overtimeAmount) || 0);
  if (overtime <= 0) {
    return 0;
  }
  return roundMoney(overtime * normalizeStatutoryRate(flatRate));
}

export function mapGraOvertimeTaxConfigRows(
  rows: Record<string, unknown>[] | null | undefined,
): GraOvertimeTaxConfig[] {
  return (rows ?? []).map((row) => ({
    effective_date: String(row.effective_date ?? ""),
    junior_annual_income_threshold:
      Number(row.junior_annual_income_threshold) || 0,
    basic_salary_split_ratio: Number(row.basic_salary_split_ratio) || 0.5,
    rate_within_split: Number(row.rate_within_split) || 0,
    rate_above_split: Number(row.rate_above_split) || 0,
  }));
}
