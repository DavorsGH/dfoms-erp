/**
 * Quick regression for Expense Register Sub-Category select sync.
 * Run: npx tsx scripts/test-expense-subcategory-select-sync.ts
 */
import {
  expenseSubcategoryOptionsForCategory,
  expenseSubcategorySelectValueForOptions,
  type ExpenseSubcategoryLookup,
} from "@/app/dashboard/finance/expense-register-utils";

const subs: ExpenseSubcategoryLookup[] = [
  {
    id: "1",
    name: "Office Rent",
    expense_category: "Administrative",
    is_active: true,
  },
  {
    id: "2",
    name: "Payroll",
    expense_category: "Direct Operational",
    is_active: true,
  },
  {
    id: "3",
    name: "Utilities",
    expense_category: "Administrative",
    is_active: true,
  },
];

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

// Stale Payroll while category is Administrative → coerced empty (not in options).
let adminOptions = expenseSubcategoryOptionsForCategory(
  "Administrative",
  subs,
  "Payroll",
);
assert(
  expenseSubcategorySelectValueForOptions("Payroll", adminOptions) === "",
  "Stale cross-category value must clear",
);
assert(
  !adminOptions.some((row) => row.name === "Payroll"),
  "Payroll must not appear under Administrative",
);

// User picks Office Rent under Administrative.
adminOptions = expenseSubcategoryOptionsForCategory(
  "Administrative",
  subs,
  "Office Rent",
);
assert(
  expenseSubcategorySelectValueForOptions("Office Rent", adminOptions) ===
    "Office Rent",
  "Valid selection must bind",
);

// Switch to Direct Operational, back to Administrative, pick Utilities.
let directOptions = expenseSubcategoryOptionsForCategory(
  "Direct Operational",
  subs,
  "",
);
assert(
  expenseSubcategorySelectValueForOptions("Payroll", directOptions) ===
    "Payroll",
  "Payroll valid under Direct Operational",
);

adminOptions = expenseSubcategoryOptionsForCategory(
  "Administrative",
  subs,
  "Utilities",
);
assert(
  expenseSubcategorySelectValueForOptions("Utilities", adminOptions) ===
    "Utilities",
  "After category round-trip, saved value must match Utilities",
);

console.log("test-expense-subcategory-select-sync: OK");
