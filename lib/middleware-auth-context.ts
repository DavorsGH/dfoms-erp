/** Signed auth context passed from Edge middleware to Node RSC (same request). */

export const AUTH_CONTEXT_HEADER = "x-dfoms-auth-context";

export type PortalKind = "staff" | "lessee" | "landlord" | "facility_manager";

export type MiddlewareAuthContext = {
  authUid: string;
  tenantId: string | null;
  role: string | null;
  employeeId: string | null;
  clientId: string | null;
  activeBusinessUnitId: string | null;
  isActive: boolean;
  portal: PortalKind;
  email: string | null;
  issuedAtMs: number;
};

const MAX_AGE_MS = 60_000;

function getSigningSecret(): string | null {
  const secret =
    process.env.MIDDLEWARE_CONTEXT_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    null;
  return secret || null;
}

export function isMiddlewareContextSigningConfigured(): boolean {
  return Boolean(getSigningSecret());
}

function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return bytesToHex(sig);
}

async function hmacVerify(
  payload: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const sigBytes = new Uint8Array(
    signature.match(/.{1,2}/g)?.map((h) => parseInt(h, 16)) ?? [],
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    sigBytes,
    new TextEncoder().encode(payload),
  );
}

export async function signAuthContext(
  ctx: Omit<MiddlewareAuthContext, "issuedAtMs"> & { issuedAtMs?: number },
): Promise<string | null> {
  const secret = getSigningSecret();
  if (!secret) {
    return null;
  }

  const payloadObj: MiddlewareAuthContext = {
    ...ctx,
    issuedAtMs: ctx.issuedAtMs ?? Date.now(),
  };

  const payload = JSON.stringify(payloadObj);
  const payloadB64 = btoa(payload);
  const signature = await hmacSign(payloadB64, secret);
  return `${payloadB64}.${signature}`;
}

export async function verifyAuthContext(
  headerValue: string | null,
): Promise<MiddlewareAuthContext | null> {
  if (!headerValue) {
    return null;
  }

  const secret = getSigningSecret();
  if (!secret) {
    return null;
  }

  const dot = headerValue.lastIndexOf(".");
  if (dot <= 0) {
    return null;
  }

  const payloadB64 = headerValue.slice(0, dot);
  const signature = headerValue.slice(dot + 1);

  const valid = await hmacVerify(payloadB64, signature, secret);
  if (!valid) {
    return null;
  }

  try {
    const ctx = JSON.parse(atob(payloadB64)) as MiddlewareAuthContext;
    if (!ctx.authUid || typeof ctx.authUid !== "string") {
      return null;
    }
    if (Date.now() - ctx.issuedAtMs > MAX_AGE_MS) {
      return null;
    }
    return ctx;
  } catch {
    return null;
  }
}
