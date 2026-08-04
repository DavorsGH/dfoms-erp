"use client";

import type { RentPaymentReceiptData } from "@/utils/rent-payment-receipt";
import RentPaymentReceiptPdfDocument from "./rent-payment-receipt-pdf-document";
import ReceiptDocumentActions from "./receipt-document-actions";
import {
  RENT_PAYMENT_RECEIPT_PRINT_AREA_ID,
} from "./rent-payment-receipt-view";

type Props = {
  receipt: RentPaymentReceiptData;
  secondaryButtonClassName: string;
  primaryButtonClassName: string;
};

export default function RentPaymentReceiptActions({
  receipt,
  secondaryButtonClassName,
  primaryButtonClassName,
}: Props) {
  const slug =
    receipt.chargeType === "one_time" ? "one-time-charge" : "rent-payment";

  return (
    <ReceiptDocumentActions
      fileName={`${slug}-${receipt.receiptReference}.pdf`}
      printAreaId={RENT_PAYMENT_RECEIPT_PRINT_AREA_ID}
      secondaryButtonClassName={secondaryButtonClassName}
      primaryButtonClassName={primaryButtonClassName}
      renderPdfDocument={() => (
        <RentPaymentReceiptPdfDocument receipt={receipt} />
      )}
    />
  );
}
