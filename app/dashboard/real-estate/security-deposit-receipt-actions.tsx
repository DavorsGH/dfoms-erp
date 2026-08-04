"use client";

import type { SecurityDepositReceiptData } from "@/utils/security-deposit-receipt";
import SecurityDepositReceiptPdfDocument, {
  type SecurityDepositReceiptPdfKind,
} from "./security-deposit-receipt-pdf-document";
import ReceiptDocumentActions from "./receipt-document-actions";
import {
  SECURITY_DEPOSIT_COLLECTION_PRINT_AREA_ID,
  SECURITY_DEPOSIT_RESOLUTION_PRINT_AREA_ID,
} from "./security-deposit-receipt-view";

type Props = {
  receipt: SecurityDepositReceiptData;
  kind: SecurityDepositReceiptPdfKind;
  secondaryButtonClassName: string;
  primaryButtonClassName: string;
};

export default function SecurityDepositReceiptActions({
  receipt,
  kind,
  secondaryButtonClassName,
  primaryButtonClassName,
}: Props) {
  const printAreaId =
    kind === "collection"
      ? SECURITY_DEPOSIT_COLLECTION_PRINT_AREA_ID
      : SECURITY_DEPOSIT_RESOLUTION_PRINT_AREA_ID;

  return (
    <ReceiptDocumentActions
      fileName={`security-deposit-${kind}-${receipt.receiptReference}.pdf`}
      printAreaId={printAreaId}
      printLabel={kind === "collection" ? "Print collection receipt" : "Print resolution receipt"}
      downloadLabel="Download PDF"
      secondaryButtonClassName={secondaryButtonClassName}
      primaryButtonClassName={primaryButtonClassName}
      renderPdfDocument={() => (
        <SecurityDepositReceiptPdfDocument receipt={receipt} kind={kind} />
      )}
    />
  );
}
