import { formatGHS } from "../finance/income-register-utils";
import { formatReceiptPaymentMethodLine } from "@/utils/manual-sale-paystack";

export type ReceiptPaymentStanding =
  | "Paid"
  | "Part-paid"
  | "Unpaid"
  | "Returned"
  | "Partly returned";

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export type ReceiptListedPayment = {
  date: string;
  method: string;
  amount: number;
  reference: string | null;
};

export function receiptPaymentReference(
  notes: string | null | undefined,
): string | null {
  const paystack = notes?.match(/^Paystack ref:\s*(\S+)/im)?.[1]?.trim();
  if (paystack) {
    return paystack;
  }
  const transaction = notes?.match(/^Transaction ref:\s*(.+)$/im)?.[1]?.trim();
  return transaction || null;
}

export function formatReceiptPaymentDate(value: string): string {
  const day = value.trim().slice(0, 10);
  const parsed = Date.parse(`${day}T00:00:00Z`);
  if (!day || !Number.isFinite(parsed)) {
    return value.trim() || "—";
  }
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(parsed));
}

/** One receipt row: "20 Oct · Mobile Money · GHS 50.00 · ref XXX". */
export function formatReceiptListedPayment(line: ReceiptListedPayment): string {
  const method = line.method.trim() || "Payment";
  const amount = formatGHS(round2(line.amount));
  const ref = line.reference?.trim();
  const base = `${formatReceiptPaymentDate(line.date)} · ${method} · ${amount}`;
  return ref ? `${base} · ref ${ref}` : base;
}

export function sumReceiptListedPayments(lines: ReceiptListedPayment[]): number {
  return round2(lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0));
}

export function listedPaymentsFromRows(
  rows: Array<{
    payment_date?: string | null;
    payment_method?: string | null;
    amount?: number | null;
    notes?: string | null;
  }>,
): ReceiptListedPayment[] {
  return rows
    .map((row) => ({
      date: row.payment_date?.trim() || "",
      method: row.payment_method?.trim() || "Payment",
      amount: round2(Number(row.amount) || 0),
      reference: receiptPaymentReference(row.notes),
    }))
    .filter((row) => row.amount > 0.001);
}

export function incomeFallbackPaymentLine(input: {
  date: string;
  amount: number;
  notes?: string | null;
  paymentMethod?: string | null;
}): ReceiptListedPayment | null {
  const amount = round2(input.amount);
  if (amount <= 0.001) {
    return null;
  }
  const fromNotes = input.notes?.match(/^Payment method:\s*(.+)$/m)?.[1]?.trim();
  return {
    date: input.date,
    method: fromNotes || input.paymentMethod?.trim() || "Payment",
    amount,
    reference: receiptPaymentReference(input.notes),
  };
}

/** Stable key for a receipt preview: invoice no. + line count + totals. */
export function receiptPreviewFingerprint(parts: {
  invoiceNo: string;
  lineCount: number;
  totals: Array<number | string | null | undefined>;
}): string {
  return [
    parts.invoiceNo,
    parts.lineCount,
    ...parts.totals.map((value) =>
      typeof value === "number" ? value.toFixed(2) : (value ?? ""),
    ),
  ].join("|");
}

export type ReceiptPaymentIncomeRow = {
  id?: string | null;
  date?: string | null;
  amount_received?: number | null;
  notes?: string | null;
  payment_method?: string | null;
  amount?: number | null;
  is_sale_return?: boolean | null;
};

export type ReceiptPaymentRecordRow = {
  income_id?: string | null;
  payment_date?: string | null;
  payment_method?: string | null;
  amount?: number | null;
  notes?: string | null;
};

function mergeListedPayments(lines: ReceiptListedPayment[]): ReceiptListedPayment[] {
  const merged: ReceiptListedPayment[] = [];
  for (const line of lines) {
    const existing = merged.find(
      (candidate) =>
        candidate.date.slice(0, 10) === line.date.slice(0, 10) &&
        candidate.method === line.method &&
        (candidate.reference ?? "") === (line.reference ?? ""),
    );
    if (existing) {
      existing.amount = round2(existing.amount + line.amount);
    } else {
      merged.push({ ...line });
    }
  }
  return merged;
}

