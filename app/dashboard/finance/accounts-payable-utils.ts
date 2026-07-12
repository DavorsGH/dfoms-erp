export type AccountsPayableEntry = {
  id: string;
  vendor_name: string;
  invoice_number: string;
  expense_category: string;
  sub_category: string;
  description: string | null;
  invoice_date: string;
  due_date: string;
  amount: number;
  amount_paid: number;
  balance_due: number | null;
  status: string;
  notes: string | null;
};

export type PayableStatus = "Paid" | "Overdue" | "Outstanding";

export function formatGHS(value: number): string {
  return `GHS ${value.toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function calculateBalanceDue(
  amount: number,
  amountPaid: number,
): number {
  return amount - amountPaid;
}

export function calculateDaysOutstanding(
  dueDate: string,
  referenceDate = new Date(),
): number {
  const due = new Date(dueDate);
  const today = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate(),
  );
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const diffMs = today.getTime() - dueDay.getTime();

  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

export function calculateStatus(
  balanceDue: number,
  daysOutstanding: number,
): PayableStatus {
  if (balanceDue === 0) {
    return "Paid";
  }

  if (daysOutstanding > 0 && balanceDue > 0) {
    return "Overdue";
  }

  return "Outstanding";
}
