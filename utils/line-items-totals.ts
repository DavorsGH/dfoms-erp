import {
  DEFAULT_SALES_TAX_BASIS,
  type SalesTaxBasis,
} from "@/app/dashboard/finance/tax-utils";
import {
  computeLineTotalCost,
  isLineTaxedForSalesTax,
  roundMoney,
  toNumber,
} from "@/utils/client-invoices-types";

export type LineItemTotalsLine = {
  labour_amount: unknown;
  material_amount: unknown;
  discount_amount: unknown;
  taxed?: boolean | null;
};

export type LineItemTotalsResult<T extends LineItemTotalsLine> = {
  line_items: Array<T & { total_cost: number }>;
  subtotal: number;
  tax_due: number;
  wht_amount: number;
  total_amount_due: number;
  labour_total: number;
  tax_base: number;
};

/**
 * Single source of truth for service/material line-item subtotal, tax base, VAT, WHT, and total.
 * Pass resolveLineTotalCost when lines use non-standard totals (e.g. product quotation qty × unit price).
 */
export function computeLineItemTotals<T extends LineItemTotalsLine>(
  lineItems: T[],
  vatRate: unknown,
  whtRate: unknown,
  taxBasis: SalesTaxBasis = DEFAULT_SALES_TAX_BASIS,
  resolveLineTotalCost: (line: T) => number = computeLineTotalCost as (line: T) => number,
): LineItemTotalsResult<T> {
  const normalizedLines = lineItems.map((line) => ({
    ...line,
    total_cost: resolveLineTotalCost(line),
  }));

  const subtotal = roundMoney(
    normalizedLines.reduce((sum, line) => sum + line.total_cost, 0),
  );
  const labourTotal = roundMoney(
    normalizedLines.reduce((sum, line) => sum + toNumber(line.labour_amount), 0),
  );
  const taxedLineSubtotal = roundMoney(
    normalizedLines
      .filter((line) => isLineTaxedForSalesTax(line.taxed))
      .reduce((sum, line) => sum + line.total_cost, 0),
  );
  const taxedLabourTotal = roundMoney(
    normalizedLines
      .filter((line) => isLineTaxedForSalesTax(line.taxed))
      .reduce((sum, line) => sum + toNumber(line.labour_amount), 0),
  );
  const taxBase = taxBasis === "total_cost" ? taxedLineSubtotal : taxedLabourTotal;
  const vat = roundMoney((taxBase * toNumber(vatRate)) / 100);
  const wht = roundMoney((taxBase * toNumber(whtRate)) / 100);
  const totalAmountDue = roundMoney(subtotal + vat);

  return {
    line_items: normalizedLines,
    subtotal,
    tax_due: vat,
    wht_amount: wht,
    total_amount_due: totalAmountDue,
    labour_total: labourTotal,
    tax_base: taxBase,
  };
}
