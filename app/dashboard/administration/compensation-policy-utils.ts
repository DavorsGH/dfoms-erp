/**
 * Global Salary Settings — shared types and policy resolution.
 * Basic salary: salary_rate_config. Allowances: compensation_policy + allowance_types.
 */
import type { SalaryRateConfig } from "../employees/pay-estimate-utils";
import { findMatchingSalaryRate } from "../employees/pay-estimate-utils";

export const COMPENSATION_EMPLOYMENT_TYPES = [
  "Casual",
  "Part-Time",
  "Full-Time",
] as const;

/** Expanded shift set: roster uses Morning/Afternoon/Full Day; Night/Rotating are pay-policy. */
export const COMPENSATION_SHIFTS = [
  "Full Day",
  "Morning",
  "Afternoon",
  "Night",
  "Rotating",
] as const;

export type AllowanceTypeRow = {
  id: string;
  tenant_id?: string;
  code: string;
  name: string;
  is_active: boolean;
  sort_order: number;
};

export type CompensationPolicyRow = {
  id: string;
  tenant_id?: string;
  position: string;
  employment_type: string;
  shift: string;
  allowance_type_id: string;
  amount: number;
  notes?: string | null;
};

export type ResolvedAllowanceLine = {
  allowance_type_id: string;
  allowance_code: string;
  allowance_name: string;
  amount: number;
};

export type ResolvedCompensation = {
  basic_salary: number;
  allowances: ResolvedAllowanceLine[];
  total_allowances: number;
  gross_monthly: number;
  /** True when basic rate OR any active allowance type lacks a policy amount row. */
  has_missing_policy: boolean;
  missing_basic: boolean;
  /** True when Position/Type/Shift are set but one or more active allowance types lack a policy row. */
  missing_allowances: boolean;
  missing_allowance_codes: string[];
};

export const LEGACY_ALLOWANCE_CODES = {
  HOUSING: "HOUSING",
  TRANSPORT: "TRANSPORT",
  OTHER: "OTHER",
} as const;

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function resolveEmployeeCompensation(
  salaryRates: SalaryRateConfig[],
  policies: CompensationPolicyRow[],
  allowanceTypes: AllowanceTypeRow[],
  position: string | null | undefined,
  employmentType: string | null | undefined,
  shift: string | null | undefined,
  asOf = new Date(),
): ResolvedCompensation {
  const pos = (position ?? "").trim();
  const empType = (employmentType ?? "").trim();
  const sh = (shift ?? "").trim();
  const activeTypes = allowanceTypes
    .filter((t) => t.is_active)
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

  const matchedBasic = findMatchingSalaryRate(
    salaryRates,
    pos,
    empType,
    sh,
    asOf,
  );
  const missing_basic = matchedBasic === null && Boolean(pos && empType && sh);
  const basic_salary = matchedBasic ?? 0;

  const missing_allowance_codes: string[] = [];
  const allowances: ResolvedAllowanceLine[] = [];

  for (const type of activeTypes) {
    if (!pos || !empType || !sh) {
      missing_allowance_codes.push(type.code);
      allowances.push({
        allowance_type_id: type.id,
        allowance_code: type.code,
        allowance_name: type.name,
        amount: 0,
      });
      continue;
    }

    const match = policies.find(
      (p) =>
        p.position === pos &&
        p.employment_type === empType &&
        p.shift === sh &&
        p.allowance_type_id === type.id,
    );

    if (!match) {
      missing_allowance_codes.push(type.code);
      allowances.push({
        allowance_type_id: type.id,
        allowance_code: type.code,
        allowance_name: type.name,
        amount: 0,
      });
      continue;
    }

    allowances.push({
      allowance_type_id: type.id,
      allowance_code: type.code,
      allowance_name: type.name,
      amount: roundMoney(Number(match.amount) || 0),
    });
  }

  const total_allowances = roundMoney(
    allowances.reduce((sum, line) => sum + line.amount, 0),
  );

  const comboComplete = Boolean(pos && empType && sh);
  const missing_allowances =
    comboComplete && missing_allowance_codes.length > 0;

  return {
    basic_salary: roundMoney(basic_salary),
    allowances,
    total_allowances,
    gross_monthly: roundMoney(basic_salary + total_allowances),
    has_missing_policy: missing_basic || missing_allowances,
    missing_basic,
    missing_allowances,
    missing_allowance_codes,
  };
}

/** Map dynamic allowance lines into legacy payroll_processing columns. */
export function mapAllowancesToLegacyColumns(allowances: ResolvedAllowanceLine[]): {
  housing_allowance: number;
  transport_allowance: number;
  other_allowances: number;
} {
  let housing = 0;
  let transport = 0;
  let other = 0;

  for (const line of allowances) {
    const amount = roundMoney(line.amount);
    if (line.allowance_code === LEGACY_ALLOWANCE_CODES.HOUSING) {
      housing = amount;
    } else if (line.allowance_code === LEGACY_ALLOWANCE_CODES.TRANSPORT) {
      transport = amount;
    } else if (line.allowance_code === LEGACY_ALLOWANCE_CODES.OTHER) {
      other += amount;
    } else {
      // Night Differential and any custom types roll into other_allowances for legacy columns.
      other += amount;
    }
  }

  return {
    housing_allowance: roundMoney(housing),
    transport_allowance: roundMoney(transport),
    other_allowances: roundMoney(other),
  };
}

export function sumAllowanceAmounts(allowances: ResolvedAllowanceLine[]): number {
  return roundMoney(allowances.reduce((sum, line) => sum + (Number(line.amount) || 0), 0));
}

export type PayrollAllowanceLineRow = {
  id?: string;
  tenant_id?: string;
  stage: "processing" | "history";
  payroll_month: string;
  employee_id: string;
  allowance_type_id: string | null;
  allowance_code: string;
  allowance_name: string;
  amount: number;
};

export function buildAllowanceLinePayloads(
  tenantId: string,
  stage: "processing" | "history",
  payrollMonth: string,
  employeeId: string,
  allowances: ResolvedAllowanceLine[],
): Omit<PayrollAllowanceLineRow, "id">[] {
  return allowances.map((line) => ({
    tenant_id: tenantId,
    stage,
    payroll_month: payrollMonth.slice(0, 10),
    employee_id: employeeId,
    allowance_type_id: line.allowance_type_id || null,
    allowance_code: line.allowance_code,
    allowance_name: line.allowance_name,
    amount: roundMoney(line.amount),
  }));
}
