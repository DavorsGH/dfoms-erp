import type { ContractProjectOption } from "../administration/projects-utils";
import type { NamedLookup } from "../lookup-types";
import {
  formatPaymentSourceLabel,
  type AccountsPayablePaymentSource,
} from "./accounts-payable-utils";

function isAccountsPayablePaymentSource(
  value: string,
): value is AccountsPayablePaymentSource {
  return value === "company_cash" || value === "directors_loan";
}

/** Same labels as payment method dropdowns + AP settlement source labels. */
export function resolveRegisterPaymentMethodLabel(
  stored: string | null | undefined,
  paymentMethods: NamedLookup[],
): string {
  const trimmed = (stored ?? "").trim();
  if (!trimmed) {
    return "—";
  }

  const exact = paymentMethods.find((method) => method.name === trimmed);
  if (exact) {
    return exact.name;
  }

  const normalized = trimmed.toLowerCase();
  const caseInsensitive = paymentMethods.find(
    (method) => method.name.toLowerCase() === normalized,
  );
  if (caseInsensitive) {
    return caseInsensitive.name;
  }

  if (isAccountsPayablePaymentSource(trimmed)) {
    return formatPaymentSourceLabel(trimmed);
  }

  return trimmed;
}

/** Depreciation method and similar name-keyed lookups. */
export function resolveNamedLookupLabel(
  stored: string | null | undefined,
  options: NamedLookup[],
): string {
  const trimmed = (stored ?? "").trim();
  if (!trimmed) {
    return "—";
  }

  const exact = options.find((option) => option.name === trimmed);
  if (exact) {
    return exact.name;
  }

  const normalized = trimmed.toLowerCase();
  const caseInsensitive = options.find(
    (option) => option.name.toLowerCase() === normalized,
  );
  if (caseInsensitive) {
    return caseInsensitive.name;
  }

  return trimmed;
}

export function resolveProjectOptionLabel(
  projectId: string | null | undefined,
  projects: ContractProjectOption[],
): string {
  if (!projectId?.trim()) {
    return "—";
  }

  const match = projects.find((project) => project.id === projectId);
  if (!match) {
    return projectId;
  }

  return `${match.project_code} — ${match.project_name}`;
}
