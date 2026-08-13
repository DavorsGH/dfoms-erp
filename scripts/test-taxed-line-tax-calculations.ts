/**
 * Unit tests: per-line Taxed flag in quotation/invoice tax calculations.
 * Usage: npx tsx scripts/test-taxed-line-tax-calculations.ts
 */
import {
  computeInvoiceTotals,
  isLineTaxedForSalesTax,
} from "../utils/client-invoices-types";
import {
  computeQuotationTotals,
  quotationToInvoiceWriteBody,
  type ClientQuotationHeaderRow,
  type ClientQuotationLineItemInput,
} from "../utils/client-quotations-types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function line(
  partial: Partial<ClientQuotationLineItemInput> & Pick<ClientQuotationLineItemInput, "description">,
): ClientQuotationLineItemInput {
  return {
    site_id: null,
    category_label: null,
    labour_amount: 0,
    material_amount: 0,
    discount_amount: 0,
    taxed: true,
    sort_order: 0,
    ...partial,
  };
}

console.log("=== Taxed line tax calculation tests ===\n");

// 1. isLineTaxedForSalesTax defaults
assert(isLineTaxedForSalesTax(true), "true is taxed");
assert(isLineTaxedForSalesTax(undefined), "undefined is taxed");
assert(isLineTaxedForSalesTax(null), "null is taxed");
assert(!isLineTaxedForSalesTax(false), "false is not taxed");

// 2. Quotation service_only — untaxed line excluded from VAT/WHT base
{
  const items = [
    line({ description: "Taxed service", labour_amount: 1000, material_amount: 500, taxed: true }),
    line({ description: "Exempt service", labour_amount: 2000, material_amount: 0, taxed: false }),
  ];
  const allTaxed = computeQuotationTotals(items, 20, 7.5, "service_only");
  const mixed = computeQuotationTotals(items, 20, 7.5, "service_only");

  assert(allTaxed.subtotal === 3500, `subtotal all lines: ${allTaxed.subtotal}`);
  assert(mixed.subtotal === 3500, `subtotal unchanged with untaxed: ${mixed.subtotal}`);
  assert(mixed.tax_base === 1000, `tax base labour taxed only: ${mixed.tax_base}`);
  assert(mixed.tax_due === 200, `VAT 20% of 1000: ${mixed.tax_due}`);
  assert(mixed.wht_amount === 75, `WHT 7.5% of 1000: ${mixed.wht_amount}`);
  assert(mixed.total_amount_due === 3700, `total due subtotal+vat: ${mixed.total_amount_due}`);
  console.log("PASS quotation service_only excludes untaxed labour from tax base");
}

// 3. Quotation total_cost — untaxed line total_cost excluded
{
  const items = [
    line({ description: "Taxed", labour_amount: 100, material_amount: 400, taxed: true }),
    line({ description: "Exempt", labour_amount: 50, material_amount: 950, taxed: false }),
  ];
  const totals = computeQuotationTotals(items, 20, 7.5, "total_cost");
  assert(totals.subtotal === 1500, `subtotal all lines: ${totals.subtotal}`);
  assert(totals.tax_base === 500, `tax base taxed line total only: ${totals.tax_base}`);
  assert(totals.tax_due === 100, `VAT: ${totals.tax_due}`);
  console.log("PASS quotation total_cost excludes untaxed line total_cost");
}

// 4. Product quotation header discount — subtotal reduced, tax base uses taxed lines only
{
  const items = [
    line({
      description: "Product A",
      labour_amount: 0,
      material_amount: 800,
      taxed: true,
      product_id: "p1",
      quantity: 1,
      unit_price: 800,
    }),
    line({
      description: "Product B exempt",
      labour_amount: 0,
      material_amount: 200,
      taxed: false,
      product_id: "p2",
      quantity: 1,
      unit_price: 200,
    }),
  ];
  const totals = computeQuotationTotals(items, 20, 7.5, "total_cost", 100, "product");
  assert(totals.line_subtotal === 1000, `line subtotal: ${totals.line_subtotal}`);
  assert(totals.subtotal === 900, `subtotal after header discount: ${totals.subtotal}`);
  assert(totals.tax_base === 800, `tax base taxed product only: ${totals.tax_base}`);
  assert(totals.tax_due === 160, `VAT: ${totals.tax_due}`);
  console.log("PASS product quotation header discount does not inflate tax base");
}

