import type { AppRole } from "@/app/dashboard/user-account-types";

export type AssistantChatPersona =
  | "staff"
  | "landlord"
  | "tenant"
  | "facility_manager";

const STAFF_SUGGESTION_PROFIT =
  "How much profit did we make last month?";
const STAFF_SUGGESTION_UNTAGGED_COSTS =
  "What costs are not tagged to a contract this month?";
const STAFF_SUGGESTION_LOW_CONSUMABLES =
  "Which consumables are low?";
const STAFF_SUGGESTION_BUDGET = "How do I set a monthly budget?";
const STAFF_SUGGESTION_DIVIDEND =
  "Can we pay a dividend this quarter?";

/** Landlord portal — aligned with handbook + landlord assistant tools. */
const LANDLORD_SUGGESTIONS: readonly string[] = [
  "Which of my properties have vacant units?",
  "How much rent was collected this month?",
  "Which leases are expiring soon?",
];

/** Lessee (tenant) portal — rent balance, lease, repairs tools. */
const TENANT_SUGGESTIONS: readonly string[] = [
  "How much rent do I owe?",
  "What is my lease status?",
  "What repair requests have I submitted?",
];

/** Facility manager portal — assigned properties, maintenance, collections. */
const FACILITY_MANAGER_SUGGESTIONS: readonly string[] = [
  "Which properties am I assigned to?",
  "What open maintenance requests do I have?",
  "What collections are still pending confirmation?",
];

function isDirectorOrSuperAdmin(role: AppRole | null | undefined): boolean {
  return role === "director" || role === "super_admin";
}

export function getAssistantChatSuggestions(input: {
  persona: AssistantChatPersona;
  staffRole?: AppRole | null;
}): string[] {
  switch (input.persona) {
    case "landlord":
      return [...LANDLORD_SUGGESTIONS];
    case "tenant":
      return [...TENANT_SUGGESTIONS];
    case "facility_manager":
      return [...FACILITY_MANAGER_SUGGESTIONS];
    case "staff":
    default: {
      const fourth = isDirectorOrSuperAdmin(input.staffRole)
        ? STAFF_SUGGESTION_DIVIDEND
        : STAFF_SUGGESTION_BUDGET;
      return [
        STAFF_SUGGESTION_PROFIT,
        STAFF_SUGGESTION_UNTAGGED_COSTS,
        STAFF_SUGGESTION_LOW_CONSUMABLES,
        fourth,
      ];
    }
  }
}

/** For audit reports — proposed portal chips (same as runtime). */
export const ASSISTANT_PORTAL_SUGGESTION_CATALOG = {
  landlord: LANDLORD_SUGGESTIONS,
  tenant: TENANT_SUGGESTIONS,
  facility_manager: FACILITY_MANAGER_SUGGESTIONS,
} as const;
