import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

export type LinkedProductSaleCogs = {
  invoiceNo: string;
  linkType: "cogs" | "cogs_reversal";
};

const COGS_EXPENSE_FK = "income_register_cogs_expense_id_fkey";
const COGS_REVERSAL_EXPENSE_FK =
  "income_register_cogs_reversal_expense_id_fkey";

export function formatLinkedProductSaleCogsDeleteMessage(
  link: LinkedProductSaleCogs,
): string {
  if (link.linkType === "cogs_reversal") {
    return `This is a system-generated COGS reversal for voided product sale ${link.invoiceNo}. It cannot be deleted directly.`;
  }

  return `This is a system-generated cost entry for product sale ${link.invoiceNo}. To remove it, void the original sale from Sales & CRM → Sales Log instead.`;
}

export function isIncomeRegisterCogsExpenseFkError(
  error: Pick<PostgrestError, "code" | "message"> | null | undefined,
): boolean {
  if (!error) {
    return false;
  }

  const message = (error.message ?? "").toLowerCase();
  return (
    message.includes(COGS_EXPENSE_FK) ||
    message.includes(COGS_REVERSAL_EXPENSE_FK)
  );
}

function mapIncomeRowToLinkedCogs(
  row: {
    invoice_no: string | null;
    cogs_expense_id: string | null;
    cogs_reversal_expense_id: string | null;
  },
  targetExpenseId: string,
): LinkedProductSaleCogs | null {
  const invoiceNo = (row.invoice_no ?? "").trim();
  if (!invoiceNo) {
    return null;
  }

  if (row.cogs_expense_id === targetExpenseId) {
    return { invoiceNo, linkType: "cogs" };
  }

  if (row.cogs_reversal_expense_id === targetExpenseId) {
    return { invoiceNo, linkType: "cogs_reversal" };
  }

  return null;
}

export async function fetchLinkedProductSaleCogsByExpenseId(
  supabase: SupabaseClient,
): Promise<Map<string, LinkedProductSaleCogs>> {
  const { data, error } = await supabase
    .from("income_register")
    .select("invoice_no, cogs_expense_id, cogs_reversal_expense_id")
    .or(
      "cogs_expense_id.not.is.null,cogs_reversal_expense_id.not.is.null",
    );

  if (error) {
    throw new Error(error.message);
  }

  const linked = new Map<string, LinkedProductSaleCogs>();

  for (const row of data ?? []) {
    const cogsExpenseId = row.cogs_expense_id;
    if (cogsExpenseId) {
      const invoiceNo = (row.invoice_no ?? "").trim();
      if (invoiceNo) {
        linked.set(cogsExpenseId, { invoiceNo, linkType: "cogs" });
      }
    }

    const reversalExpenseId = row.cogs_reversal_expense_id;
    if (reversalExpenseId) {
      const invoiceNo = (row.invoice_no ?? "").trim();
      if (invoiceNo) {
        linked.set(reversalExpenseId, {
          invoiceNo,
          linkType: "cogs_reversal",
        });
      }
    }
  }

  return linked;
}

export async function lookupLinkedProductSaleCogsForExpense(
  supabase: SupabaseClient,
  expenseId: string,
): Promise<LinkedProductSaleCogs | null> {
  const { data, error } = await supabase
    .from("income_register")
    .select("invoice_no, cogs_expense_id, cogs_reversal_expense_id")
    .or(
      `cogs_expense_id.eq.${expenseId},cogs_reversal_expense_id.eq.${expenseId}`,
    )
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return null;
  }

  return mapIncomeRowToLinkedCogs(data, expenseId);
}