// 5. Invoice — same behaviour
{
  const items = [
    line({ description: "Taxed", labour_amount: 500, material_amount: 0, taxed: true }),
    line({ description: "Exempt", labour_amount: 300, material_amount: 0, taxed: false }),
  ];
  const totals = computeInvoiceTotals(items, 20, 7.5, "service_only");
  assert(totals.subtotal === 800, `invoice subtotal: ${totals.subtotal}`);
  assert(totals.tax_base === 500, `invoice tax base: ${totals.tax_base}`);
  assert(totals.tax_due === 100, `invoice VAT: ${totals.tax_due}`);
  console.log("PASS invoice service_only excludes untaxed labour");
}

// 6. Conversion path — header discount line taxed:false excluded; fixedHeaderTotals match
{
  const quotationHeader = {
    client_id: "c1",
    quotation_type: "product",
    tax_basis: "total_cost",
    issue_date: "2026-08-01",
    valid_until: "2026-08-31",
    bill_to_name: "Test Client",
    bill_to_address: null,
    bill_to_phone: null,
    vat_nhil_getfund_rate: 20,
    wht_rate: 7.5,
    header_discount_amount: 50,
    status: "accepted",
    notes: null,
    authorized_by_name: null,
    authorized_by_title: null,
  } as ClientQuotationHeaderRow;

  const lineItems = [
    line({
      description: "Widget",
      material_amount: 500,
      taxed: true,
      product_id: "p1",
      quantity: 1,
      unit_price: 500,
    }),
  ];

  const qTotals = computeQuotationTotals(
    lineItems,
    20,
    7.5,
    "total_cost",
    50,
    "product",
  );

  const invoiceBody = quotationToInvoiceWriteBody(
    quotationHeader,
    lineItems,
    [],
  );

  const discountLine = invoiceBody.line_items.find(
    (l) => l.description === "Quotation discount",
  );
  assert(discountLine?.taxed === false, "conversion discount line is taxed:false");

  const invoiceTotals = computeInvoiceTotals(
    invoiceBody.line_items,
    20,
    7.5,
    "total_cost",
  );

  // Invoice lines: product 500 + discount line (0 labour/material, 50 discount) -> subtotal 450
  assert(invoiceTotals.subtotal === 450, `invoice subtotal after discount line: ${invoiceTotals.subtotal}`);
  assert(invoiceTotals.tax_base === 500, `invoice tax base product only: ${invoiceTotals.tax_base}`);
  assert(invoiceTotals.tax_due === 100, `invoice VAT on taxed product: ${invoiceTotals.tax_due}`);

  const fixedHeaderTotals = {
    subtotal: qTotals.subtotal,
    tax_due: qTotals.tax_due,
    wht_amount: qTotals.wht_amount,
    total_amount_due: qTotals.total_amount_due,
  };

  assert(fixedHeaderTotals.subtotal === 450, `quotation subtotal for fixedHeader: ${fixedHeaderTotals.subtotal}`);
  assert(fixedHeaderTotals.tax_due === 100, `quotation tax_due for fixedHeader: ${fixedHeaderTotals.tax_due}`);
  assert(
    fixedHeaderTotals.tax_due === invoiceTotals.tax_due,
    "fixedHeaderTotals tax_due matches recomputed invoice tax when lines align",
  );

  console.log("PASS conversion discount line excluded; fixedHeaderTotals flow consistent");
}

console.log("\nALL PASS — form preview and server save share computeQuotationTotals/computeInvoiceTotals");
