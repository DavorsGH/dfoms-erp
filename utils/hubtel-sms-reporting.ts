import "server-only";

import {
  getHubtelCredentials,
  HUBTEL_SMS_API_BASE,
  maskHubtelClientId,
  describeHubtelClientId,
} from "@/utils/hubtel-api";

export type HubtelSmsReportingResult = {
  available: boolean;
  outboundSendCount: number | null;
  endpoint: string | null;
  configuredClientId: string | null;
  configuredClientIdLabel: string | null;
  error: string | null;
};

type HubtelQueryMessageResponse = {
  TotalPages?: unknown;
  totalPages?: unknown;
  Messages?: unknown;
  messages?: unknown;
};

function countOutboundMessages(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const body = payload as HubtelQueryMessageResponse;
  const messages = body.Messages ?? body.messages;
  if (!Array.isArray(messages)) {
    return null;
  }

  return messages.filter((entry) => {
    if (!entry || typeof entry !== "object") {
      return false;
    }
    const direction = (entry as Record<string, unknown>).Direction ??
      (entry as Record<string, unknown>).direction;
    if (typeof direction !== "string") {
      return true;
    }
    return direction.trim().toLowerCase() === "out";
  }).length;
}

function readTotalPages(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const body = payload as HubtelQueryMessageResponse;
  const candidate = body.TotalPages ?? body.totalPages;
  const parsed = Number(candidate);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Attempt to count outbound sends from Hubtel's message log API (GET /v1/messages).
 * Community SDKs document queryMessage() against this path; Hubtel programmable keys
 * currently return HTTP 404 — dashboard (Messaging → SMS → API) is the source of record.
 */
export async function fetchHubtelReportedOutboundSendCount(): Promise<HubtelSmsReportingResult> {
  const credentials = getHubtelCredentials();
  if (!credentials) {
    return {
      available: false,
      outboundSendCount: null,
      endpoint: null,
      configuredClientId: null,
      configuredClientIdLabel: null,
      error: "HUBTEL_CLIENT_ID / HUBTEL_CLIENT_SECRET are not configured.",
    };
  }

  const { clientId, authHeader } = credentials;
  const configuredClientId = maskHubtelClientId(clientId);
  const configuredClientIdLabel = describeHubtelClientId(clientId);
  const endpoint = `${HUBTEL_SMS_API_BASE}/messages`;

  try {
    const firstPageUrl = `${endpoint}?limit=100&Page=1`;
    const response = await fetch(firstPageUrl, {
      method: "GET",
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    const bodyText = await response.text().catch(() => "");
    let parsed: unknown = null;
    try {
      parsed = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      parsed = null;
    }

    if (response.status === 404) {
      return {
        available: false,
        outboundSendCount: null,
        endpoint,
        configuredClientId,
        configuredClientIdLabel,
        error:
          "Hubtel programmable SMS keys do not expose a message log list API (GET /v1/messages → 404). Per-message lookup by ID works; aggregate send counts require the Hubtel dashboard (Messaging → SMS → API) or downloadable reports.",
      };
    }

    if (!response.ok) {
      return {
        available: false,
        outboundSendCount: null,
        endpoint,
        configuredClientId,
        configuredClientIdLabel,
        error: `HTTP ${response.status} from ${endpoint}`,
      };
    }

    const firstPageCount = countOutboundMessages(parsed);
    if (firstPageCount === null) {
      return {
        available: false,
        outboundSendCount: null,
        endpoint,
        configuredClientId,
        configuredClientIdLabel,
        error: `Unexpected response shape from ${endpoint}`,
      };
    }

    const totalPages = readTotalPages(parsed) ?? 1;
    if (totalPages <= 1) {
      return {
        available: true,
        outboundSendCount: firstPageCount,
        endpoint,
        configuredClientId,
        configuredClientIdLabel,
        error: null,
      };
    }

    let outboundSendCount = firstPageCount;
    for (let page = 2; page <= totalPages; page += 1) {
      const pageResponse = await fetch(`${endpoint}?limit=100&Page=${page}`, {
        method: "GET",
        headers: {
          Authorization: authHeader,
          Accept: "application/json",
        },
        cache: "no-store",
      });

      if (!pageResponse.ok) {
        return {
          available: false,
          outboundSendCount: null,
          endpoint,
          configuredClientId,
          configuredClientIdLabel,
          error: `HTTP ${pageResponse.status} while paging ${endpoint}`,
        };
      }

      const pageText = await pageResponse.text().catch(() => "");
      let pageParsed: unknown = null;
      try {
        pageParsed = pageText ? JSON.parse(pageText) : null;
      } catch {
        pageParsed = null;
      }

      const pageCount = countOutboundMessages(pageParsed);
      if (pageCount === null) {
        return {
          available: false,
          outboundSendCount: null,
          endpoint,
          configuredClientId,
          configuredClientIdLabel,
          error: `Unexpected response shape on page ${page} from ${endpoint}`,
        };
      }

      outboundSendCount += pageCount;
    }

    return {
      available: true,
      outboundSendCount,
      endpoint,
      configuredClientId,
      configuredClientIdLabel,
      error: null,
    };
  } catch (error) {
    return {
      available: false,
      outboundSendCount: null,
      endpoint,
      configuredClientId,
      configuredClientIdLabel,
      error:
        error instanceof Error
          ? `${endpoint}: ${error.message}`
          : `${endpoint}: request failed`,
    };
  }
}
