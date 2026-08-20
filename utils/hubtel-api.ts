import "server-only";

/** Base URL used by sendHubtelSms() and Hubtel read APIs that respond on this host. */
export const HUBTEL_SMS_API_BASE = "https://sms.hubtel.com/v1";

export type HubtelClientIdLabel =
  | "kzfuyywi"
  | "npegoiax"
  | "other";

export function getHubtelCredentials():
  | { clientId: string; clientSecret: string; authHeader: string }
  | null {
  const clientId = (process.env.HUBTEL_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.HUBTEL_CLIENT_SECRET ?? "").trim();
  if (!clientId || !clientSecret) {
    return null;
  }

  return {
    clientId,
    clientSecret,
    authHeader: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
  };
}

export function maskHubtelClientId(clientId: string): string {
  if (clientId.length <= 4) {
    return "****";
  }
  return `${clientId.slice(0, 2)}…${clientId.slice(-2)}`;
}

export function getHubtelClientIdLabel(clientId: string): HubtelClientIdLabel {
  if (clientId === "kzfuyywi") return "kzfuyywi";
  if (clientId === "npegoiax") return "npegoiax";
  return "other";
}

export function describeHubtelClientId(clientId: string): string {
  const label = getHubtelClientIdLabel(clientId);
  if (label === "other") {
    return `${maskHubtelClientId(clientId)} (${clientId.length} chars, not kzfuyywi or npegoiax)`;
  }
  return label;
}
