import type { SupabaseClient } from "@supabase/supabase-js";
import type { PayeTaxBand } from "../employees/pay-estimate-utils";
import { isGraOvertimeTaxRuleActive } from "./gra-overtime-tax-utils";
import {
  mapCasualTaxConfigRows,
  mapGraOvertimeTaxConfigRows,
  mapPayrollPayeBandRows,
  mapSsnitConfigRows,
  pickLatestByEffectiveDate,
  pickPayeBandsForDate,
  type PayrollCasualTaxConfig,
  type PayrollPayeBand,
  type PayrollSsnitConfig,
  type PayrollTaxConfigs,
} from "./payroll-processing-utils";
import { getPeriodEndDate } from "./payroll-period-utils";

export const DEFAULT_STATUTORY_COUNTRY_CODE = "GH";

export type StatutoryPayrollConfigLoaded = {
  taxConfigs: PayrollTaxConfigs;
  asOf: string;
  payeBandsForDate: PayeTaxBand[];
  ssnitConfig: PayrollSsnitConfig | null;
  casualConfig: PayrollCasualTaxConfig | null;
  error: string | null;
};

export type StatutoryPayrollAssessment = {
  ok: boolean;
  missing: string[];
  message: string | null;
};

function normalizeAsOf(asOf: string | Date): string {
  if (asOf instanceof Date) {
    return asOf.toISOString().slice(0, 10);
  }
  return asOf.slice(0, 10);
}

export function hasStatutoryPayeLadderForAsOf(
  payeBands: PayrollPayeBand[],
  asOf: string,
): boolean {
  if (payeBands.length === 0) {
    return false;
  }
  const asOfDate = normalizeAsOf(asOf);
  const effectiveDates = new Set(
    payeBands.map((band) => String(band.effective_date).slice(0, 10)),
  );
  return [...effectiveDates].some((date) => date && date <= asOfDate);
}

export function assessStatutoryPayrollConfig(
  taxConfigs: PayrollTaxConfigs,
  asOf: string | Date,
  options?: { requireCasualTax?: boolean },
): StatutoryPayrollAssessment {
  const asOfDate = normalizeAsOf(asOf);
  const missing: string[] = [];

  if (!hasStatutoryPayeLadderForAsOf(taxConfigs.payeBands, asOfDate)) {
    missing.push("PAYE tax bands");
  }
  if (!pickLatestByEffectiveDate(taxConfigs.ssnitRows, asOfDate)) {
    missing.push("SSNIT rate config");
  }
  if (
    options?.requireCasualTax &&
    !pickLatestByEffectiveDate(taxConfigs.casualRows, asOfDate)
  ) {
    missing.push("casual worker tax rate");
  }
  if (
    isGraOvertimeTaxRuleActive(asOfDate) &&
    !pickLatestByEffectiveDate(taxConfigs.overtimeRows ?? [], asOfDate)
  ) {
    missing.push("overtime tax config");
  }

  if (missing.length === 0) {
    return { ok: true, missing: [], message: null };
  }

  return {
    ok: false,
    missing,
    message: `Ghana statutory payroll rates are not configured for ${asOfDate}: missing ${missing.join(", ")}. PAYE and SSNIT may calculate as zero until rates are added.`,
  };
}

