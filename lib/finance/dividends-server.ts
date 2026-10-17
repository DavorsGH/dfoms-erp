import type { SupabaseClient } from "@supabase/supabase-js";
import { formatGHS } from "@/app/dashboard/finance/income-register-utils";
import {
  DIVIDEND_ENTITY_TYPE,
  type DividendDeclarationLineRow,
  type ShareholderPaymentMethod,
  type TenantShareholderRow,
} from "@/app/dashboard/finance/dividends-types";
export function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

export function sumActiveSharePct(shareholders: TenantShareholderRow[]): number {
  return roundCurrency(
    shareholders
      .filter((row) => row.is_active)
      .reduce((sum, row) => sum + (Number(row.share_pct) || 0), 0),
  );
}

export type DividendLineDraft = {
  shareholder_id: string;
  payee_name: string;
  tin: string | null;
  share_pct: number;
  gross_amount: number;
  wht_amount: number;
  net_amount: number;
};

export function buildDividendLinesFromShareholders(input: {
  shareholders: TenantShareholderRow[];
  grossAmount: number;
  whtRatePct: number;
}): { lines: DividendLineDraft[]; whtAmount: number; netAmount: number } {
  const active = input.shareholders.filter((row) => row.is_active);
  const grossAmount = roundCurrency(input.grossAmount);
  const whtRate = Number(input.whtRatePct) || 0;
  const declarationWht = roundCurrency((grossAmount * whtRate) / 100);
  const declarationNet = roundCurrency(grossAmount - declarationWht);

  const lines: DividendLineDraft[] = active.map((sh) => {
    const lineGross = roundCurrency((grossAmount * (Number(sh.share_pct) || 0)) / 100);
    const lineWht = roundCurrency((lineGross * whtRate) / 100);
    const lineNet = roundCurrency(lineGross - lineWht);
    return {
      shareholder_id: sh.id,
      payee_name: sh.full_name,
      tin: sh.tin,
      share_pct: Number(sh.share_pct) || 0,
      gross_amount: lineGross,
      wht_amount: lineWht,
      net_amount: lineNet,
    };
  });

  const grossSum = roundCurrency(
    lines.reduce((sum, row) => sum + row.gross_amount, 0),
  );
  const grossDiff = roundCurrency(grossAmount - grossSum);
  if (lines.length > 0 && Math.abs(grossDiff) >= 0.005) {
    const largest = lines.reduce((best, row) =>
      row.gross_amount > best.gross_amount ? row : best,
    );
    largest.gross_amount = roundCurrency(largest.gross_amount + grossDiff);
    largest.wht_amount = roundCurrency((largest.gross_amount * whtRate) / 100);
    largest.net_amount = roundCurrency(largest.gross_amount - largest.wht_amount);
  }

  const whtSum = roundCurrency(lines.reduce((sum, row) => sum + row.wht_amount, 0));
  const whtDiff = roundCurrency(declarationWht - whtSum);
  if (lines.length > 0 && Math.abs(whtDiff) >= 0.005) {
    const largest = lines.reduce((best, row) =>
      row.gross_amount > best.gross_amount ? row : best,
    );
    largest.wht_amount = roundCurrency(largest.wht_amount + whtDiff);
    largest.net_amount = roundCurrency(largest.gross_amount - largest.wht_amount);
  }

  const netSum = roundCurrency(lines.reduce((sum, row) => sum + row.net_amount, 0));
  const netDiff = roundCurrency(declarationNet - netSum);
  if (lines.length > 0 && Math.abs(netDiff) >= 0.005) {
    const largest = lines.reduce((best, row) =>
      row.gross_amount > best.gross_amount ? row : best,
    );
    largest.net_amount = roundCurrency(largest.net_amount + netDiff);
  }

  return {
    lines,
    whtAmount: declarationWht,
    netAmount: declarationNet,
  };
}

export async function allocateDividendNumber(
  admin: SupabaseClient,
  tenantId: string,
): Promise<{ number: string | null; error: string | null }> {
  const { data, error } = await admin.rpc("generate_next_code", {
    p_tenant_id: tenantId,
    p_entity_type: DIVIDEND_ENTITY_TYPE,
    p_padding: 4,
  });
  if (error) {
    return { number: null, error: error.message };
  }
  const number = typeof data === "string" ? data.trim() : "";
  if (!number) {
    return { number: null, error: "Could not allocate a declaration number." };
  }
  return { number, error: null };
}

export function validateShareholderPaymentFields(input: {
  payment_method: ShareholderPaymentMethod;
  momo_number?: string | null;
  bank_name?: string | null;
  bank_account_number?: string | null;
}): string | null {
  if (input.payment_method === "momo") {
    if (!input.momo_number?.trim()) {
      return "MoMo number is required for MoMo payment method.";
    }
  }
  if (input.payment_method === "bank") {
    if (!input.bank_name?.trim() || !input.bank_account_number?.trim()) {
      return "Bank name and account number are required for bank payment method.";
    }
  }
  return null;
}

export function lineFullyPaid(line: Pick<DividendDeclarationLineRow, "net_amount" | "paid_amount">): boolean {
  return (Number(line.paid_amount) || 0) >= (Number(line.net_amount) || 0) - 0.005;
}

export function dividendGrossExceedsRetainedEarningsMessage(
  grossAmount: number,
  retainedEarnings: number,
): string {
  return `Gross dividend ${formatGHS(grossAmount)} exceeds retained earnings to date ${formatGHS(retainedEarnings)} for this business unit.`;
}

/** Postgres RPC errors are already plain English — pass through to the UI modal. */
export function dividendRpcErrorMessage(error: { message?: string } | null): string {
  return error?.message?.trim() || "Dividend action failed.";
}
