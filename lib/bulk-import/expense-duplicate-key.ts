function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }

  return String(value).trim() === "";
}

function normalizeIsoDateParts(value: string): string | null | "out_of_range" {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900 || year > 2100) {
    return "out_of_range";
  }

  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return `${match[1]}-${match[2]}-${match[3]}`;
}

function parseDuplicateDate(value: unknown): string | null {
  if (isBlank(value)) {
    return null;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const normalized = normalizeIsoDateParts(value.toISOString().slice(0, 10));
    return normalized && normalized !== "out_of_range" ? normalized : null;
  }

  const trimmed = String(value).trim();
  const isoMatch = normalizeIsoDateParts(trimmed);
  if (isoMatch && isoMatch !== "out_of_range") {
    return isoMatch;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const normalized = normalizeIsoDateParts(parsed.toISOString().slice(0, 10));
  return normalized && normalized !== "out_of_range" ? normalized : null;
}

function normalizeDuplicateMoney(value: unknown): string | null {
  if (isBlank(value)) {
    return null;
  }

  const parsed = Number(String(value).trim().replace(/,/g, ""));
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed.toFixed(2);
}

export function buildExpenseDuplicateKey(input: {
  date: unknown;
  vendor: unknown;
  price: unknown;
  expense_category: unknown;
  payment_method: unknown;
}): string | null {
  const date = parseDuplicateDate(input.date);
  const vendor = String(input.vendor ?? "").trim().toLowerCase();
  const expenseCategory = String(input.expense_category ?? "").trim().toLowerCase();
  const paymentMethod = String(input.payment_method ?? "").trim().toLowerCase();
  const price = normalizeDuplicateMoney(input.price);

  if (!date || !vendor || !expenseCategory || !paymentMethod || !price) {
    return null;
  }

  return [date, vendor, price, expenseCategory, paymentMethod].join("|");
}

export function indexInFileDuplicateExpenseGroups(
  rows: Array<{ row_number: number; mapped_data: Record<string, unknown> }>,
): Map<string, number[]> {
  const counts = new Map<string, number[]>();

  for (const row of rows) {
    const key = buildExpenseDuplicateKey({
      date: row.mapped_data.date,
      vendor: row.mapped_data.vendor,
      price: row.mapped_data.price,
      expense_category: row.mapped_data.expense_category,
      payment_method: row.mapped_data.payment_method,
    });
    if (!key) {
      continue;
    }

    const list = counts.get(key) ?? [];
    list.push(row.row_number);
    counts.set(key, list);
  }

  const groups = new Map<string, number[]>();
  for (const [key, rowNumbers] of counts.entries()) {
    if (rowNumbers.length > 1) {
      groups.set(
        key,
        rowNumbers.slice().sort((a, b) => a - b),
      );
    }
  }

  return groups;
}

export function indexInFileDuplicateExpenseKeys(
  rows: Array<{ row_number: number; mapped_data: Record<string, unknown> }>,
): Set<string> {
  return new Set([...indexInFileDuplicateExpenseGroups(rows).keys()]);
}

export function buildFixedAssetDuplicateKey(input: {
  asset_name: unknown;
  purchase_date: unknown;
  original_cost: unknown;
}): string | null {
  const assetName = String(input.asset_name ?? "").trim().toLowerCase();
  const purchaseDate = parseDuplicateDate(input.purchase_date);
  const originalCost = normalizeDuplicateMoney(input.original_cost);

  if (!assetName || !purchaseDate || !originalCost) {
    return null;
  }

  return [assetName, purchaseDate, originalCost].join("|");
}

export function indexInFileDuplicateFixedAssetGroups(
  rows: Array<{ row_number: number; mapped_data: Record<string, unknown> }>,
): Map<string, number[]> {
  const counts = new Map<string, number[]>();

  for (const row of rows) {
    const key = buildFixedAssetDuplicateKey({
      asset_name: row.mapped_data.asset_name,
      purchase_date: row.mapped_data.purchase_date,
      original_cost: row.mapped_data.original_cost,
    });
    if (!key) {
      continue;
    }

    const list = counts.get(key) ?? [];
    list.push(row.row_number);
    counts.set(key, list);
  }

  const groups = new Map<string, number[]>();
  for (const [key, rowNumbers] of counts.entries()) {
    if (rowNumbers.length > 1) {
      groups.set(
        key,
        rowNumbers.slice().sort((a, b) => a - b),
      );
    }
  }

  return groups;
}

export function indexInFileDuplicateFixedAssetKeys(
  rows: Array<{ row_number: number; mapped_data: Record<string, unknown> }>,
): Set<string> {
  return new Set([...indexInFileDuplicateFixedAssetGroups(rows).keys()]);
}
