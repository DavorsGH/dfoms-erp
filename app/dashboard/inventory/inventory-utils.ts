export function formatInventoryQuantity(value: number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) {
    return "—";
  }

  return Number(value).toLocaleString("en-GB", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

export function formatInventoryMoney(value: number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) {
    return "—";
  }

  return `GHS ${Number(value).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })}`;
}

export function generateNextInventoryCode(
  prefix: string,
  padLength: number,
  existingCodes: string[],
): string {
  const maxNumber = existingCodes.reduce((max, code) => {
    const match = code.match(new RegExp(`^${prefix}(\\d+)$`));
    if (!match) {
      return max;
    }

    return Math.max(max, Number.parseInt(match[1], 10));
  }, 0);

  return `${prefix}${String(maxNumber + 1).padStart(padLength, "0")}`;
}

export function nullableNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number.parseFloat(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

export function nullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
