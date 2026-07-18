import {
  generateNextOperationsId,
  parseOperationsIdNumber,
} from "@/app/dashboard/operations/operations-register-utils";

export const DAVORS_TENANT_ID = "00000001-0000-4000-8000-000000000001";

export const ERP_SUITE_SIGNUP_SOURCE = "erp_suite_signup";
export const ERP_SUITE_CUSTOMER_TYPE = "digital_subscriber";
export const ERP_SUITE_CUSTOMER_STATUS = "lead";
export const ERP_SUITE_TRIAL_DAYS = 90;

/** Production crm_subscriptions.subscription_status CHECK values (TEXT, not enum). */
export type CrmSubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "restricted"
  | "cancelled";

export const ERP_SUITE_SUBSCRIPTION_STATUS: CrmSubscriptionStatus = "trialing";

export type SignupRequestBody = {
  company_name?: string;
  admin_full_name?: string;
  admin_email?: string;
  password?: string;
  confirm_password?: string;
};

export type SignupValidationResult =
  | { ok: true; data: SignupValidatedInput }
  | { ok: false; error: string };

export type SignupValidatedInput = {
  companyName: string;
  adminFullName: string;
  adminEmail: string;
  password: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeSignupEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validateSignupInput(body: SignupRequestBody): SignupValidationResult {
  const companyName = body.company_name?.trim() ?? "";
  const adminFullName = body.admin_full_name?.trim() ?? "";
  const adminEmail = normalizeSignupEmail(body.admin_email ?? "");
  const password = body.password ?? "";
  const confirmPassword = body.confirm_password ?? "";

  if (!companyName) {
    return { ok: false, error: "Company name is required." };
  }

  if (!adminFullName) {
    return { ok: false, error: "Admin full name is required." };
  }

  if (!adminEmail || !EMAIL_PATTERN.test(adminEmail)) {
    return { ok: false, error: "A valid admin email is required." };
  }

  if (!password) {
    return { ok: false, error: "Password is required." };
  }

  if (password.length < 6) {
    return {
      ok: false,
      error: "Password must be at least 6 characters.",
    };
  }

  if (password !== confirmPassword) {
    return { ok: false, error: "Password and confirmation do not match." };
  }

  return {
    ok: true,
    data: {
      companyName,
      adminFullName,
      adminEmail,
      password,
    },
  };
}

export function slugifyCompanyName(companyName: string): string {
  const slug = companyName
    .toLowerCase()
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return slug || "company";
}

export function buildUniqueSlugCandidates(baseSlug: string): string[] {
  const candidates = [baseSlug];

  for (let suffix = 2; suffix <= 99; suffix += 1) {
    const suffixText = `-${suffix}`;
    candidates.push(`${baseSlug.slice(0, Math.max(1, 48 - suffixText.length))}${suffixText}`);
  }

  return candidates;
}

export function generateNextCustomerClientId(existingClientIds: string[]): string {
  return generateNextOperationsId("CLI", 3, existingClientIds);
}

export function addTrialDays(referenceDate: Date, days: number): string {
  const end = new Date(referenceDate);
  end.setUTCDate(end.getUTCDate() + days);
  return end.toISOString().slice(0, 10);
}

export function isDuplicateSlugError(message: string): boolean {
  return /tenants_slug_unique|duplicate key value violates unique constraint.*slug/i.test(
    message,
  );
}

export function isDuplicateClientIdError(message: string): boolean {
  return /customers_pkey|clients_pkey|duplicate key value violates unique constraint.*client_id/i.test(
    message,
  );
}

export function isDuplicateEmailError(message: string): boolean {
  return /already registered|already exists|duplicate key value/i.test(message);
}

export { parseOperationsIdNumber };
