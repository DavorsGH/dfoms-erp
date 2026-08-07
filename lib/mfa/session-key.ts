/** Edge + Node compatible SHA-256 session fingerprint (legacy fallback). */
export async function deriveSessionKey(refreshToken: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(refreshToken),
  );
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function parseAccessTokenSessionId(accessToken: string): string | null {
  try {
    const parts = accessToken.split(".");
    if (parts.length < 2) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as {
      session_id?: string;
    };
    return typeof payload.session_id === "string" ? payload.session_id : null;
  } catch {
    return null;
  }
}

/** Stable across refresh-token rotation within the same Supabase auth session. */
export async function deriveSessionKeyFromAuthSession(session: {
  access_token: string;
  refresh_token: string;
}): Promise<string> {
  const sessionId = parseAccessTokenSessionId(session.access_token);
  if (sessionId) {
    return sessionId;
  }
  return deriveSessionKey(session.refresh_token);
}
