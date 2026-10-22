export const RECEIPT_PAPER_OPTIONS = ["58mm", "80mm", "a4"] as const;
export const LABEL_SIZE_OPTIONS = [
  "50x25",
  "40x30",
  "60x40",
  "a4_sheet",
] as const;

export type ReceiptPaper = (typeof RECEIPT_PAPER_OPTIONS)[number];

export function receiptPaperOptionLabel(paper: ReceiptPaper): string {
  if (paper === "80mm") {
    return "80mm roll (72mm printable)";
  }
  if (paper === "58mm") {
    return "58mm roll (48mm printable)";
  }
  return "A4";
}
export type LabelSize = (typeof LABEL_SIZE_OPTIONS)[number];

export type TenantDeviceSettings = {
  scanner_min_length: number;
  scanner_max_gap_ms: number;
  receipt_paper: ReceiptPaper;
  label_size: LabelSize;
  offline_alert_minutes: number;
  working_hours_start: string;
  working_hours_end: string;
};

export const TENANT_DEVICE_SETTINGS_DEFAULTS: TenantDeviceSettings = {
  scanner_min_length: 3,
  scanner_max_gap_ms: 50,
  receipt_paper: "80mm",
  label_size: "50x25",
  offline_alert_minutes: 30,
  working_hours_start: "06:00",
  working_hours_end: "20:00",
};

function asInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function asHm(value: unknown, fallback: string): string {
  const match = String(value ?? "")
    .trim()
    .match(/^(\d{2}):(\d{2})/);
  if (!match) {
    return fallback;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    return fallback;
  }
  return `${match[1]}:${match[2]}`;
}

export function normalizeTenantDeviceSettings(
  row: Partial<Record<keyof TenantDeviceSettings, unknown>> | null | undefined,
): TenantDeviceSettings {
  const defaults = TENANT_DEVICE_SETTINGS_DEFAULTS;
  const paper = row?.receipt_paper;
  const label = row?.label_size;
  return {
    scanner_min_length: asInt(row?.scanner_min_length, defaults.scanner_min_length, 1, 64),
    scanner_max_gap_ms: asInt(row?.scanner_max_gap_ms, defaults.scanner_max_gap_ms, 10, 2000),
    receipt_paper: RECEIPT_PAPER_OPTIONS.includes(paper as ReceiptPaper)
      ? (paper as ReceiptPaper)
      : defaults.receipt_paper,
    label_size: LABEL_SIZE_OPTIONS.includes(label as LabelSize)
      ? (label as LabelSize)
      : defaults.label_size,
    offline_alert_minutes: asInt(
      row?.offline_alert_minutes,
      defaults.offline_alert_minutes,
      1,
      24 * 60,
    ),
    working_hours_start: asHm(row?.working_hours_start, defaults.working_hours_start),
    working_hours_end: asHm(row?.working_hours_end, defaults.working_hours_end),
  };
}

export function deviceSettingsWriteRow(
  settings: TenantDeviceSettings,
): TenantDeviceSettings {
  return {
    ...settings,
    working_hours_start: `${settings.working_hours_start}:00`,
    working_hours_end: `${settings.working_hours_end}:00`,
  };
}
