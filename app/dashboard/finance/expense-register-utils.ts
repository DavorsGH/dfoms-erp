import type { ContractProjectOption } from "../administration/projects-utils";
import {
  validateNewExpenseRegisterCategory,
  validateNewExpenseRegisterSubcategory,
} from "@/utils/expense-register-category-guard";
import { validateManualExpenseRegisterPaymentStatusForWrite } from "@/utils/manual-expense-payment-status";
import { VENDOR_OTHER_VALUE } from "./vendor-select-utils";

/** Form select value for explicit company overhead (maps to project_id NULL). */
export const EXPENSE_REGISTER_PROJECT_OVERHEAD_VALUE = "__company_overhead__";

export type ExpenseRegisterEntry = {
  id: string;
  date: string;
  expense_category: string;
  sub_category: string;
  description: string | null;
  vendor: string;
  price: number;
  quantity: number;
  amount: number;
  payment_method: string;
  approved_by: string;
  receipt_no: string;
  payment_status: string;
  notes: string | null;
  net_of_tax_amount?: number | null;
  input_vat_amount?: number | null;
  wht_rate?: number | null;
  wht_amount?: number | null;
  gross_before_wht?: number | null;
  project_id?: string | null;
};

/** Manual expense receipts use generate_next_code(..., 'EXP', 4). */
export const EXPENSE_RECEIPT_ENTITY_TYPE = "EXP";

function toNullableNumber(value: unknown): number | null {
  return value == null ? null : Number(value) || 0;
}

export function normalizeExpenseRegisterEntry(
  raw: ExpenseRegisterEntry,
): ExpenseRegisterEntry {
  return {
    ...raw,
    price: Number(raw.price) || 0,
    quantity: Number(raw.quantity) || 0,
    amount: Number(raw.amount) || 0,
    net_of_tax_amount: toNullableNumber(raw.net_of_tax_amount),
    input_vat_amount: toNullableNumber(raw.input_vat_amount),
    wht_rate: toNullableNumber(raw.wht_rate),
    wht_amount: toNullableNumber(raw.wht_amount),
    gross_before_wht: toNullableNumber(raw.gross_before_wht),
  };
}

/**
 * Gross invoice before WHT. Prefer the stored thin column; fall back to
 * price × quantity (the pre-tax line total the form still edits).
 */
export function getExpenseGrossBeforeWht(entry: {
  gross_before_wht?: number | null;
  price: number;
  quantity: number;
  amount: number;
}): number {
  if (entry.gross_before_wht != null && entry.gross_before_wht > 0) {
    return Number(entry.gross_before_wht) || 0;
  }

  const lineTotal = calculateAmount(entry.price, entry.quantity);
  return lineTotal > 0 ? lineTotal : Number(entry.amount) || 0;
}

