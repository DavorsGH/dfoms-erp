export const SALES_CRM_ALERT_TITLE = "Could not complete action";

export const SALES_CRM_GENERIC_ERROR =
  "Something went wrong. Please try again.";

export const SALES_CRM_GENERIC_SAVE_ERROR =
  "Something went wrong saving this. Please try again.";

function looksLikePostgresSystemMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("violates") ||
    lower.includes("duplicate key") ||
    lower.includes("postgres")
  );
}

/** Client-side Supabase/direct errors shown in Sales & CRM modals. */
export function clientFacingSalesCrmError(
  message: string | null | undefined,
  fallback = SALES_CRM_GENERIC_SAVE_ERROR,
): string {
  if (!message?.trim()) {
    return fallback;
  }
  if (looksLikePostgresSystemMessage(message)) {
    console.error("[sales-crm]", message);
    return fallback;
  }
  return message;
}
