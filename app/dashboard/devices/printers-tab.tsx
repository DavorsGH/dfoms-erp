"use client";

import { useMemo, useState } from "react";
import DashboardButton from "@/components/dashboard-button";
import {
  PosReceiptPanel,
  type PosReceiptData,
} from "../pos/pos-receipt";
import ProductBarcodeLabelPrint from "../inventory/product-barcode-label-print";
import type { FinishedProductRecord } from "../inventory/finished-products-utils";
import DeviceSettingsForm from "./device-settings-form";

const SAMPLE_LABEL_PRODUCT: FinishedProductRecord = {
  id: "sample-label",
  business_unit_id: null,
  product_code: "SKU-SAMPLE",
  product_name: "Sample label product",
  unit_of_measure: "piece",
  barcode: "BC9999",
  current_stock: 0,
  standard_selling_price: 10,
  sourcing_type: "purchased",
  supplier_id: null,
  photo_url: null,
  manufacturing_date: null,
  expiration_date: null,
  is_archived: false,
  created_at: "",
  updated_at: "",
};

const SAMPLE_RECEIPT: PosReceiptData = {
  invoiceNo: "POS-TEST-001",
  saleDate: new Date().toISOString(),
  customerLabel: "Walk-in customer",
  paymentMethod: "Cash",
  paymentStatus: "Paid",
  amountReceived: 45,
  cartTotal: 45,
  lines: [
    {
      id: "line-1",
      productId: "p1",
      productCode: "SKU-101",
      productName: "Sample item A",
      unitOfMeasure: "piece",
      quantity: 2,
      unitPrice: 15,
      availableStock: 99,
    },
    {
      id: "line-2",
      productId: "p2",
      productCode: "SKU-202",
      productName: "Sample item B",
      unitOfMeasure: "piece",
      quantity: 1,
      unitPrice: 15,
      availableStock: 99,
    },
  ],
};

export default function PrintersTab({
  tenantId,
  canWriteDevices,
}: {
  tenantId: string | null;
  canWriteDevices: boolean;
}) {
  const [showLabelPrint, setShowLabelPrint] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);
  const receipt = useMemo(() => SAMPLE_RECEIPT, []);

  return (
    <div className="space-y-6">
      <DeviceSettingsForm
        tenantId={tenantId}
        section="printer"
        canSave={canWriteDevices}
      />
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-[#0f2744]">Thermal printers</h3>
        <p className="mt-2 text-sm text-slate-600">
          Receipt and label print use the workspace paper and label size above.
          In the browser print dialog, set margins to none and scale to 100%.
        </p>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-base font-semibold text-[#0f2744]">Test receipt print</h3>
        <p className="mt-1 text-sm text-slate-600">
          Opens the same receipt layout used at POS checkout, then your browser print
          dialog.
        </p>
        <DashboardButton
          type="button"
          className="mt-4"
          onClick={() => setShowReceipt(true)}
        >
          Test receipt print
        </DashboardButton>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-base font-semibold text-[#0f2744]">Test label print</h3>
        <p className="mt-1 text-sm text-slate-600">
          Sample Code128 label using barcode BC9999.
        </p>
        <DashboardButton
          type="button"
          variant="secondary"
          className="mt-4"
          onClick={() => setShowLabelPrint(true)}
        >
          Test label print
        </DashboardButton>
      </section>

      {showReceipt ? (
        <PosReceiptPanel
          receipt={receipt}
          onClose={() => setShowReceipt(false)}
        />
      ) : null}

      {showLabelPrint ? (
        <ProductBarcodeLabelPrint
          product={SAMPLE_LABEL_PRODUCT}
          onClose={() => setShowLabelPrint(false)}
        />
      ) : null}
    </div>
  );
}
