export type SalaryRateEntry = {
  id: string;
  position: string;
  employment_type: string;
  shift: string;
  basic_salary: number;
  effective_date: string;
};

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
