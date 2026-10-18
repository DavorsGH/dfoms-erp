export type SalaryRateEntry = {
  id: string;
  position: string;
  employment_type: string;
  shift: string;
  basic_salary: number;
  effective_date: string;
  business_unit_id?: string | null;
};

export function sortSalaryRates(rows: SalaryRateEntry[]): SalaryRateEntry[] {
  return rows.slice().sort((a, b) => {
    const dateCmp = b.effective_date.localeCompare(a.effective_date);
    if (dateCmp !== 0) {
      return dateCmp;
    }
    const posCmp = a.position.localeCompare(b.position);
    if (posCmp !== 0) {
      return posCmp;
    }
    const typeCmp = a.employment_type.localeCompare(b.employment_type);
    if (typeCmp !== 0) {
      return typeCmp;
    }
    return a.shift.localeCompare(b.shift);
  });
}

export function mergeSalaryRateIntoList(
  list: SalaryRateEntry[],
  saved: SalaryRateEntry,
): SalaryRateEntry[] {
  const next = list.filter((row) => row.id !== saved.id);
  next.push(saved);
  return sortSalaryRates(next);
}

export function isFutureSalaryRateEffectiveDate(effectiveDate: string): boolean {
  const day = effectiveDate.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return false;
  }
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return day > today;
}

export const SALARY_RATE_EMPLOYMENT_TYPES = [
  "Casual",
  "Part-Time",
  "Full-Time",
  "Contract",
] as const;

/** Includes Night / Rotating for Global Salary Settings (script 117). */
export const SALARY_RATE_SHIFTS = [
  "Full Day",
  "Morning",
  "Afternoon",
  "Night",
  "Rotating",
] as const;
