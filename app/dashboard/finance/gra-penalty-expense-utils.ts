import type { SupabaseClient } from "@supabase/supabase-js";
import { scopeToBusinessUnitId } from "@/utils/phase5e-key-structure";
import { formatPeriodMonthLabel } from "./tax-ledger-utils";
import type { GraReconciliationKind } from "./statutory-due-rules";

export const GRA_PENALTY_EXPENSE_CATEGORY = "Finance";

const KIND_LABEL: Record<GraReconciliationKind, string> = {
  vat: "VAT",
  wht: "WHT",
  paye: "PAYE",
};

export function buildGraPenaltyExpenseDescription(
  kind: GraReconciliationKind,
  periodMonth: string,
): string {
  const monthLabel = formatPeriodMonthLabel(periodMonth);
  return `GRA ${KIND_LABEL[kind]} late payment penalty/interest — ${monthLabel}`;
}

export type SimilarPenaltyExpense = {
  id: string;
  date: string;
  description: string | null;
  amount: number;
};

export type LinkedGraPenaltyExpense = {
  expenseId: string;
  date: string;
  amount: number;
  expenses: Array<{ expenseId: string; date: string; amount: number }>;
};

type PenaltyLinkRow = {
  penalty_expense_id: string;
  expense_register:
    | { id: string; date: string; amount: number }
    | { id: string; date: string; amount: number }[]
    | null;
};

function buildLinkedGraPenaltyExpenseFromRows(
  penalties: Array<{ expenseId: string; date: string; amount: number }>,
): LinkedGraPenaltyExpense | null {
  if (penalties.length === 0) {
    return null;
  }

  const totalAmount =
    Math.round(
      penalties.reduce((sum, row) => sum + row.amount, 0) * 100,
    ) / 100;
  const latest = penalties.reduce((best, row) => {
    if (!best) {
      return row;
    }
    return row.date > best.date ? row : best;
  }, penalties[0]);

  return {
    expenseId: latest.expenseId,
    date: latest.date,
    amount: totalAmount,
    expenses: penalties,
  };
}

export async function fetchLinkedGraPenaltyExpenseForPeriod(options: {
  supabase: SupabaseClient;
  tenantId: string;
  businessUnitId: string | null;
  periodMonth: string;
  kind: GraReconciliationKind;
}): Promise<LinkedGraPenaltyExpense | null> {
  let query = options.supabase
    .from("statutory_gra_reconciliation")
    .select(
      "penalty_expense_id, expense_register:penalty_expense_id ( id, date, amount ), statutory_gra_reconciliation_penalty_expenses ( penalty_expense_id, expense_register:penalty_expense_id ( id, date, amount ) )",
    )
    .eq("tenant_id", options.tenantId)
    .eq("period_month", options.periodMonth.slice(0, 10))
    .eq("reconciliation_kind", options.kind);

  query = scopeToBusinessUnitId(query, options.businessUnitId);

  const { data, error } = await query.maybeSingle();

  if (error) {
    console.error(
      "[gra-penalty-expense] linked penalty lookup failed:",
      error.message,
    );
    return null;
  }

  if (!data) {
    return null;
  }

  const linkRows = (data.statutory_gra_reconciliation_penalty_expenses ??
    []) as PenaltyLinkRow[];
  const parsedFromLinks: Array<{
    expenseId: string;
    date: string;
    amount: number;
  }> = [];

  for (const link of linkRows) {
    const expenseJoin = link.expense_register;
    const expenseRow = Array.isArray(expenseJoin)
      ? expenseJoin[0]
      : expenseJoin;
    const expenseId =
      (expenseRow?.id as string | undefined) ??
      (link.penalty_expense_id as string);
    if (!expenseId) {
      continue;
    }
    parsedFromLinks.push({
      expenseId,
      date: expenseRow?.date ? String(expenseRow.date).slice(0, 10) : "",
      amount: expenseRow ? Number(expenseRow.amount) || 0 : 0,
    });
  }

  if (parsedFromLinks.length > 0) {
    return buildLinkedGraPenaltyExpenseFromRows(parsedFromLinks);
  }

  if (!data.penalty_expense_id) {
    return null;
  }

  const expenseJoin = data.expense_register as
    | { id: string; date: string; amount: number }
    | { id: string; date: string; amount: number }[]
    | null;
  const expenseRow = Array.isArray(expenseJoin) ? expenseJoin[0] : expenseJoin;
  const expenseId =
    (expenseRow?.id as string | undefined) ??
    (data.penalty_expense_id as string);

  if (!expenseId) {
    return null;
  }

  return buildLinkedGraPenaltyExpenseFromRows([
    {
      expenseId,
      date: expenseRow?.date ? String(expenseRow.date).slice(0, 10) : "",
      amount: expenseRow ? Number(expenseRow.amount) || 0 : 0,
    },
  ]);
}

