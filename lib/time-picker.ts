/** Parse typed time into the 24-hour "HH:mm" forms already store. Empty is "". Invalid is null. */
export function parseTimePickerText(raw: string): string | null {
  const text = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!text) {
    return "";
  }
  const clock = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?(?:\s*([ap]m))?$/);
  if (clock) {
    return fromHourMinute(Number(clock[1]), Number(clock[2]), clock[3]);
  }
  const digits = text.match(/^(\d{3,4})(?:\s*([ap]m))?$/);
  if (digits) {
    const packed = digits[1].padStart(4, "0");
    return fromHourMinute(
      Number(packed.slice(0, 2)),
      Number(packed.slice(2)),
      digits[2],
    );
  }
  return null;
}

function fromHourMinute(
  hour: number,
  minute: number,
  meridiem: string | undefined,
): string | null {
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    return null;
  }
  let hour24 = hour;
  if (meridiem === "am" || meridiem === "pm") {
    if (hour < 1 || hour > 12) {
      return null;
    }
    hour24 = hour % 12;
    if (meridiem === "pm") {
      hour24 += 12;
    }
  } else if (hour < 0 || hour > 23) {
    return null;
  }
  return `${String(hour24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** "08:30" -> "08:30 AM". Accepts "HH:mm:ss" and uses the first two parts. */
export function formatTimePickerDisplay(value: string): string {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) {
    return "";
  }
  const hour24 = Number(match[1]);
  const minute = match[2];
  if (!Number.isInteger(hour24) || hour24 < 0 || hour24 > 23) {
    return "";
  }
  const meridiem = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${String(hour12).padStart(2, "0")}:${minute} ${meridiem}`;
}

export function timePickerMinutes(value: string): number | null {
  const match = value.trim().match(/^(\d{2}):(\d{2})/);
  if (!match) {
    return null;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

export type TimePickerParts = {
  hour: string;
  minute: string;
  meridiem: "" | "AM" | "PM";
};

export function emptyTimePickerParts(): TimePickerParts {
  return { hour: "", minute: "", meridiem: "" };
}

export function timePickerPartsFromValue(value: string): TimePickerParts {
  const display = formatTimePickerDisplay(value);
  const match = display.match(/^(\d{2}):(\d{2}) (AM|PM)$/);
  if (!match) {
    return emptyTimePickerParts();
  }
  return {
    hour: match[1],
    minute: match[2],
    meridiem: match[3] as "AM" | "PM",
  };
}

export function valueFromTimePickerParts(parts: TimePickerParts): string | null {
  if (!parts.hour || !parts.minute || !parts.meridiem) {
    return null;
  }
  let hour = Number(parts.hour);
  if (!Number.isInteger(hour) || hour < 1 || hour > 12) {
    return null;
  }
  if (parts.meridiem === "AM") {
    hour = hour === 12 ? 0 : hour;
  } else if (hour !== 12) {
    hour += 12;
  }
  return `${String(hour).padStart(2, "0")}:${parts.minute}`;
}

export const TIME_PICKER_HOURS = Array.from({ length: 12 }, (_, index) =>
  String(index + 1).padStart(2, "0"),
);

export const TIME_PICKER_MINUTES = Array.from({ length: 60 }, (_, index) =>
  String(index).padStart(2, "0"),
);
