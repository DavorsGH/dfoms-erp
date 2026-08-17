import { cookies } from "next/headers";
import {
  OAUTH_FLOW_COOKIE,
  OAUTH_FLOW_TTL_MS,
  type OAuthFlowPayload,
} from "@/lib/auth/oauth-types";

function getSigningSecret(): string | null {
  const secret =
    process.env.MIDDLEWARE_CONTEXT_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    null;
  return secret || null;
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

export async function signOAuthFlowPayload(
  payload: OAuthFlowPayload,
): Promise<string | null> {
  const secret = getSigningSecret();
  if (!secret) {
    return null;
  }

  const body = JSON.stringify({
    ...payload,
    issued_at: payload.issued_at ?? Date.now(),
  });
  const payloadB64 = btoa(body);
  const signature = await hmacSign(payloadB64, secret);
  return `${payloadB64}.${signature}`;
}

export async function verifyOAuthFlowPayload(
  value: string | null | undefined,
): Promise<OAuthFlowPayload | null> {
  if (!value) {
    return null;
  }

  const secret = getSigningSecret();
  if (!secret) {
    return null;
  }

  const dot = value.lastIndexOf(".");
  if (dot <= 0) {
    return null;
  }

  const payloadB64 = value.slice(0, dot);
  const signature = value.slice(dot + 1);
  const valid = await hmacVerify(payloadB64, signature, secret);
  if (!valid) {
    return null;
  }

  try {
    const parsed = JSON.parse(atob(payloadB64)) as OAuthFlowPayload;
    if (!parsed.persona || !parsed.flow || typeof parsed.issued_at !== "number") {
      return null;
    }
    if (Date.now() - parsed.issued_at > OAUTH_FLOW_TTL_MS) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function setOAuthFlowCookie(payload: OAuthFlowPayload): Promise<void> {
  const signed = await signOAuthFlowPayload(payload);
  if (!signed) {
    throw new Error("OAuth flow signing is not configured.");
  }

  const cookieStore = await cookies();
  cookieStore.set(OAUTH_FLOW_COOKIE, signed, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(OAUTH_FLOW_TTL_MS / 1000),
  });
}

export async function readOAuthFlowCookie(): Promise<OAuthFlowPayload | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(OAUTH_FLOW_COOKIE)?.value ?? null;
  return verifyOAuthFlowPayload(raw);
}

export async function clearOAuthFlowCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(OAUTH_FLOW_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