function addDays(isoDate: string, days: number): string {
  const parsed = Date.parse(`${isoDate.slice(0, 10)}T12:00:00.000Z`);
  const next = new Date(parsed + days * 86_400_000);
  return next.toISOString().slice(0, 10);
}

export async function findSimilarGraPenaltyExpense(options: {
  supabase: SupabaseClient;
  tenantId: string;
  businessUnitId: string | null;
  kind: GraReconciliationKind;
  periodMonth: string;
  penaltyAmount: number;
  dueDateIso: string;
}): Promise<SimilarPenaltyExpense | null> {
  const periodLabel = formatPeriodMonthLabel(options.periodMonth);
  const kindToken = KIND_LABEL[options.kind];
  const windowStart = addDays(options.dueDateIso, -30);
  const windowEnd = addDays(options.dueDateIso, 30);
  const amountLow = Math.round((options.penaltyAmount - 0.005) * 100) / 100;
  const amountHigh = Math.round((options.penaltyAmount + 0.005) * 100) / 100;

  let penaltyQuery = options.supabase
    .from("expense_register")
    .select("id, date, description, amount")
    .eq("tenant_id", options.tenantId)
    .ilike("description", "%penalty%");

  penaltyQuery = scopeToBusinessUnitId(
    penaltyQuery,
    options.businessUnitId,
  );

  const { data: penaltyRows, error: penaltyError } =
    await penaltyQuery.limit(40);

  if (penaltyError) {
    console.error(
      "[gra-penalty-expense] penalty duplicate lookup failed:",
      penaltyError.message,
    );
  } else {
    for (const row of penaltyRows ?? []) {
      const description = (row.description as string | null) ?? "";
      const lower = description.toLowerCase();
      if (
        lower.includes("penalty") &&
        lower.includes(kindToken.toLowerCase()) &&
        lower.includes(periodLabel.toLowerCase())
      ) {
        return {
          id: row.id as string,
          date: String(row.date).slice(0, 10),
          description: row.description as string | null,
          amount: Number(row.amount) || 0,
        };
      }
    }
  }

  let amountQuery = options.supabase
    .from("expense_register")
    .select("id, date, description, amount")
    .eq("tenant_id", options.tenantId)
    .gte("date", windowStart)
    .lte("date", windowEnd)
    .gte("amount", amountLow)
    .lte("amount", amountHigh);

  amountQuery = scopeToBusinessUnitId(amountQuery, options.businessUnitId);

  const { data: amountRows, error: amountError } = await amountQuery.limit(20);

  if (amountError) {
    console.error(
      "[gra-penalty-expense] amount duplicate lookup failed:",
      amountError.message,
    );
    return null;
  }

  for (const row of amountRows ?? []) {
    const amount = Number(row.amount) || 0;
    if (Math.abs(amount - options.penaltyAmount) <= 0.01) {
      return {
        id: row.id as string,
        date: String(row.date).slice(0, 10),
        description: row.description as string | null,
        amount,
      };
    }
  }

  return null;
}
