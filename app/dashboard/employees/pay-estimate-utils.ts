export type SalaryRateConfig = {
  id: string;
  position: string;
  employment_type: string;
  shift: string;
  basic_salary: number;
  effective_date: string;
};

export type SsnitRateConfig = {
  employee_rate: number;
  insurable_earnings_ceiling: number;
};

export type CasualTaxRateConfig = {
  flat_rate: number;
};

export type PayeTaxBand = {
  band_order?: number;
  band_from: number;
  band_to: number | null;
  rate: number;
};

export type PayEstimateInputs = {
  employment_type: string | null;
  basic_salary: number | null;
  housing_allowance?: number | null;
  transport_allowance?: number | null;
  other_allowances?: number | null;
};

export type PayEstimateConfig = {
  ssnitConfig: SsnitRateConfig | null;
  casualTaxConfig: CasualTaxRateConfig | null;
  payeBands: PayeTaxBand[];
};

export function calculateGrossMonthlyPay(employee: {
  basic_salary?: number | null;
  housing_allowance?: number | null;
  transport_allowance?: number | null;
  other_allowances?: number | null;
}): number {
  return (
    (Number(employee.basic_salary) || 0) +
    (Number(employee.housing_allowance) || 0) +
    (Number(employee.transport_allowance) || 0) +
    (Number(employee.other_allowances) || 0)
  );
}

function normalizeRate(rate: number): number {
  if (!Number.isFinite(rate)) {
    return 0;
  }

  return rate > 1 ? rate / 100 : rate;
}

export function findMatchingSalaryRate(
  rates: SalaryRateConfig[],
  position: string,
  employmentType: string,
  shift: string,
  asOf = new Date(),
): number | null {
  if (!position || !employmentType || !shift) {
    return null;
  }

  const today = asOf.toISOString().slice(0, 10);
  const matches = rates.filter(
    (rate) =>
      rate.position === position &&
      rate.employment_type === employmentType &&
      rate.shift === shift &&
      rate.effective_date.slice(0, 10) <= today,
  );

  if (matches.length === 0) {
    return null;
  }

  matches.sort((a, b) =>
    b.effective_date.slice(0, 10).localeCompare(a.effective_date.slice(0, 10)),
  );

  return matches[0].basic_salary;
}

export function calculateEmployeeSsnit(
  basicSalary: number,
  ssnitConfig: SsnitRateConfig | null,
): number {
  if (!ssnitConfig) {
    return 0;
  }

  const insurableBase = Math.min(
    basicSalary,
    Number(ssnitConfig.insurable_earnings_ceiling) || basicSalary,
  );

  return insurableBase * normalizeRate(Number(ssnitConfig.employee_rate) || 0);
}

export function calculatePayeTax(
  taxableIncome: number,
  bands: PayeTaxBand[],
): number {
  if (taxableIncome <= 0 || bands.length === 0) {
    return 0;
  }

  const sortedBands = [...bands].sort((left, right) => {
    if (left.band_order != null && right.band_order != null) {
      return left.band_order - right.band_order;
    }

    return left.band_from - right.band_from;
  });
  let tax = 0;

  for (const band of sortedBands) {
    const bandMin = Number(band.band_from) || 0;
    const bandMax =
      band.band_to === null ||
      band.band_to === undefined ||
      Number(band.band_to) <= 0
        ? Number.POSITIVE_INFINITY
        : Number(band.band_to);

    if (taxableIncome <= bandMin) {
      break;
    }

    const taxableInBand = Math.min(taxableIncome, bandMax) - bandMin;

    if (taxableInBand > 0) {
      tax += taxableInBand * normalizeRate(Number(band.rate) || 0);
    }
  }

  return Math.round(tax * 100) / 100;
}

export function calculateEstimatedNetMonthlyPay(
  inputs: PayEstimateInputs,
  config: PayEstimateConfig,
): number {
  const gross = calculateGrossMonthlyPay(inputs);
  const basicSalary = Number(inputs.basic_salary) || 0;
  const employmentType = inputs.employment_type?.trim() ?? "";

  if (employmentType === "Casual") {
    const flatRate = normalizeRate(
      Number(config.casualTaxConfig?.flat_rate) || 0,
    );
    const casualTax = basicSalary * flatRate;
    return Math.max(gross - casualTax, 0);
  }

  if (employmentType === "Full-Time" || employmentType === "Part-Time") {
    const employeeSsnit = calculateEmployeeSsnit(
      basicSalary,
      config.ssnitConfig,
    );
    const taxableIncome = Math.max(gross - employeeSsnit, 0);
    const payeTax = calculatePayeTax(taxableIncome, config.payeBands);
    return Math.max(gross - employeeSsnit - payeTax, 0);
  }

  return gross;
}

export function mapSsnitConfigRow(
  row: Record<string, unknown> | null | undefined,
): SsnitRateConfig | null {
  if (!row) {
    return null;
  }

  return {
    employee_rate: Number(row.employee_rate) || 0,
    insurable_earnings_ceiling: Number(row.insurable_earnings_ceiling) || 0,
  };
}

export function mapCasualTaxConfigRow(
  row: Record<string, unknown> | null | undefined,
): CasualTaxRateConfig | null {
  if (!row) {
    return null;
  }

  const flatRate = row.flat_rate ?? row.rate ?? row.tax_rate;

  return {
    flat_rate: Number(flatRate) || 0,
  };
}

function parseBandFrom(row: Record<string, unknown>): number {
  const raw = row.lower_bound ?? row.band_from;
  return Number(raw) || 0;
}

function parseBandTo(row: Record<string, unknown>): number | null {
  const raw = row.upper_bound ?? row.band_to;

  if (raw === null || raw === undefined || raw === "") {
    return null;
  }

  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  return value;
}

function parseBandRate(row: Record<string, unknown>): number {
  return Number(row.rate) || 0;
}

export function mapPayeBandFromRecord(
  row: Record<string, unknown>,
): PayeTaxBand {
  return {
    band_order:
      row.band_order === null || row.band_order === undefined
        ? undefined
        : Number(row.band_order),
    band_from: parseBandFrom(row),
    band_to: parseBandTo(row),
    rate: parseBandRate(row),
  };
}

export function normalizeEffectiveDateKey(value: unknown): string {
  if (value == null || value === "") {
    return "";
  }

  const match = String(value).trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

export function mapPayeBandRows(
  rows: Record<string, unknown>[] | null | undefined,
): PayeTaxBand[] {
  return (rows ?? []).map((row) => mapPayeBandFromRecord(row));
}
