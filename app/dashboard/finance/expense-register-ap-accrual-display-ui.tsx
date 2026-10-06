import Link from "next/link";
import Tooltip from "@/components/ui/tooltip";
import type { ReactNode } from "react";
import {
  accountsPayableHref,
  apAccrualPaymentStatusToneClassName,
  type ApAccrualPaymentStatusDisplay,
} from "./expense-register-ap-accrual-display";

export function buildApAccrualPaymentStatusDetailValue(
  display: ApAccrualPaymentStatusDisplay,
): ReactNode {
  return (
    <>
      <span className={apAccrualPaymentStatusToneClassName(display.tone)}>
        {display.label}
      </span>{" "}
      <Link
        href={accountsPayableHref(display.apId)}
        className="inline-flex items-center gap-0.5 text-xs font-medium text-[#0f2744] underline hover:text-[#1a3a5c]"
      >
        View bill
      </Link>
    </>
  );
}

export function buildApAccrualPaymentStatusListCell(
  display: ApAccrualPaymentStatusDisplay,
): ReactNode {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <span className={apAccrualPaymentStatusToneClassName(display.tone)}>
        {display.label}
      </span>
      <Tooltip content="View bill in Accounts Payable">
        <Link
          href={accountsPayableHref(display.apId)}
          className="inline-flex shrink-0 items-center text-xs font-medium text-[#0f2744] underline hover:text-[#1a3a5c]"
          onClick={(event) => event.stopPropagation()}
        >
          View bill
        </Link>
      </Tooltip>
    </span>
  );
}
