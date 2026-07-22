import { formatGHS } from "@/app/dashboard/finance/income-register-utils";

export const CLIENT_INVOICE_STATUSES = ["draft", "sent", "partial", "paid"] as const;
export type ClientInvoiceStatus = (typeof CLIENT_INVOICE_STATUSES)[number];

export const CLIENT_INVOICE_LIST_SELECT =
  "id, tenant_id, client_id, invoice_number, invoice_sequence, invoice_date, due_date, bill_to_name, subtotal, tax_due, wht_amount, total_amount_due, amount_received, status, created_at, client:customers!client_invoices_tenant_id_client_id_fkey(client_id, client_name)" as const;

export const CLIENT_INVOICE_HEADER_SELECT =
  "id, tenant_id, client_id, invoice_number, invoice_sequence, invoice_date, due_date, billing_period_start, billing_period_end, bill_to_name, bill_to_address, bill_to_phone, subtotal, vat_nhil_getfund_rate, tax_due, wht_rate, wht_amount, total_amount_due, amount_received, status, notes, authorized_by_name, authorized_by_title, created_at, updated_at" as const;

export const AUTHORIZED_SIGNER_USER_ACCOUNT_SELECT =
  "auth_uid, employee_id, employees!user_accounts_employee_id_fkey(full_name, position)" as const;

export const AUTHORIZED_BY_OTHER = "__other__";

export type ClientInvoiceAuthorizedSignerOption = {
  employee_id: string;
  full_name: string;
  position: string | null;
};

type AuthorizedSignerUserAccountRow = {
  auth_uid: string;
  employee_id: string | null;
  employees:
    | { full_name: string; position: string | null }
    | { full_name: string; position: string | null }[]
    | null;
};

