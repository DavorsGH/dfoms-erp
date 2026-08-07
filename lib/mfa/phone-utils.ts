import "server-only";

/** Strip spaces/dashes; compare Ghana local vs 233 international forms. */
export function normalizePhoneDigits(value: string): string {
  return value.replace(/[\s\-()]/g, "");
}

export function toGhanaE164(value: string): string | null {
  const digits = normalizePhoneDigits(value).replace(/\D/g, "");
  if (!digits) return null;

  if (digits.startsWith("233") && digits.length >= 12) {
    return `+${digits}`;
  }
  if (digits.startsWith("0") && digits.length === 10) {
    return `+233${digits.slice(1)}`;
  }
  if (digits.length === 9) {
    return `+233${digits}`;
  }
  return digits.length >= 10 ? `+${digits.replace(/^\+/, "")}` : null;
}

export function maskPhoneE164(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  if (digits.length <= 4) return "****";
  return `***${digits.slice(-4)}`;
}

export function phonesRoughlyMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return false;
  const left = normalizePhoneDigits(a).replace(/\D/g, "");
  const right = normalizePhoneDigits(b).replace(/\D/g, "");
  if (left === right) return true;
  const stripGh = (d: string) =>
    d.startsWith("233") && d.length >= 12 ? `0${d.slice(3)}` : d;
  return stripGh(left) === stripGh(right);
}
