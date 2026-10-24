/**
 * Hikvision AccessControllerEvent majorEventType=5 (access / auth events).
 * Names follow ISAPI HTTP Listening / AcsEvent usage on DS-K1T terminals.
 */
export const HIKVISION_AUTH_SUCCESS_SUB_EVENT_TYPES = {
  1: "valid card",
  2: "card + password pass",
  16: "multi-factor authentication success",
  38: "fingerprint pass",
  40: "card + fingerprint pass",
  43: "card + fingerprint + password pass",
  46: "fingerprint + password pass",
  54: "face + fingerprint pass",
  57: "face + password pass",
  60: "face + card pass",
  69: "employee ID + fingerprint pass",
  75: "face pass",
  77: "employee ID + face pass",
  101: "employee ID + password pass",
} as const;

export type HikvisionSuccessSubEventType =
  keyof typeof HIKVISION_AUTH_SUCCESS_SUB_EVENT_TYPES;

export const HIKVISION_AUTH_SUCCESS_SUB_EVENT_TYPE_SET: ReadonlySet<number> =
  new Set(
    Object.keys(HIKVISION_AUTH_SUCCESS_SUB_EVENT_TYPES).map((key) =>
      Number.parseInt(key, 10),
    ),
  );

/** Known authentication failures / denials under major 5 — ignore without logging. */
export const HIKVISION_AUTH_FAILURE_SUB_EVENT_TYPE_SET: ReadonlySet<number> =
  new Set([
    3, // card + password fail
    4, // card + password timeout
    5, // card + password over attempts
    6, // no access rights
    7, // invalid period
    8, // card expired
    9, // invalid card
    10, // anti-sneak fail
    39, // fingerprint compare fail
    41, // card + fingerprint fail
    42, // card + fingerprint timeout
    44, // card + fingerprint + password fail
    45, // card + fingerprint + password timeout
    47, // fingerprint + password fail
    48, // fingerprint + password timeout
    49, // fingerprint does not exist
    55, // face + fingerprint fail
    56, // face + fingerprint timeout
    58, // face + password fail
    59, // face + password timeout
    61, // face + card fail
    62, // face + card timeout
    70, // employee ID + fingerprint fail
    71, // employee ID + fingerprint timeout
    76, // face authentication fail
    78, // employee ID + face fail
    79, // employee ID + face timeout
    102, // employee ID + password fail
  ]);

export function isHikvisionAuthSuccessSubEvent(subEventType: number): boolean {
  return HIKVISION_AUTH_SUCCESS_SUB_EVENT_TYPE_SET.has(subEventType);
}

export function isHikvisionAuthFailureSubEvent(subEventType: number): boolean {
  return HIKVISION_AUTH_FAILURE_SUB_EVENT_TYPE_SET.has(subEventType);
}
