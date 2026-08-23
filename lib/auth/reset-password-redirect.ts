import type { ResolvedPersona } from "@/lib/auth/oauth-persona-resolve";
import { PORTAL_CHOOSER_PATH } from "@/utils/portal-chooser";

export type PasswordResetDestination = {
  loginPath: string;
  successMessage: string;
  persona: ResolvedPersona["persona"] | null;
};

const PERSONA_DESTINATIONS: Record<
  ResolvedPersona["persona"],
  PasswordResetDestination
> = {
  staff: {
    loginPath: "/login",
    successMessage: "Password updated — taking you to the staff login.",
    persona: "staff",
  },
  lessee: {
    loginPath: "/portal/login",
    successMessage: "Password updated — taking you to the Tenant Portal login.",
    persona: "lessee",
  },
  landlord: {
    loginPath: "/landlord-portal/login",
    successMessage:
      "Password updated — taking you to the Landlord Portal login.",
    persona: "landlord",
  },
};

/**
 * Post-recovery redirect after password update.
 * Uses the same active-persona priority as findAnyPersonaByAuthUid:
 * staff → lessee → landlord. No active persona → portal chooser.
 */
export function passwordResetDestinationForPersona(
  persona: ResolvedPersona | null,
): PasswordResetDestination {
  if (!persona) {
    return {
      loginPath: PORTAL_CHOOSER_PATH,
      successMessage: "Password updated — choose your portal to sign in.",
      persona: null,
    };
  }

  return PERSONA_DESTINATIONS[persona.persona];
}
