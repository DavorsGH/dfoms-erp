export function readMustChangeState(
  appMetadata: Record<string, unknown> | null | undefined,
): {
  mustChange: boolean;
  expired: boolean;
  expiresAt: string | null;
} {
  const meta = appMetadata ?? {};
  const mustChange = meta.must_change_password === true;
  const expiresAt =
    typeof meta.temp_password_expires_at === "string"
      ? meta.temp_password_expires_at
      : null;
  let expired = false;
  if (mustChange && expiresAt) {
    const ms = new Date(expiresAt).getTime();
    if (!Number.isNaN(ms) && ms < Date.now()) {
      expired = true;
    }
  }
  return { mustChange, expired, expiresAt };
}