/**
 * Every tender on a receipt, so the lines add up to "Total paid".
 *
 * At-sale payment per income row = amount_received minus that row's recorded
 * product_sale_payments (only when above zero). A Paystack payment that already
 * has a payment row is therefore counted once, through the row. Later payments
 * follow. Lines are in date order; at-sale lines lead on the same day.
 */
export function buildReceiptPaymentLines(
  incomeRows: ReceiptPaymentIncomeRow[],
  paymentRows: ReceiptPaymentRecordRow[],
): ReceiptListedPayment[] {
  const saleRows = incomeRows.filter(
    (row) =>
      row.is_sale_return !== true &&
      (Number(row.amount) || 0) >= 0 &&
      !/^Credit note\s+/i.test(row.notes?.trim() ?? ""),
  );
  const saleIds = new Set(
    saleRows.map((row) => row.id?.trim()).filter((id): id is string => Boolean(id)),
  );
  const recorded = paymentRows.filter((row) => {
    if ((Number(row.amount) || 0) <= 0.001) {
      return false;
    }
    const incomeId = row.income_id?.trim();
    return !incomeId || saleIds.size === 0 || saleIds.has(incomeId);
  });

  const atSale: ReceiptListedPayment[] = [];
  for (const row of saleRows) {
    const rowId = row.id?.trim();
    const recordedSum = round2(
      recorded
        .filter((payment) => (payment.income_id?.trim() ?? "") === (rowId ?? "\u0000"))
        .reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0),
    );
    const residual = round2((Number(row.amount_received) || 0) - recordedSum);
    if (residual <= 0.001) {
      continue;
    }
    const fromNotes = row.notes?.match(/^Payment method:\s*(.+)$/m)?.[1]?.trim();
    const column = canonicalReceiptPaymentMethod(row.payment_method);
    atSale.push({
      date: row.date?.trim() || "",
      method: canonicalReceiptPaymentMethod(fromNotes) || column || "Cash",
      amount: residual,
      reference: receiptPaymentReference(row.notes),
    });
  }

  const later = listedPaymentsFromRows(recorded);
  const byDate = (left: ReceiptListedPayment, right: ReceiptListedPayment) =>
    left.date.slice(0, 10).localeCompare(right.date.slice(0, 10));
  return mergeListedPayments([
    ...mergeListedPayments(atSale),
    ...later,
  ].sort(byDate));
}

/** Paid, Part-paid, or Unpaid from the amount received against the sale total. */
export function receiptPaymentStanding(
  total: number,
  amountReceived: number,
): ReceiptPaymentStanding {
  const saleTotal = round2(total);
  const received = round2(amountReceived);
  if (saleTotal <= 0 || received >= saleTotal - 0.001) {
    return "Paid";
  }
  if (received > 0.001) {
    return "Part-paid";
  }
  return "Unpaid";
}

export function receiptBalanceDue(total: number, amountReceived: number): number {
  const due = round2(round2(total) - round2(amountReceived));
  return due > 0.001 ? due : 0;
}

export function receiptChangeDue(total: number, amountReceived: number): number {
  const change = round2(round2(amountReceived) - round2(total));
  return change > 0.001 ? change : 0;
}

export function canonicalReceiptPaymentMethod(raw: string | null | undefined): string | null {
  const text = raw?.trim() ?? "";
  if (!text || text === "—" || /^non-?cash$/i.test(text)) {
    return null;
  }
  if (/mobile\s*money|^momo$/i.test(text)) {
    return "Mobile Money";
  }
  if (/bank/i.test(text)) {
    return "Bank transfer";
  }
  if (/\b(card|visa|mastercard)\b/i.test(text)) {
    return "Card";
  }
  if (/^cash$/i.test(text)) {
    return "Cash";
  }
  return text;
}

export type ReceiptPaymentSource = {
  notes?: string | null;
  payment_method?: string | null;
  amount_received?: number | null;
  amount?: number | null;
  due_date?: string | null;
  created_at?: string | null;
  date?: string | null;
};

function methodFromSource(entry: ReceiptPaymentSource): string | null {
  const column = canonicalReceiptPaymentMethod(entry.payment_method);
  if (column) {
    return column;
  }
  const match = entry.notes?.match(/^Payment method:\s*(.+)$/m);
  return canonicalReceiptPaymentMethod(match?.[1]);
}