export async function fetchStatutoryPayrollTaxConfigs(
  supabase: SupabaseClient,
  countryCode = DEFAULT_STATUTORY_COUNTRY_CODE,
): Promise<{ taxConfigs: PayrollTaxConfigs; error: string | null }> {
  const [
    { data: ssnitRows, error: ssnitError },
    { data: casualRows, error: casualError },
    { data: payeRows, error: payeError },
    { data: overtimeRows, error: overtimeError },
  ] = await Promise.all([
    supabase
      .from("statutory_ssnit_rate_config")
      .select(
        "effective_date, employee_rate, employer_tier1_rate, employer_tier2_rate, insurable_earnings_ceiling, notes",
      )
      .eq("country_code", countryCode)
      .order("effective_date", { ascending: false }),
    supabase
      .from("statutory_casual_tax_rate_config")
      .select("effective_date, flat_rate, notes")
      .eq("country_code", countryCode)
      .order("effective_date", { ascending: false }),
    supabase
      .from("statutory_paye_tax_bands")
      .select("band_order, lower_bound, upper_bound, rate, effective_date")
      .eq("country_code", countryCode)
      .order("effective_date", { ascending: false })
      .order("band_order", { ascending: true }),
    supabase
      .from("statutory_overtime_tax_config")
      .select(
        "effective_date, junior_annual_income_threshold, basic_salary_split_ratio, rate_within_split, rate_above_split",
      )
      .eq("country_code", countryCode)
      .order("effective_date", { ascending: false }),
  ]);

  const error =
    ssnitError?.message ??
    casualError?.message ??
    payeError?.message ??
    overtimeError?.message ??
    null;

  return {
    taxConfigs: {
      ssnitRows: mapSsnitConfigRows(
        (ssnitRows as Record<string, unknown>[] | null) ?? [],
      ),
      casualRows: mapCasualTaxConfigRows(
        (casualRows as Record<string, unknown>[] | null) ?? [],
      ),
      payeBands: mapPayrollPayeBandRows(
        (payeRows as Record<string, unknown>[] | null) ?? [],
      ),
      overtimeRows: mapGraOvertimeTaxConfigRows(
        (overtimeRows as Record<string, unknown>[] | null) ?? [],
      ),
    },
    error,
  };
}

export async function loadStatutoryPayrollConfig(
  supabase: SupabaseClient,
  asOf: string | Date,
  countryCode = DEFAULT_STATUTORY_COUNTRY_CODE,
): Promise<StatutoryPayrollConfigLoaded> {
  const asOfDate = normalizeAsOf(asOf);
  const { taxConfigs, error } = await fetchStatutoryPayrollTaxConfigs(
    supabase,
    countryCode,
  );

  if (error) {
    return {
      taxConfigs: {
        ssnitRows: [],
        casualRows: [],
        payeBands: [],
        overtimeRows: [],
      },
      asOf: asOfDate,
      payeBandsForDate: [],
      ssnitConfig: null,
      casualConfig: null,
      error,
    };
  }

  return {
    taxConfigs,
    asOf: asOfDate,
    payeBandsForDate: pickPayeBandsForDate(taxConfigs.payeBands, asOfDate),
    ssnitConfig: pickLatestByEffectiveDate(taxConfigs.ssnitRows, asOfDate),
    casualConfig: pickLatestByEffectiveDate(taxConfigs.casualRows, asOfDate),
    error: null,
  };
}

export function assessStatutoryPayrollForPeriodMonth(
  taxConfigs: PayrollTaxConfigs,
  year: number,
  month: number,
  options?: { requireCasualTax?: boolean },
): StatutoryPayrollAssessment {
  return assessStatutoryPayrollConfig(
    taxConfigs,
    getPeriodEndDate(year, month),
    options,
  );
}

export function validateStatutoryPayrollBeforeLock(input: {
  taxConfigs: PayrollTaxConfigs;
  periodYear: number;
  periodMonth: number;
  employees: Array<{ employment_type: string | null }>;
}): string | null {
  const requireCasualTax = input.employees.some(
    (employee) => String(employee.employment_type ?? "").trim() === "Casual",
  );
  const requiresSsnitPaye = input.employees.some((employee) => {
    const type = String(employee.employment_type ?? "").trim();
    return (
      type === "Full-Time" ||
      type === "Part-Time" ||
      type === "Contract"
    );
  });

  const assessment = assessStatutoryPayrollForPeriodMonth(
    input.taxConfigs,
    input.periodYear,
    input.periodMonth,
    { requireCasualTax },
  );

  if (!requiresSsnitPaye && !requireCasualTax) {
    return null;
  }

  if (!assessment.ok) {
    return (
      assessment.message ??
      "Statutory payroll rates are missing for this period. Lock is blocked."
    );
  }

  return null;
}
