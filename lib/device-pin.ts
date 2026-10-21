export type DevicePinMapping = {
  staff_id: string;
  device_pin: string;
};

/** Numeric part of a staff ID with leading zeros removed. DF0020 -> "20". */
export function pinFromStaffId(staffId: string): string | null {
  const digits = staffId.replace(/\D/g, "").replace(/^0+/, "");
  return digits || null;
}

/** Strip non-digits and leading zeros so "0020" and "20" compare as the same PIN. */
export function normalizeDevicePin(pin: string | null | undefined): string {
  return (pin ?? "").replace(/\D/g, "").replace(/^0+/, "");
}

export function devicePinsMatch(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const normalizedLeft = normalizeDevicePin(left);
  const normalizedRight = normalizeDevicePin(right);
  return normalizedLeft.length > 0 && normalizedLeft === normalizedRight;
}

/**
 * Match an incoming punch PIN to a stored mapping.
 * Exact stored text wins; otherwise both sides are normalized.
 */
export function resolveStaffIdForDevicePin(
  incomingPin: string,
  mappings: readonly DevicePinMapping[],
): string | null {
  const raw = incomingPin.trim();
  const exact = mappings.find((row) => row.device_pin === raw);
  if (exact) {
    return exact.staff_id;
  }
  const normalized = normalizeDevicePin(raw);
  if (!normalized) {
    return null;
  }
  const match = mappings.find(
    (row) => normalizeDevicePin(row.device_pin) === normalized,
  );
  return match?.staff_id ?? null;
}

export function findDevicePinClash(
  pin: string,
  staffId: string,
  mappings: readonly (DevicePinMapping & { full_name?: string | null })[],
): (DevicePinMapping & { full_name?: string | null }) | null {
  const normalized = normalizeDevicePin(pin);
  if (!normalized) {
    return null;
  }
  return (
    mappings.find(
      (row) =>
        row.staff_id !== staffId &&
        normalizeDevicePin(row.device_pin) === normalized,
    ) ?? null
  );
}

export function devicePinClashMessage(
  pin: string,
  clash: { staff_id: string; full_name?: string | null },
): string {
  const name = clash.full_name?.trim();
  return name
    ? `PIN ${normalizeDevicePin(pin)} is already used by ${clash.staff_id} ${name}`
    : `PIN ${normalizeDevicePin(pin)} is already used by ${clash.staff_id}`;
}
