/**
 * Shared {{variable}} substitution and plain-text → email body helpers
 * for message templates (campaigns + transactional notifications).
 */

export function substituteTemplatePlaceholders(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(
    /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
    (match, key: string) => {
      if (Object.prototype.hasOwnProperty.call(vars, key)) {
        return vars[key];
      }
      return match;
    },
  );
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Convert a template body to HTML for Resend (keeps existing HTML as-is). */
export function templateBodyToEmailHtml(body: string): string {
  const trimmed = body.trimEnd();
  if (trimmed.includes("<")) {
    return trimmed;
  }
  return trimmed
    .split(/\n/)
    .map((line) => `<p>${escapeHtml(line) || "&nbsp;"}</p>`)
    .join("");
}
