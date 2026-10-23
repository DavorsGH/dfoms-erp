import type { PortalLoginVerificationMethod } from "./types";
import { PORTAL_LOGIN_VERIFICATION_OPTIONS } from "./types";

const METHOD_SET = new Set(
  PORTAL_LOGIN_VERIFICATION_OPTIONS.map((option) => option.value),
);

export function parseVerificationFields(body: {
  verification_method?: unknown;
  reason?: unknown;
}):
  | {
      ok: true;
      verificationMethod: PortalLoginVerificationMethod;
      reason: string;
    }
  | { ok: false; error: string; field?: "verification_method" | "reason" } {
  const methodRaw =
    typeof body.verification_method === "string"
      ? body.verification_method.trim()
      : "";
  if (!METHOD_SET.has(methodRaw as PortalLoginVerificationMethod)) {
    return {
      ok: false,
      error: "How was the user verified? is required.",
      field: "verification_method",
    };
  }

  const reason =
    typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) {
    return {
      ok: false,
      error: "Reason is required.",
      field: "reason",
    };
  }

  return {
    ok: true,
    verificationMethod: methodRaw as PortalLoginVerificationMethod,
    reason: reason.slice(0, 500),
  };
}