/**
 * Actual tender(s). A single method is the name. Split tenders include each amount.
 * "—" only when the sale recorded no payment and no method.
 */
export function formatReceiptPaymentMethods(entries: ReceiptPaymentSource[]): string {
  const parts: { method: string; amount: number }[] = [];
  for (const entry of entries) {
    const stored = methodFromSource(entry);
    if (!stored) {
      continue;
    }
    const method = formatReceiptPaymentMethodLine(stored, entry.notes);
    const amount = round2(Number(entry.amount_received) || 0);
    const existing = parts.find((part) => part.method === method);
    if (existing) {
      existing.amount = round2(existing.amount + amount);
    } else {
      parts.push({ method, amount });
    }
  }

  const paid = parts.filter((part) => part.amount > 0.001);
  const list = paid.length > 0 ? paid : parts;
  if (list.length === 0) {
    return "—";
  }
  if (list.length === 1) {
    return list[0].method;
  }
  return list.map((part) => `${part.method} ${formatGHS(part.amount)}`).join("; ");
}

export function receiptDueDate(entries: ReceiptPaymentSource[]): string | null {
  const positive = entries.find(
    (entry) => (Number(entry.amount) || 0) > 0 && entry.due_date?.trim(),
  );
  const raw = positive?.due_date?.trim() || entries.find((entry) => entry.due_date?.trim())?.due_date?.trim();
  return raw || null;
}

export type ReceiptIncomeLine = ReceiptPaymentSource & {
  id?: string;
  is_sale_return?: boolean | null;
  sale_quantity?: number | null;
  unit_price?: number | null;
  product_code?: string | null;
  product_name?: string | null;
  credit_note_number?: string | null;
  return_mode?: string | null;
  refunded_amount?: number | null;
};

export type ReceiptReturnDisplayLine = {
  id: string;
  productCode: string;
  productName: string;
  quantity: number;
  /** Negative amount, the value of the return. */
  amount: number;
  creditNoteNumber: string | null;
};

export type ReceiptSettlement = {
  subtotal: number;
  returnsTotal: number;
  netTotal: number;
  amountReceived: number;
  storeCreditIssued: number;
  cashRefunded: number;
  standing: ReceiptPaymentStanding;
  balanceDue: number;
  changeDue: number;
  dueDate: string | null;
  returnLines: ReceiptReturnDisplayLine[];
};

export function creditNoteNumberFromNotes(notes: string | null | undefined): string | null {
  const match = notes?.match(/Credit note\s+([A-Z0-9-]+)/i);
  return match?.[1]?.trim() || null;
}

/** A reversing income row is a return, never another unit sold. */
export function isReceiptReturnLine(entry: ReceiptIncomeLine): boolean {
  if (entry.is_sale_return === true) {
    return true;
  }
  if ((Number(entry.amount) || 0) < -0.001) {
    return true;
  }
  return /^Credit note\s+/i.test(entry.notes?.trim() ?? "");
}

function returnAmount(entry: ReceiptIncomeLine): number {
  const amount = Number(entry.amount);
  if (Number.isFinite(amount) && amount < 0) {
    return round2(Math.abs(amount));
  }
  const qty = Math.abs(Number(entry.sale_quantity) || 0);
  const price = Math.abs(Number(entry.unit_price) || 0);
  return round2(qty * price);
}

function settlementKind(entry: ReceiptIncomeLine): "store_credit" | "refund" {
  const mode = entry.return_mode?.trim().toLowerCase() ?? "";
  if (mode === "refund_now") {
    return "refund";
  }
  if (mode === "store_credit" || mode === "exchange_hold") {
    return "store_credit";
  }
  if ((Number(entry.refunded_amount) || 0) > 0.001) {
    return "refund";
  }
  return "store_credit";
}

/**
 * Sale lines and return lines are kept apart.
 * Status uses the net total. A fully returned sale is Returned, with no balance due.
 */
