export type HikvisionParsedEvent = {
  macAddress: string | null;
  dateTime: string | null;
  eventType: string | null;
  employeeNo: string | null;
  majorEventType: number | null;
  subEventType: number | null;
  serialNo: string | null;
  currentVerifyMode: string | null;
  attendanceStatus: string | null;
  name: string | null;
  rawText: string;
  isHeartbeat: boolean;
};

const RAW_TEXT_MAX = 4096;

function truncateRaw(text: string): string {
  return text.length <= RAW_TEXT_MAX ? text : text.slice(0, RAW_TEXT_MAX);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isHeartbeatEventType(eventType: string | null): boolean {
  if (!eventType) {
    return false;
  }
  const normalized = eventType.trim().toLowerCase();
  return (
    normalized === "heartbeat" ||
    normalized === "heartbeatevent" ||
    normalized === "heart_beat"
  );
}

export function parseHikvisionJsonObject(
  root: unknown,
  rawText: string,
): HikvisionParsedEvent {
  const top = asRecord(root) ?? {};
  const access =
    asRecord(top.AccessControllerEvent) ??
    asRecord(top.accessControllerEvent) ??
    {};

  const eventType =
    readString(top.eventType) ?? readString(top.EventType) ?? null;
  const employeeNo =
    readString(access.employeeNoString) ??
    readString(access.employeeNo) ??
    readString(access.EmployeeNoString) ??
    readString(access.EmployeeNo) ??
    null;

  return {
    macAddress: readString(top.macAddress) ?? readString(top.macAddr),
    dateTime: readString(top.dateTime) ?? readString(access.dateTime),
    eventType,
    employeeNo,
    majorEventType:
      readNumber(access.majorEventType) ?? readNumber(access.major),
    subEventType: readNumber(access.subEventType) ?? readNumber(access.minor),
    serialNo: readString(access.serialNo) ?? readString(access.SerialNo),
    currentVerifyMode: readString(access.currentVerifyMode),
    attendanceStatus: readString(access.attendanceStatus),
    name: readString(access.name) ?? readString(top.name),
    rawText: truncateRaw(rawText),
    isHeartbeat: isHeartbeatEventType(eventType),
  };
}

export function parseHikvisionJsonText(text: string): HikvisionParsedEvent | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return parseHikvisionJsonObject(JSON.parse(trimmed), trimmed);
  } catch {
    return null;
  }
}

