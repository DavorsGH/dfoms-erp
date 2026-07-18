/**
 * Verifies sequential product-sale import continues after a mid-batch RPC failure.
 * Mirrors runProductSaleImportSequentially from product-sales-bulk-import-utils.ts.
 * Run: node scripts/verify-product-sales-bulk-import-partial.mjs
 */

async function runProductSaleImportSequentially(readyRows, invokeRpc) {
  const succeeded = [];
  const failed = [];

  for (const row of readyRows) {
    if (!row.payload) {
      continue;
    }

    const { data, error } = await invokeRpc(row.payload);

    if (error) {
      failed.push({
        rowNumber: row.rowNumber,
        invoiceNo: row.invoiceNo,
        success: false,
        errorMessage: error.message,
      });
      continue;
    }

    succeeded.push({
      rowNumber: row.rowNumber,
      invoiceNo: row.invoiceNo,
      success: true,
      incomeId: data ?? undefined,
    });
  }

  return { succeeded, failed };
}

const readyRows = [
  {
    rowNumber: 2,
    invoiceNo: "INV-001",
    payload: { p_invoice_no: "INV-001" },
  },
  {
    rowNumber: 3,
    invoiceNo: "INV-002",
    payload: { p_invoice_no: "INV-002" },
  },
  {
    rowNumber: 4,
    invoiceNo: "INV-003",
    payload: { p_invoice_no: "INV-003" },
  },
];

let callCount = 0;

const summary = await runProductSaleImportSequentially(readyRows, async (payload) => {
  callCount += 1;

  if (payload.p_invoice_no === "INV-002") {
    return {
      data: null,
      error: { message: "Only 0 units in stock, cannot sell 5" },
    };
  }

  return {
    data: `income-${payload.p_invoice_no}`,
    error: null,
  };
});

const ok =
  callCount === 3 &&
  summary.succeeded.length === 2 &&
  summary.failed.length === 1 &&
  summary.succeeded.map((row) => row.invoiceNo).join(",") === "INV-001,INV-003" &&
  summary.failed[0]?.invoiceNo === "INV-002" &&
  summary.failed[0]?.errorMessage.includes("stock");

if (!ok) {
  console.error("Partial failure simulation FAILED", { callCount, summary });
  process.exit(1);
}

console.log("Partial failure simulation passed:");
console.log(`  RPC calls: ${callCount}`);
console.log(
  `  Succeeded: ${summary.succeeded.length} (${summary.succeeded.map((r) => r.invoiceNo).join(", ")})`,
);
console.log(
  `  Failed: ${summary.failed.length} (${summary.failed[0].invoiceNo}: ${summary.failed[0].errorMessage})`,
);
