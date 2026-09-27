/**
 * Read-only probe helper: reproduces production-deployed (HEAD) loan proceeds/repayments
 * subtraction against active director's-loan ledger inflows/outflows.
 */
import {
  buildMonthlyCashComponents,
  type CashMovementInputs,
  type MonthlyCashComponents,
} from "../../app/dashboard/finance/cash-movement-utils";
import { shouldUseDirectorsLoanLedger } from "../../app/dashboard/finance/directors-loan-ledger-utils";
import type { MonthlyTotals } from "../../app/dashboard/finance/profit-loss-utils";

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundMonthlyTotals(totals: MonthlyTotals): MonthlyTotals {
  return totals.map((value) => roundCurrency(value)) as MonthlyTotals;
}

function addMonthlyTotals(a: MonthlyTotals, b: MonthlyTotals): MonthlyTotals {
  return a.map((value, index) => roundCurrency(value + (b[index] ?? 0))) as MonthlyTotals;
}

function subtractMonthlyTotals(a: MonthlyTotals, b: MonthlyTotals): MonthlyTotals {
  return a.map((value, index) => roundCurrency(value - (b[index] ?? 0))) as MonthlyTotals;
}

export function buildMonthlyCashComponentsAsDeployed(
  inputs: CashMovementInputs,
  financialYear: number,
): MonthlyCashComponents {
  const base = buildMonthlyCashComponents(inputs, financialYear);
  const ledgerEntries = inputs.directorsLoanLedgerEntries ?? [];
  if (!shouldUseDirectorsLoanLedger(ledgerEntries)) {
    return base;
  }

  const loanProceedsForCash = roundMonthlyTotals(
    base.loanProceeds.map((value, index) =>
      roundCurrency((value ?? 0) - (base.directorsLoanInflows[index] ?? 0)),
    ) as MonthlyTotals,
  );
  const loanRepaymentsForCash = roundMonthlyTotals(
    base.loanRepayments.map((value, index) =>
      roundCurrency(
        Math.max(0, (value ?? 0) - (base.directorsLoanRepayments[index] ?? 0)),
      ),
    ) as MonthlyTotals,
  );

  const totalInflows = addMonthlyTotals(
    addMonthlyTotals(
      addMonthlyTotals(
        addMonthlyTotals(base.incomeReceived, base.capitalContributions),
        loanProceedsForCash,
      ),
      base.directorsLoanInflows,
    ),
    base.otherCashInflows,
  );
  const totalOutflows = addMonthlyTotals(
    addMonthlyTotals(
      addMonthlyTotals(
        addMonthlyTotals(
          addMonthlyTotals(
            addMonthlyTotals(base.paidExpenses, loanRepaymentsForCash),
            base.rawMaterialPurchases,
          ),
          base.productPurchases,
        ),
        base.accountsPayableSettlements,
      ),
      base.directorsLoanRepayments,
    ),
    base.fixedAssetPurchases,
  );
  const netMovement = subtractMonthlyTotals(totalInflows, totalOutflows);

  return {
    ...base,
    loanProceeds: loanProceedsForCash,
    loanRepayments: loanRepaymentsForCash,
    netMovement,
  };
}
