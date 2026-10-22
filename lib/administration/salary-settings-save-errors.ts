import type { PostgrestError } from "@supabase/supabase-js";
import {
  extractPostgresUniqueConstraintName,
  isPostgresUniqueViolation,
} from "@/utils/postgres-fk-violation";

export const SALARY_RATE_CONFIG_LEGACY_UNIQUE =
  "salary_rate_config_position_employment_type_shift_effective_key" as const;

export const SALARY_RATE_CONFIG_TENANT_BU_UNIQUE =
  "salary_rate_config_tenant_bu_position_type_shift_effective_key" as const;

export const ALLOWANCE_TYPES_TENANT_CODE_UNIQUE =
  "allowance_types_tenant_code_key" as const;

export const COMPENSATION_POLICY_MATRIX_UNIQUE = "compensation_policy_key" as const;

function formatEffectiveDateLabel(effectiveDate: string): string {
  const iso = effectiveDate.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    return effectiveDate.trim() || "that date";
  }
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function salaryRateDuplicateUserMessage(args: {
  position: string;
  employment_type: string;
  shift: string;
  effective_date: string;
}): string {
  const dateLabel = formatEffectiveDateLabel(args.effective_date);
  return `A salary rate for ${args.position} / ${args.employment_type} / ${args.shift} from ${dateLabel} already exists. Edit the existing rate instead.`;
}

export function mapSalaryRateConfigSaveError(
  error: PostgrestError | null,
  form: {
    position: string;
    employment_type: string;
    shift: string;
    effective_date: string;
  },
): string | null {
  if (!error || !isPostgresUniqueViolation(error)) {
    return null;
  }
  const name = extractPostgresUniqueConstraintName(error.message);
  if (
    name === SALARY_RATE_CONFIG_LEGACY_UNIQUE ||
    name === SALARY_RATE_CONFIG_TENANT_BU_UNIQUE ||
    (error.message ?? "").includes("salary_rate_config_position_employment")
  ) {
    return salaryRateDuplicateUserMessage(form);
  }
  return null;
}

export function mapAllowanceTypeSaveError(
  error: PostgrestError | null,
  code: string,
): string | null {
  if (!error || !isPostgresUniqueViolation(error)) {
    return null;
  }
  const name = extractPostgresUniqueConstraintName(error.message);
  if (
    name === ALLOWANCE_TYPES_TENANT_CODE_UNIQUE ||
    (error.message ?? "").includes("allowance_types_tenant_code")
  ) {
    return `An allowance type with code “${code}” already exists. Edit the existing type instead.`;
  }
  return null;
}

export function mapCompensationPolicySaveError(
  error: PostgrestError | null,
  combo: { position: string; employment_type: string; shift: string },
): string | null {
  if (!error || !isPostgresUniqueViolation(error)) {
    return null;
  }
  const name = extractPostgresUniqueConstraintName(error.message);
  if (
    name === COMPENSATION_POLICY_MATRIX_UNIQUE ||
    (error.message ?? "").includes("compensation_policy_key")
  ) {
    return `Allowance amounts for ${combo.position} / ${combo.employment_type} / ${combo.shift} already exist. Use Edit on that row instead.`;
  }
  return null;
}

export const SALARY_SETTINGS_GENERIC_SAVE_ERROR =
  "We couldn't save your changes. Check your connection and try again." as const;
