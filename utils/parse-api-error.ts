/**
 * Parse a failed fetch Response into a user-visible error string.
 */
export async function parseApiErrorResponse(
  response: Response,
  fallback: string,
): Promise<string> {
  const text = await response.text().catch(() => "");

  if (text.trim()) {
    try {
      const json = JSON.parse(text) as {
        error?: string | { message?: string };
        message?: string;
      };

      if (typeof json.error === "string" && json.error.trim()) {
        return json.error.trim();
      }

      if (
        json.error &&
        typeof json.error === "object" &&
        typeof json.error.message === "string" &&
        json.error.message.trim()
      ) {
        return json.error.message.trim();
      }

      if (typeof json.message === "string" && json.message.trim()) {
        return json.message.trim();
      }
    } catch {
      const trimmed = text.trim();
      if (trimmed.startsWith("<")) {
        return `${fallback} (HTTP ${response.status}: non-JSON response — the route may not be deployed yet).`;
      }
      return trimmed.slice(0, 500);
    }
  }

  if (response.status === 404) {
    return `${fallback} (HTTP 404 — API route not found; deploy the latest build).`;
  }

  return `${fallback} (HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}).`;
}