function firstEmployeeRelation(
  value: AuthorizedSignerUserAccountRow["employees"],
): { full_name: string; position: string | null } | null {
  if (!value) {
    return null;
  }

  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export function mapAuthorizedSignerOptions(
  rows: AuthorizedSignerUserAccountRow[],
): ClientInvoiceAuthorizedSignerOption[] {
  const byEmployeeId = new Map<string, ClientInvoiceAuthorizedSignerOption>();

  for (const row of rows) {
    if (!row.employee_id) {
      continue;
    }

    const employee = firstEmployeeRelation(row.employees);
    if (!employee?.full_name?.trim()) {
      continue;
    }

    byEmployeeId.set(row.employee_id, {
      employee_id: row.employee_id,
      full_name: employee.full_name.trim(),
      position: employee.position?.trim() ? employee.position.trim() : null,
    });
  }

  return [...byEmployeeId.values()].sort((left, right) =>
    left.full_name.localeCompare(right.full_name),
  );
}

export function formatAuthorizedSignerLabel(
  signer: ClientInvoiceAuthorizedSignerOption,
) {
  return signer.position
    ? `${signer.full_name} (${signer.position})`
    : signer.full_name;
}

export function resolveAuthorizedByFields(
  selection: string,
  otherName: string,
  otherTitle: string,
  signers: ClientInvoiceAuthorizedSignerOption[],
): { authorized_by_name: string | null; authorized_by_title: string | null } {
  if (!selection) {
    return { authorized_by_name: null, authorized_by_title: null };
  }

  if (selection === AUTHORIZED_BY_OTHER) {
    const name = otherName.trim();
    const title = otherTitle.trim();
    if (!name) {
      return { authorized_by_name: null, authorized_by_title: null };
    }

    return {
      authorized_by_name: name,
      authorized_by_title: title || null,
    };
  }

  const signer = signers.find((entry) => entry.employee_id === selection);
  if (!signer) {
    return { authorized_by_name: null, authorized_by_title: null };
  }

  return {
    authorized_by_name: signer.full_name,
    authorized_by_title: signer.position,
  };
}

export function resolveAuthorizedByFormState(
  invoice: Pick<ClientInvoiceHeaderRow, "authorized_by_name" | "authorized_by_title">,
  signers: ClientInvoiceAuthorizedSignerOption[],
) {
  const name = invoice.authorized_by_name?.trim();
  const title = invoice.authorized_by_title?.trim() ?? "";

  if (!name) {
    return {
      authorized_by_selection: "",
      authorized_by_other_name: "",
      authorized_by_other_title: "",
    };
  }

  const match = signers.find(
    (signer) =>
      signer.full_name === name && (signer.position?.trim() ?? "") === title,
  );

  if (match) {
    return {
      authorized_by_selection: match.employee_id,
      authorized_by_other_name: "",
      authorized_by_other_title: "",
    };
  }

  return {
    authorized_by_selection: AUTHORIZED_BY_OTHER,
    authorized_by_other_name: name,
    authorized_by_other_title: title,
  };
}

export const CLIENT_INVOICE_LINE_ITEM_SELECT =
  "id, invoice_id, tenant_id, site_id, category_label, description, labour_amount, material_amount, discount_amount, taxed, total_cost, sort_order" as const;

export type ClientInvoiceCustomer = {
  client_id: string;
  client_name: string;
};

export type ClientInvoiceListRow = {
  id: string;
  tenant_id: string;
  client_id: string;
  invoice_number: string;
  invoice_sequence: number;
  invoice_date: string;
  due_date: string | null;
  bill_to_name: string;
  subtotal: number;
  tax_due: number;
  wht_amount: number;
  total_amount_due: number;
  amount_received: number;
  status: ClientInvoiceStatus;
  created_at: string;
  client?: ClientInvoiceCustomer | ClientInvoiceCustomer[] | null;
};

export type ClientInvoiceLineItemRow = {
  id: string;
  invoice_id: string;
  tenant_id: string;
  site_id: string | null;
  category_label: string | null;
  description: string;
  labour_amount: number;
  material_amount: number;
  discount_amount: number;
  taxed: boolean;
  total_cost: number;
  sort_order: number;
};

export type ClientInvoiceHeaderRow = {
  id: string;
  tenant_id: string;
  client_id: string;
  invoice_number: string;
  invoice_sequence: number;
  invoice_date: string;
  due_date: string | null;
  billing_period_start: string | null;
  billing_period_end: string | null;
  bill_to_name: string;
  bill_to_address: string | null;
  bill_to_phone: string | null;
  subtotal: number;
  vat_nhil_getfund_rate: number;
  tax_due: number;
  wht_rate: number;
  wht_amount: number;
  total_amount_due: number;
  amount_received: number;
  status: ClientInvoiceStatus;
  notes: string | null;
  authorized_by_name: string | null;
  authorized_by_title: string | null;
  created_at: string;
  updated_at: string;
};

export type ClientInvoiceLineItemInput = {
  site_id?: string | null;
  category_label?: string | null;
  description: string;
  labour_amount: number;
  material_amount: number;
  discount_amount: number;
  taxed: boolean;
  sort_order: number;
};

export type ClientInvoiceWriteBody = {
  client_id: string;
  invoice_date: string;
  due_date?: string | null;
  billing_period_start?: string | null;
  billing_period_end?: string | null;
  bill_to_name: string;
  bill_to_address?: string | null;
  bill_to_phone?: string | null;
  vat_nhil_getfund_rate?: number;
  wht_rate?: number;
  status?: ClientInvoiceStatus;
  amount_received?: number;
  notes?: string | null;
  authorized_by_name?: string | null;
  authorized_by_title?: string | null;
  line_items: ClientInvoiceLineItemInput[];
  payment_account_ids: string[];
};

export type ClientInvoiceFormAuthorizedByState = {
  authorized_by_selection: string;
  authorized_by_other_name: string;
  authorized_by_other_title: string;
};

export type ClientInvoiceFormLineItem = ClientInvoiceLineItemInput & {
  key: string;
};

export type ClientInvoiceSiteOption = {
  site_code: string;
  site_name: string;
  client_id: string;
};

export function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function computeLineTotalCost(line: {
  labour_amount: unknown;
  material_amount: unknown;
  discount_amount: unknown;
}) {
  return roundMoney(
    toNumber(line.labour_amount) +
      toNumber(line.material_amount) -
      toNumber(line.discount_amount),
  );
}

export function computeInvoiceTotals(
  lineItems: ClientInvoiceLineItemInput[],
  vatRate: unknown,
  whtRate: unknown,
) {
  const normalizedLines = lineItems.map((line) => ({
    ...line,
    total_cost: computeLineTotalCost(line),
  }));

  const subtotal = roundMoney(
    normalizedLines.reduce((sum, line) => sum + line.total_cost, 0),
  );
  const labourTotal = roundMoney(
    normalizedLines.reduce((sum, line) => sum + toNumber(line.labour_amount), 0),
  );
  const vat = roundMoney((labourTotal * toNumber(vatRate)) / 100);
  const wht = roundMoney((labourTotal * toNumber(whtRate)) / 100);
  const totalAmountDue = roundMoney(subtotal + vat);

  return {
    line_items: normalizedLines,
    subtotal,
    tax_due: vat,
    wht_amount: wht,
    total_amount_due: totalAmountDue,
    labour_total: labourTotal,
  };
}

export function formatInvoiceStatus(status: string) {
  switch (status) {
    case "sent":
      return "Sent";
    case "partial":
      return "Partial";
    case "paid":
      return "Paid";
    default:
      return "Draft";
  }
}

export function formatInvoiceMoney(value: unknown) {
  return formatGHS(toNumber(value));
}

export function formatInvoiceDate(value: string | null | undefined) {
  if (!value) {
    return "—";
  }

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function suggestInvoiceNumber(sequence: number, year = new Date().getFullYear()) {
  return `INV-${year}-${String(sequence).padStart(3, "0")}`;
}

export function defaultDueDate(fromDate = new Date()) {
  const due = new Date(fromDate);
  due.setDate(due.getDate() + 30);
  return due.toISOString().slice(0, 10);
}

export function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export function emptyLineItem(sortOrder: number): ClientInvoiceFormLineItem {
  return {
    key: crypto.randomUUID(),
    site_id: null,
    category_label: "",
    description: "",
    labour_amount: 0,
    material_amount: 0,
    discount_amount: 0,
    taxed: true,
    sort_order: sortOrder,
  };
}

export function normalizeClientInvoiceListRow(row: ClientInvoiceListRow): ClientInvoiceListRow {
  return {
    ...row,
    subtotal: toNumber(row.subtotal),
    tax_due: toNumber(row.tax_due),
    wht_amount: toNumber(row.wht_amount),
    total_amount_due: toNumber(row.total_amount_due),
    amount_received: toNumber(row.amount_received),
    client: Array.isArray(row.client) ? row.client[0] ?? null : row.client ?? null,
  };
}

export function validateClientInvoiceBody(body: ClientInvoiceWriteBody): string | null {
  if (!body.client_id?.trim()) {
    return "Client is required.";
  }

  if (!body.invoice_date?.trim()) {
    return "Invoice date is required.";
  }

  if (!body.bill_to_name?.trim()) {
    return "Bill to name is required.";
  }

  if (!Array.isArray(body.line_items) || body.line_items.length === 0) {
    return "Add at least one line item.";
  }

  for (const [index, line] of body.line_items.entries()) {
    if (!line.description?.trim()) {
      return `Line ${index + 1} description is required.`;
    }
  }

  if (!Array.isArray(body.payment_account_ids)) {
    return "Payment account selection is invalid.";
  }

  return null;
}

export function normalizeStatus(value: unknown): ClientInvoiceStatus {
  if (value === "sent" || value === "partial" || value === "paid") {
    return value;
  }

  return "draft";
}

export function clientInvoiceToFormState(
  invoice: ClientInvoiceHeaderRow,
  lineItems: ClientInvoiceLineItemRow[],
  paymentAccountIds: string[],
  signers: ClientInvoiceAuthorizedSignerOption[] = [],
) {
  return {
    ...resolveAuthorizedByFormState(invoice, signers),
    client_id: invoice.client_id,
    invoice_date: invoice.invoice_date,
    due_date: invoice.due_date ?? defaultDueDate(new Date(invoice.invoice_date)),
    billing_period_start: invoice.billing_period_start ?? "",
    billing_period_end: invoice.billing_period_end ?? "",
    bill_to_name: invoice.bill_to_name,
    bill_to_address: invoice.bill_to_address ?? "",
    bill_to_phone: invoice.bill_to_phone ?? "",
    vat_nhil_getfund_rate: toNumber(invoice.vat_nhil_getfund_rate) || 20,
    wht_rate: toNumber(invoice.wht_rate) || 7.5,
    status: normalizeStatus(invoice.status),
    amount_received: toNumber(invoice.amount_received),
    notes: invoice.notes ?? "",
    payment_account_ids: paymentAccountIds,
    line_items: [...lineItems]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((line, index) => ({
        key: line.id,
        site_id: line.site_id,
        category_label: line.category_label ?? "",
        description: line.description,
        labour_amount: toNumber(line.labour_amount),
        material_amount: toNumber(line.material_amount),
        discount_amount: toNumber(line.discount_amount),
        taxed: line.taxed,
        sort_order: index,
      })),
  };
}

export function groupLineItemsByCategory<T extends { category_label?: string | null }>(
  lineItems: T[],
) {
  const groups = new Map<string, T[]>();

  for (const line of lineItems) {
    const label = line.category_label?.trim() || "General";
    const bucket = groups.get(label) ?? [];
    bucket.push(line);
    groups.set(label, bucket);
  }

  return [...groups.entries()].map(([label, items]) => ({ label, items }));
}