export function formatGHS(value: number): string {
  return `GHS ${value.toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function calculateAmount(price: number, quantity: number): number {
  return price * quantity;
}

export function tenantHasActiveExpenseProjects(
  projects: ContractProjectOption[],
): boolean {
  return projects.some((project) => !project.is_archived);
}

/** Maps form sentinel / empty values to NULL for expense_register.project_id. */
export function normalizeExpenseRegisterProjectIdForDatabase(
  value: string | null | undefined,
): string | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed || trimmed === EXPENSE_REGISTER_PROJECT_OVERHEAD_VALUE) {
    return null;
  }
  return trimmed;
}

export function formatExpenseRegisterContractProjectLabel(
  projectId: string | null | undefined,
  projects: ContractProjectOption[],
): string {
  if (!projectId?.trim()) {
    return "Overhead";
  }
  const match = projects.find((project) => project.id === projectId);
  if (!match) {
    return "Overhead";
  }
  return `${match.project_code} — ${match.project_name}`;
}

export function expenseRegisterProjectOptionsForForm(
  projects: ContractProjectOption[],
  selectedFormValue: string,
): ContractProjectOption[] {
  const linkedProjectId =
    selectedFormValue &&
    selectedFormValue !== EXPENSE_REGISTER_PROJECT_OVERHEAD_VALUE
      ? selectedFormValue
      : null;

  return [...projects]
    .filter(
      (project) =>
        !project.is_archived || project.id === linkedProjectId,
    )
    .sort((left, right) =>
      left.project_name.localeCompare(right.project_name),
    );
}

export const EXPENSE_REGISTER_PROJECT_CHOICE_VALIDITY_MESSAGE =
  "Choose which contract or project this expense belongs to, or select Company overhead.";

export function resolveExpenseRegisterProjectIdForSave(
  formValue: string,
  requireExplicitChoice: boolean,
):
  | { ok: true; projectId: string | null }
  | { ok: false; error: string } {
  if (!requireExplicitChoice) {
    return { ok: true, projectId: null };
  }

  const trimmed = formValue.trim();
  if (!trimmed) {
    return {
      ok: false,
      error: EXPENSE_REGISTER_PROJECT_CHOICE_VALIDITY_MESSAGE,
    };
  }

  return {
    ok: true,
    projectId: normalizeExpenseRegisterProjectIdForDatabase(trimmed),
  };
}

export function initialExpenseRegisterProjectFormValue(
  projectId: string | null | undefined,
  projects: ContractProjectOption[],
): string {
  if (projectId) {
    return projectId;
  }
  if (tenantHasActiveExpenseProjects(projects)) {
    return EXPENSE_REGISTER_PROJECT_OVERHEAD_VALUE;
  }
  return "";
}

export const EXPENSE_REGISTER_VENDOR_OTHER_VALIDITY_MESSAGE =
  "Enter the one-time supplier name.";

export const EXPENSE_REGISTER_PRICE_NOT_NUMBER_VALIDITY_MESSAGE =
  "Price must be a number.";

export const EXPENSE_REGISTER_QUANTITY_WHOLE_NUMBER_VALIDITY_MESSAGE =
  "Quantity must be a whole number.";

export const EXPENSE_REGISTER_INPUT_CLASS_NAME =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

export function expenseRegisterInputClassName(): string {
  return EXPENSE_REGISTER_INPUT_CLASS_NAME;
}

export type ExpenseRegisterFormValidityControls = {
  date: HTMLInputElement | null;
  expenseCategory: HTMLSelectElement | null;
  project: HTMLSelectElement | null;
  subCategory: HTMLSelectElement | null;
  vendorSelect: HTMLSelectElement | null;
  vendorOther: HTMLInputElement | null;
  price: HTMLInputElement | null;
  quantity: HTMLInputElement | null;
  paymentStatus: HTMLSelectElement | null;
};

export type ExpenseRegisterFormCustomValidityInput = {
  date: string;
  expense_category: string;
  sub_category: string;
  vendor_select: string;
  vendor_other: string;
  price: string;
  quantity: string;
  payment_status: string;
  project_id: string;
};

function setNativeFieldValidity(
  control: HTMLInputElement | HTMLSelectElement | null,
  message: string | null,
): void {
  control?.setCustomValidity(message ?? "");
}

export function syncExpenseRegisterFormCustomValidity(
  controls: ExpenseRegisterFormValidityControls,
  options: {
    form: ExpenseRegisterFormCustomValidityInput;
    editingId: string | null;
    hasActiveExpenseProjects: boolean;
    validatePaymentStatus: boolean;
    expenseCategories: ExpenseCategoryLookupRow[];
    expenseSubcategories: ExpenseSubcategoryLookup[];
  },
): void {
  setNativeFieldValidity(controls.date, null);
  setNativeFieldValidity(controls.expenseCategory, null);
  setNativeFieldValidity(controls.project, null);
  setNativeFieldValidity(controls.subCategory, null);
  setNativeFieldValidity(controls.vendorSelect, null);
  setNativeFieldValidity(controls.vendorOther, null);
  setNativeFieldValidity(controls.price, null);
  setNativeFieldValidity(controls.quantity, null);
  setNativeFieldValidity(controls.paymentStatus, null);

  if (!options.editingId) {
    const categoryError = validateNewExpenseRegisterCategory(
      options.form.expense_category,
      { categoryRows: options.expenseCategories },
    );
    if (categoryError) {
      setNativeFieldValidity(controls.expenseCategory, categoryError);
    }

    const subcategoryError = validateNewExpenseRegisterSubcategory(
      options.form.expense_category,
      options.form.sub_category,
      options.expenseSubcategories,
      options.expenseCategories,
    );
    if (subcategoryError) {
      setNativeFieldValidity(controls.subCategory, subcategoryError);
    }
  }

  if (options.validatePaymentStatus) {
    const paymentStatusError = validateManualExpenseRegisterPaymentStatusForWrite(
      options.form.payment_status,
    );
    if (paymentStatusError) {
      setNativeFieldValidity(controls.paymentStatus, paymentStatusError);
    }
  }

  if (
    options.form.vendor_select === VENDOR_OTHER_VALUE &&
    !options.form.vendor_other.trim()
  ) {
    setNativeFieldValidity(
      controls.vendorOther,
      EXPENSE_REGISTER_VENDOR_OTHER_VALIDITY_MESSAGE,
    );
  }

  if (options.hasActiveExpenseProjects) {
    const projectIdResult = resolveExpenseRegisterProjectIdForSave(
      options.form.project_id,
      true,
    );
    if (!projectIdResult.ok) {
      setNativeFieldValidity(controls.project, projectIdResult.error);
    }
  }

  const priceTrimmed = options.form.price.trim();
  if (priceTrimmed) {
    const price = Number(priceTrimmed);
    if (!Number.isFinite(price)) {
      setNativeFieldValidity(
        controls.price,
        EXPENSE_REGISTER_PRICE_NOT_NUMBER_VALIDITY_MESSAGE,
      );
    }
  }

  const quantityTrimmed = options.form.quantity.trim();
  if (quantityTrimmed !== "") {
    const quantity = Number.parseInt(quantityTrimmed, 10);
    if (Number.isNaN(quantity)) {
      setNativeFieldValidity(
        controls.quantity,
        EXPENSE_REGISTER_QUANTITY_WHOLE_NUMBER_VALIDITY_MESSAGE,
      );
    }
  }
}

export function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function normalizeOptionalReceiptNo(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
}

export type ExpenseSubcategoryLookup = {
  id: string;
  name: string;
  expense_category: string | null;
  is_active: boolean;
};

export const EXPENSE_SUBCATEGORIES_LOOKUP_SELECT =
  "id, name, expense_category, is_active";

export function expenseSubcategoryNameKey(name: string): string {
  return name.trim().toLowerCase();
}

export function findLinkedExpenseSubcategoryInCategory(
  allSubcategories: ExpenseSubcategoryLookup[],
  categoryName: string,
  subcategoryName: string,
): ExpenseSubcategoryLookup | undefined {
  const category = categoryName.trim();
  const nameKey = expenseSubcategoryNameKey(subcategoryName);
  if (!category || !nameKey) {
    return undefined;
  }

  return allSubcategories.find(
    (row) =>
      (row.expense_category ?? "").trim() === category &&
      expenseSubcategoryNameKey(row.name) === nameKey,
  );
}

export function findUnlinkedExpenseSubcategoryByName(
  allSubcategories: ExpenseSubcategoryLookup[],
  subcategoryName: string,
): ExpenseSubcategoryLookup | undefined {
  const nameKey = expenseSubcategoryNameKey(subcategoryName);
  if (!nameKey) {
    return undefined;
  }

  return allSubcategories.find(
    (row) =>
      !(row.expense_category ?? "").trim() &&
      expenseSubcategoryNameKey(row.name) === nameKey,
  );
}

export function normalizeExpenseSubcategoryLookup(
  raw: Partial<ExpenseSubcategoryLookup> & { name: string },
): ExpenseSubcategoryLookup {
  return {
    id: String(raw.id ?? raw.name),
    name: raw.name,
    expense_category: raw.expense_category ?? null,
    is_active: raw.is_active ?? true,
  };
}

export type ExpenseCategoryLookupRow = {
  name: string;
  is_active?: boolean;
};

function expenseCategoryIsHiddenForNewEntries(
  categoryName: string,
  categoryLookups?: ExpenseCategoryLookupRow[],
): boolean {
  const key = categoryName.trim().toLowerCase();
  if (!key || !categoryLookups) {
    return false;
  }
  const row = categoryLookups.find(
    (entry) => entry.name.trim().toLowerCase() === key,
  );
  return row?.is_active === false;
}

/** Active sub-categories linked to the selected category; keeps current value when editing legacy rows. */
export function expenseSubcategoryOptionsForCategory(
  expenseCategory: string,
  allSubcategories: ExpenseSubcategoryLookup[],
  currentSubCategoryValue?: string,
  categoryLookups?: ExpenseCategoryLookupRow[],
): Array<{ name: string; isHidden?: boolean }> {
  const category = expenseCategory.trim();
  if (!category) {
    return [];
  }

  const categoryKey = category.toLowerCase();
  const categoryHidden = expenseCategoryIsHiddenForNewEntries(
    category,
    categoryLookups,
  );
  const names = new Map<string, { name: string; isHidden?: boolean }>();

  for (const row of allSubcategories) {
    if ((row.expense_category ?? "").trim().toLowerCase() !== categoryKey) {
      continue;
    }
    if (categoryHidden) {
      continue;
    }
    if (!row.is_active) {
      continue;
    }
    const displayName = row.name.trim();
    names.set(displayName.toLowerCase(), { name: displayName });
  }

  const current = (currentSubCategoryValue ?? "").trim();
  if (current) {
    const currentKey = current.toLowerCase();
    if (!names.has(currentKey)) {
      const linked = allSubcategories.find(
        (row) =>
          (row.expense_category ?? "").trim().toLowerCase() === categoryKey &&
          row.name.trim().toLowerCase() === currentKey,
      );
      // Keep legacy / inactive rows on edit only — never inject a sub-category
      // that belongs to another category (stale state + invalid <select> value
      // makes the browser show one label while form state keeps another).
      if (linked) {
        const subHidden = linked.is_active === false || categoryHidden;
        names.set(currentKey, {
          name: current,
          isHidden: subHidden || undefined,
        });
      }
    }
  }

  return [...names.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

export function expenseCategorySelectOptionsForCreate(
  expenseCategories: ExpenseCategoryLookupRow[],
  isEditing: boolean,
  currentCategory: string,
): ExpenseCategoryLookupRow[] {
  const currentKey = currentCategory.trim().toLowerCase();
  return expenseCategories.filter((category) => {
    if (category.is_active === false) {
      return (
        isEditing && category.name.trim().toLowerCase() === currentKey
      );
    }
    return true;
  });
}

export function buildExpenseSubcategoryKeysByCategory(
  rows: Array<{
    expense_category: string | null;
    name: string;
    is_active?: boolean | null;
  }>,
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();

  for (const row of rows) {
    if (row.is_active === false) {
      continue;
    }
    const categoryKey = (row.expense_category ?? "").trim().toLowerCase();
    const subKey = row.name.trim().toLowerCase();
    if (!categoryKey || !subKey) {
      continue;
    }
    let subs = map.get(categoryKey);
    if (!subs) {
      subs = new Set();
      map.set(categoryKey, subs);
    }
    subs.add(subKey);
  }

  return map;
}

export function validateExpenseSubcategoryForCategoryLookup(
  expenseCategory: unknown,
  subCategory: unknown,
  keysByCategory: Map<string, Set<string>>,
): string | null {
  const categoryKey = String(expenseCategory ?? "")
    .trim()
    .toLowerCase();
  const subKey = String(subCategory ?? "").trim().toLowerCase();
  if (!categoryKey || !subKey) {
    return null;
  }

  const allowed = keysByCategory.get(categoryKey);
  if (allowed?.has(subKey)) {
    return null;
  }

  const usedElsewhere = [...keysByCategory.values()].some((set) =>
    set.has(subKey),
  );
  if (usedElsewhere) {
    return "sub_category is not linked to expense_category for this tenant";
  }

  return null;
}

/** Value safe to bind to Sub-Category <select> (must match an option or be empty). */
export function expenseSubcategorySelectValueForOptions(
  value: string,
  options: Array<{ name: string }>,
): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const key = trimmed.toLowerCase();
  const match = options.find((row) => row.name.trim().toLowerCase() === key);
  return match ? match.name : "";
}

export function expenseSubcategoryAllowedForCategory(
  expenseCategory: string,
  subCategory: string,
  allSubcategories: ExpenseSubcategoryLookup[],
): boolean {
  const category = expenseCategory.trim();
  const sub = subCategory.trim();
  if (!category || !sub) {
    return false;
  }

  const categoryKey = category.toLowerCase();
  const subKey = sub.toLowerCase();

  return allSubcategories.some(
    (row) =>
      row.is_active &&
      (row.expense_category ?? "").trim().toLowerCase() === categoryKey &&
      row.name.trim().toLowerCase() === subKey,
  );
}

/** Same lookup Expense Register uses for the Sub-Category field (tenant-scoped via RLS). */
export function queryExpenseSubcategoryLookups(client: {
  from: (table: string) => {
    select: (columns: string) => {
      order: (
        column: string,
        options?: { ascending?: boolean },
      ) => unknown;
    };
  };
}) {
  const query = client
    .from("expense_subcategories")
    .select(EXPENSE_SUBCATEGORIES_LOOKUP_SELECT)
    .order("expense_category", { ascending: true }) as {
    order: (
      column: string,
      options?: { ascending?: boolean },
    ) => PromiseLike<{
      data: ExpenseSubcategoryLookup[] | null;
      error: { message: string } | null;
    }>;
  };

  return query.order("name", { ascending: true });
}
