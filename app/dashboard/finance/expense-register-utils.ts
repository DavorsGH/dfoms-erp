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
};

export function formatGHS(value: number): string {
  return `GHS ${value.toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function calculateAmount(price: number, quantity: number): number {
  return price * quantity;
}

export function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
