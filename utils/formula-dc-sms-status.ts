import "server-only";

const FORMULA_DC_API_BASE = "https://api.formula-dc.com/api/v1/external/sms";

export type FormulaDcStatusProbe = {
  url: string;
  method: "GET" | "POST";
  httpStatus: number;
  body: unknown;
};

function parseJsonOrText(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text.slice(0, 2000);
  }
}

/**
 * Probe likely Formula-DC message status endpoints (undocumented in our adapter spec).
 * Returns every candidate response so we can identify the real lookup path.
 */
export async function probeFormulaDcMessageStatus(
  messageId: string,
): Promise<FormulaDcStatusProbe[]> {
  const apiKey = (process.env.FORMULA_DC_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new Error("FORMULA_DC_API_KEY is not configured.");
  }

  const id = messageId.trim();
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  const candidates: Array<{ method: "GET" | "POST"; url: string; body?: string }> =
    [
      { method: "GET", url: `${FORMULA_DC_API_BASE}/${encodeURIComponent(id)}` },
      {
        method: "GET",
        url: `${FORMULA_DC_API_BASE}/status/${encodeURIComponent(id)}`,
      },
      {
        method: "GET",
        url: `${FORMULA_DC_API_BASE}/messages/${encodeURIComponent(id)}`,
      },
      {
        method: "GET",
        url: `${FORMULA_DC_API_BASE}/delivery/${encodeURIComponent(id)}`,
      },
      {
        method: "GET",
        url: `${FORMULA_DC_API_BASE}/send/${encodeURIComponent(id)}`,
      },
      {
        method: "POST",
        url: `${FORMULA_DC_API_BASE}/status`,
        body: JSON.stringify({ message_id: id }),
      },
      {
        method: "POST",
        url: `${FORMULA_DC_API_BASE}/status`,
        body: JSON.stringify({ id }),
      },
    ];

  const results: FormulaDcStatusProbe[] = [];

  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate.url, {
        method: candidate.method,
        headers,
        body: candidate.method === "POST" ? candidate.body : undefined,
      });
      const text = await response.text().catch(() => "");
      results.push({
        url: candidate.url,
        method: candidate.method,
        httpStatus: response.status,
        body: parseJsonOrText(text),
      });
    } catch (error) {
      results.push({
        url: candidate.url,
        method: candidate.method,
        httpStatus: 0,
        body: {
          error: error instanceof Error ? error.message : "Request failed",
        },
      });
    }
  }

  return results;
}

/** Best-effort extract delivery status string from a probe response body. */
export function extractFormulaDcDeliveryStatus(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const root = body as Record<string, unknown>;
  const data =
    root.data && typeof root.data === "object"
      ? (root.data as Record<string, unknown>)
      : root;

  for (const key of ["status", "delivery_status", "message_status", "state"]) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}
