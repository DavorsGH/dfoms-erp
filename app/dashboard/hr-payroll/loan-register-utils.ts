export type LoanRegisterEntry = {
  loan_id: string;
  employee_id: string;
  loan_amount: number;
  date_issued: string;
  repayment_period_months: number;
  monthly_deduction: number;
  total_repaid_to_date: number | null;
  outstanding_balance: number | null;
};

export type LoanStatus = "Active" | "Fully Repaid";