export function settleIncomeReceiptLines(
  entries: ReceiptIncomeLine[],
  creditsApplied = 0,
): ReceiptSettlement {
  const saleEntries = entries.filter((entry) => !isReceiptReturnLine(entry));
  const returnEntries = entries.filter((entry) => isReceiptReturnLine(entry));

  const subtotal = round2(
    saleEntries.reduce((sum, entry) => {
      const amount = Number(entry.amount);
      if (Number.isFinite(amount) && amount > 0) {
        return sum + amount;
      }
      const qty = Number(entry.sale_quantity) || 0;
      const price = Number(entry.unit_price) || 0;
      return sum + qty * price;
    }, 0),
  );
  const returnsTotal = round2(
    returnEntries.reduce((sum, entry) => sum + returnAmount(entry), 0),
  );
  const netTotal = round2(Math.max(0, subtotal - returnsTotal));
  const amountReceived = round2(
    saleEntries.reduce((sum, entry) => sum + (Number(entry.amount_received) || 0), 0),
  );
  const applied = round2(Math.max(0, creditsApplied));

  const settlementGroups = new Map<
    string,
    { kind: "store_credit" | "refund"; lineSum: number; refunded: number }
  >();
  for (const entry of returnEntries) {
    const key =
      entry.credit_note_number?.trim() ||
      creditNoteNumberFromNotes(entry.notes) ||
      entry.id ||
      `line-${settlementGroups.size}`;
    const kind = settlementKind(entry);
    const groupKey = `${kind}:${key}`;
    const group = settlementGroups.get(groupKey) ?? {
      kind,
      lineSum: 0,
      refunded: 0,
    };
    group.lineSum = round2(group.lineSum + returnAmount(entry));
    group.refunded = round2(
      Math.max(group.refunded, Number(entry.refunded_amount) || 0),
    );
    settlementGroups.set(groupKey, group);
  }
  let storeCreditIssued = 0;
  let cashRefunded = 0;
  for (const group of settlementGroups.values()) {
    if (group.kind === "refund") {
      cashRefunded = round2(
        cashRefunded + (group.refunded > 0.001 ? group.refunded : group.lineSum),
      );
    } else {
      storeCreditIssued = round2(storeCreditIssued + group.lineSum);
    }
  }

  const fullyReturned = returnsTotal > 0.001 && netTotal <= 0.001 && subtotal > 0.001;
  const partlyReturned = returnsTotal > 0.001 && !fullyReturned;
  const covered = round2(amountReceived + applied);
  const balanceDue = fullyReturned
    ? 0
    : receiptBalanceDue(netTotal, covered);
  const changeDue =
    fullyReturned || partlyReturned ? 0 : receiptChangeDue(netTotal, covered);

  let standing: ReceiptPaymentStanding;
  if (fullyReturned) {
    standing = "Returned";
  } else if (partlyReturned) {
    standing = "Partly returned";
  } else {
    standing = receiptPaymentStanding(netTotal, covered);
  }

  const dueDate =
    balanceDue > 0.001 ? receiptDueDate(saleEntries.length > 0 ? saleEntries : entries) : null;

  const returnLines: ReceiptReturnDisplayLine[] = returnEntries.map((entry, index) => ({
    id: entry.id || `return-${index}`,
    productCode: entry.product_code?.trim() || "—",
    productName: entry.product_name?.trim() || "Item",
    quantity: Math.abs(Number(entry.sale_quantity) || 0),
    amount: round2(-returnAmount(entry)),
    creditNoteNumber:
      entry.credit_note_number?.trim() || creditNoteNumberFromNotes(entry.notes),
  }));

  return {
    subtotal,
    returnsTotal,
    netTotal,
    amountReceived,
    storeCreditIssued,
    cashRefunded,
    standing,
    balanceDue,
    changeDue,
    dueDate,
    returnLines,
  };
}

/** Prefer a stored timestamp so reprints can show the time. Date-only stays date-only. */
export function receiptSaleTimestamp(entries: ReceiptPaymentSource[]): string {
  for (const entry of entries) {
    const stamp = entry.created_at?.trim() ?? "";
    if (stamp && !/^\d{4}-\d{2}-\d{2}$/.test(stamp)) {
      return stamp;
    }
  }
  return entries.find((entry) => entry.date?.trim())?.date?.trim() || "";
}