function xmlTag(text: string, tag: string): string | null {
  const re = new RegExp(
    `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,
    "i",
  );
  const match = text.match(re);
  if (!match) {
    return null;
  }
  return match[1]?.trim() || null;
}

/** Older firmware posts `<EventNotificationAlert>` XML. */
export function parseHikvisionXmlText(text: string): HikvisionParsedEvent | null {
  const trimmed = text.trim();
  if (!trimmed || !/<EventNotificationAlert[\s>]/i.test(trimmed)) {
    return null;
  }

  const eventType = xmlTag(trimmed, "eventType");
  const employeeNo =
    xmlTag(trimmed, "employeeNoString") ?? xmlTag(trimmed, "employeeNo");
  const majorRaw = xmlTag(trimmed, "majorEventType");
  const subRaw = xmlTag(trimmed, "subEventType");

  return {
    macAddress: xmlTag(trimmed, "macAddress"),
    dateTime: xmlTag(trimmed, "dateTime"),
    eventType,
    employeeNo,
    majorEventType: majorRaw ? Number.parseInt(majorRaw, 10) : null,
    subEventType: subRaw ? Number.parseInt(subRaw, 10) : null,
    serialNo: xmlTag(trimmed, "serialNo"),
    currentVerifyMode: xmlTag(trimmed, "currentVerifyMode"),
    attendanceStatus: xmlTag(trimmed, "attendanceStatus"),
    name: xmlTag(trimmed, "name"),
    rawText: truncateRaw(trimmed),
    isHeartbeat: isHeartbeatEventType(eventType),
  };
}

function partLooksLikeJson(name: string | null, type: string | null): boolean {
  const n = (name ?? "").toLowerCase();
  const t = (type ?? "").toLowerCase();
  if (t.includes("image/") || t.includes("jpeg") || t.includes("jpg")) {
    return false;
  }
  if (n === "picture" || n.endsWith(".jpg") || n.endsWith(".jpeg")) {
    return false;
  }
  if (t.includes("json")) {
    return true;
  }
  if (
    n === "event_log" ||
    n === "accesscontrollerevent" ||
    n === "eventnotificationalert"
  ) {
    return true;
  }
  return false;
}

/**
 * Prefer named JSON parts; fall back to the first non-image text part that
 * parses as JSON or EventNotificationAlert XML.
 */
export async function extractEventTextFromFormData(
  formData: FormData,
): Promise<{ text: string; kind: "json" | "xml" } | null> {
  const candidates: { name: string | null; type: string | null; text: string }[] =
    [];

  for (const [name, value] of formData.entries()) {
    if (typeof value === "string") {
      if (!value.trim()) {
        continue;
      }
      candidates.push({ name, type: "text/plain", text: value });
      continue;
    }
    if (typeof Blob !== "undefined" && value instanceof Blob) {
      const type = value.type || null;
      if ((type ?? "").toLowerCase().startsWith("image/")) {
        continue;
      }
      const fileName =
        "name" in value && typeof (value as File).name === "string"
          ? (value as File).name
          : name;
      if (!partLooksLikeJson(fileName, type) && !partLooksLikeJson(name, type)) {
        const lowerName = (fileName ?? "").toLowerCase();
        if (
          lowerName.includes("picture") ||
          lowerName.endsWith(".jpg") ||
          lowerName.endsWith(".jpeg")
        ) {
          continue;
        }
      }
      const text = await value.text();
      if (!text.trim()) {
        continue;
      }
      candidates.push({ name, type, text });
    }
  }

  const preferred = candidates.filter((part) =>
    partLooksLikeJson(part.name, part.type),
  );
  const ordered = preferred.length > 0 ? preferred : candidates;

  for (const part of ordered) {
    const trimmed = part.text.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      return { text: trimmed, kind: "json" };
    }
    if (/<EventNotificationAlert[\s>]/i.test(trimmed)) {
      return { text: trimmed, kind: "xml" };
    }
  }

  return null;
}

export async function parseHikvisionRequestBody(
  request: Request,
): Promise<
  | { ok: true; event: HikvisionParsedEvent }
  | { ok: false; reason: "empty" | "malformed" }
> {
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();

  if (contentType.includes("multipart/form-data")) {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return { ok: false, reason: "malformed" };
    }
    const extracted = await extractEventTextFromFormData(formData);
    if (!extracted) {
      return { ok: false, reason: "empty" };
    }
    const event =
      extracted.kind === "xml"
        ? parseHikvisionXmlText(extracted.text)
        : parseHikvisionJsonText(extracted.text);
    if (!event) {
      return { ok: false, reason: "malformed" };
    }
    return { ok: true, event };
  }

  let bodyText: string;
  try {
    bodyText = await request.text();
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const trimmed = bodyText.trim();
  if (!trimmed) {
    return { ok: false, reason: "empty" };
  }

  if (
    contentType.includes("xml") ||
    contentType.includes("text/plain") ||
    trimmed.startsWith("<")
  ) {
    const xmlEvent = parseHikvisionXmlText(trimmed);
    if (xmlEvent) {
      return { ok: true, event: xmlEvent };
    }
  }

  if (
    contentType.includes("json") ||
    trimmed.startsWith("{") ||
    trimmed.startsWith("[")
  ) {
    const jsonEvent = parseHikvisionJsonText(trimmed);
    if (jsonEvent) {
      return { ok: true, event: jsonEvent };
    }
    return { ok: false, reason: "malformed" };
  }

  const xmlFallback = parseHikvisionXmlText(trimmed);
  if (xmlFallback) {
    return { ok: true, event: xmlFallback };
  }
  const jsonFallback = parseHikvisionJsonText(trimmed);
  if (jsonFallback) {
    return { ok: true, event: jsonFallback };
  }
  return { ok: false, reason: "malformed" };
}
