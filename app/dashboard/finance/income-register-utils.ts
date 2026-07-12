export type IncomeRegisterEntry = {
  id: string;
  date: string;
  invoice_no: string;
  customer_name: string;
  service_category: string;
  description: string | null;
  amount: number;
  amount_received: number;
  outstanding_balance: number | null;
  payment_status: string;
  due_date: string;
  notes: string | null;
};

export function formatGHS(value: number): string {
  return `GHS ${value.toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function calculateOutstanding(
  amount: number,
  amountReceived: number,
): number {
  return amount - amountReceived;
}

export function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
