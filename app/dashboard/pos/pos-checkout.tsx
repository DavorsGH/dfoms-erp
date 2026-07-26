"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/utils/supabase/client";
import { PAYMENT_SETTINGS_REQUIRED_CODE } from "@/utils/product-sale-paystack";
import { inputClassName } from "../employees/employee-record-utils";
import {
  FINISHED_PRODUCT_SELECT,
  normalizeFinishedProduct,
  type FinishedProductRecord,
} from "../inventory/finished-products-utils";
import {
  formatInventoryMoney,
  formatInventoryQuantity,
} from "../inventory/inventory-utils";
import type { ClientEntry } from "../operations/clients-utils";
import { formatGHS } from "../finance/income-register-utils";
import { getStripedRowClassName } from "../finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import {
  POS_CHECKOUT_PAYMENT_METHODS,
  POS_MOMO_PAYMENT_METHOD,
  cartTotal,
  getAvailableStockForProduct,
  getCustomerDisplayName,
  lineSubtotal,
  runPosCheckout,
  type PosCartLine,
  type PosCheckoutRunSummary,
} from "./pos-utils";
import { PosReceiptPanel, type PosReceiptData } from "./pos-receipt";
import RequestPaymentModal from "./request-payment-modal";
import { openPaystackInlineWithAccessCode } from "./paystack-inline";

type PosCheckoutProps = {
  /** Hidden when the page renders inside the Sales & CRM shell, which already
   * shows a "POS" section title. */
  showTitle?: boolean;
  initialClients: ClientEntry[];
  initialProducts: FinishedProductRecord[];
  /** Kept for API compat; POS checkout uses Cash / Mobile Money only. */
  initialPaymentMethods: string[];
  fetchError: string | null;
};

type MomoInitializeResponse = {
  ok?: boolean;
  error?: string;
  /** Machine-readable error code (e.g. payment_settings_required). */
  code?: string;
  payment_request_id?: string;
  reference?: string;
  access_code?: string;
  amount_ghs?: number;
};

type MomoConfirmResponse = {
  ok?: boolean;
  error?: string;
  invoice_no?: string;
  already_fulfilled?: boolean;
};

function createCartLineId(): string {
  return crypto.randomUUID();
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function PosCheckout({
  showTitle = true,
  initialClients,
  initialProducts,
  initialPaymentMethods,
  fetchError,
}: PosCheckoutProps) {
  const supabase = createClient();
  const [products, setProducts] = useState(
    initialProducts.map(normalizeFinishedProduct),
  );
  const [cartLines, setCartLines] = useState<PosCartLine[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [clientId, setClientId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<string>("");
  const [dueDate, setDueDate] = useState(todayIsoDate());
  const [notes, setNotes] = useState("");
  const [payerEmail, setPayerEmail] = useState("");
  const [payerPhone, setPayerPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [momoWaiting, setMomoWaiting] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);
  /** True when the backend blocked payment because the tenant has no active
   * settlement account — shows a link to Payment Settings. */
  const [paymentSettingsRequired, setPaymentSettingsRequired] = useState(false);
  const [checkoutResult, setCheckoutResult] =
    useState<PosCheckoutRunSummary | null>(null);
  const [pendingInvoiceNo, setPendingInvoiceNo] = useState<string | null>(null);
  const [accumulatedReceiptLines, setAccumulatedReceiptLines] = useState<
    PosCartLine[]
  >([]);
  const [receipt, setReceipt] = useState<PosReceiptData | null>(null);
  const [showRequestPayment, setShowRequestPayment] = useState(false);
  /** Snapshot of cart + customer when opening Request Payment (charge-first). */
  const [requestPaymentDraft, setRequestPaymentDraft] = useState<{
    cartLines: PosCartLine[];
    saleDate: string;
    clientId: string | null;
    customerName: string | null;
    notes: string | null;
    dueDate: string;
    amountGhs: number;
    paymentMethod: string;
  } | null>(null);

  void initialPaymentMethods;

  const filteredProducts = useMemo(() => {
    const query = productSearch.trim().toLowerCase();
    if (!query) {
      return products;
    }

    return products.filter(
      (product) =>
        product.product_name.toLowerCase().includes(query) ||
        product.product_code.toLowerCase().includes(query),
    );
  }, [productSearch, products]);

  const total = useMemo(() => cartTotal(cartLines), [cartLines]);
  const isMobileMoney = paymentMethod === POS_MOMO_PAYMENT_METHOD;
  const busy = loading || momoWaiting;

  async function refreshProducts() {
    const { data, error: productError } = await supabase
      .from("finished_products")
      .select(FINISHED_PRODUCT_SELECT)
      .order("product_name", { ascending: true });

    if (productError) {
      setError(productError.message);
      return;
    }

    setProducts(
      ((data as FinishedProductRecord[] | null) ?? []).map((row) =>
        normalizeFinishedProduct(row),
      ),
    );
  }

  function addProductToCart(product: FinishedProductRecord) {
    const available = getAvailableStockForProduct(product, cartLines);
    if (available <= 0) {
      setError(
        `No stock available for ${product.product_name}. Current stock: ${formatInventoryQuantity(product.current_stock)} ${product.unit_of_measure}.`,
      );
      return;
    }

    setError(null);
    setCheckoutResult(null);

    setCartLines((current) => [
      ...current,
      {
        id: createCartLineId(),
        productId: product.id,
        productCode: product.product_code,
        productName: product.product_name,
        unitOfMeasure: product.unit_of_measure,
        quantity: 1,
        unitPrice: product.standard_selling_price ?? 0,
        availableStock: product.current_stock,
      },
    ]);
  }

  function updateCartLine(
    lineId: string,
    field: "quantity" | "unitPrice",
    value: string,
  ) {
    setCheckoutResult(null);

    setCartLines((current) =>
      current.map((line) => {
        if (line.id !== lineId) {
          return line;
        }

        if (field === "unitPrice") {
          const unitPrice = Number.parseFloat(value);
          return {
            ...line,
            unitPrice: Number.isNaN(unitPrice) ? 0 : unitPrice,
          };
        }

        const quantity = Number.parseFloat(value);
        const product = products.find((item) => item.id === line.productId);
        if (!product) {
          return { ...line, quantity: Number.isNaN(quantity) ? 0 : quantity };
        }

        const available = getAvailableStockForProduct(
          product,
          current,
          lineId,
        );
        const nextQuantity = Number.isNaN(quantity) ? 0 : quantity;

        if (nextQuantity > available) {
          setError(
            `Only ${formatInventoryQuantity(available)} ${product.unit_of_measure} of ${product.product_name} available (including items already in cart).`,
          );
          return line;
        }

        setError(null);
        return { ...line, quantity: nextQuantity };
      }),
    );
  }

  function removeCartLine(lineId: string) {
    setCheckoutResult(null);
    setCartLines((current) => current.filter((line) => line.id !== lineId));
  }

  function resetCheckoutForm() {
    setCartLines([]);
    setClientId("");
    setCustomerName("");
    setPayerEmail("");
    setPayerPhone("");
    setPaymentMethod("");
    setDueDate(todayIsoDate());
    setNotes("");
    setProductSearch("");
    setCheckoutResult(null);
    setPendingInvoiceNo(null);
    setAccumulatedReceiptLines([]);
    setReceipt(null);
    setShowRequestPayment(false);
    setRequestPaymentDraft(null);
    setMomoWaiting(false);
    setError(null);
    setPaymentSettingsRequired(false);
  }

  function validateCheckoutBasics(): {
    trimmedClientId: string | null;
    trimmedCustomerName: string | null;
  } | null {
    const trimmedClientId = clientId.trim() || null;
    const trimmedCustomerName = customerName.trim() || null;

    if (!trimmedClientId && !trimmedCustomerName) {
      setError(
        "Select a customer or enter a walk-in / other payer name.",
      );
      return null;
    }

    if (cartLines.length === 0) {
      setError("Add at least one product to the cart.");
      return null;
    }

    if (!paymentMethod.trim()) {
      setError("Select a payment method.");
      return null;
    }

    for (const line of cartLines) {
      if (line.quantity <= 0) {
        setError("Each cart line must have a quantity greater than zero.");
        return null;
      }

      if (line.unitPrice < 0) {
        setError("Unit prices must be zero or greater.");
        return null;
      }

      const product = products.find((item) => item.id === line.productId);
      if (!product) {
        setError("A product in the cart is no longer available.");
        return null;
      }

      const available = getAvailableStockForProduct(product, cartLines, line.id);
      if (line.quantity > available) {
        setError(
          `Only ${formatInventoryQuantity(available)} ${product.unit_of_measure} of ${product.product_name} available.`,
        );
        return null;
      }
    }

    return { trimmedClientId, trimmedCustomerName };
  }

  function showPaidReceipt(input: {
    invoiceNo: string;
    customerLabel: string;
    paymentMethod: string;
    lines: PosCartLine[];
    amountReceived: number;
  }) {
    const receiptTotal = cartTotal(input.lines);
    setReceipt({
      invoiceNo: input.invoiceNo,
      saleDate: todayIsoDate(),
      customerLabel: input.customerLabel,
      paymentMethod: input.paymentMethod,
      paymentStatus: "Paid",
      amountReceived: input.amountReceived,
      cartTotal: receiptTotal,
      lines: input.lines,
    });
    setCheckoutResult(null);
    setPendingInvoiceNo(null);
    setAccumulatedReceiptLines([]);
    setCartLines([]);
    setShowRequestPayment(false);
    setRequestPaymentDraft(null);
  }

  async function completeCashSale(
    trimmedClientId: string | null,
    trimmedCustomerName: string | null,
  ) {
    const amountReceived = cartTotal(cartLines);
    const summary = await runPosCheckout(supabase, {
      saleDate: todayIsoDate(),
      invoiceNo: pendingInvoiceNo,
      clientId: trimmedClientId,
      customerName: trimmedClientId ? null : trimmedCustomerName,
      paymentMethod: paymentMethod.trim(),
      amountReceived,
      paymentStatus: "Paid",
      dueDate,
      notes: notes.trim() || null,
      cartLines,
    });

    await refreshProducts();

    if (summary.stoppedEarly) {
      const succeededLineIds = new Set(
        summary.succeeded.map((line) => line.lineId),
      );
      const postedSnapshots = cartLines.filter((line) =>
        succeededLineIds.has(line.id),
      );
      setAccumulatedReceiptLines((current) => [...current, ...postedSnapshots]);
      setCartLines((current) =>
        current.filter((line) => !succeededLineIds.has(line.id)),
      );
      setPendingInvoiceNo(summary.invoiceNo);
      setCheckoutResult(summary);
      setError(
        "Checkout stopped because a line item failed. Review the succeeded and failed lines below before retrying the remaining items or handling them manually in Product Sales.",
      );
      return;
    }

    if (!summary.invoiceNo) {
      setError("Checkout completed but no invoice number was returned from the server.");
      return;
    }

    const receiptLines = [...accumulatedReceiptLines, ...cartLines];
    showPaidReceipt({
      invoiceNo: summary.invoiceNo,
      customerLabel: getCustomerDisplayName(
        trimmedClientId,
        trimmedCustomerName,
        initialClients,
      ),
      paymentMethod: paymentMethod.trim(),
      lines: receiptLines,
      amountReceived: cartTotal(receiptLines),
    });

    // Cash / non-Paystack POS: sale_completed only (no separate payment_received).
    if (trimmedClientId) {
      const productSummary = receiptLines
        .map((line) => `${line.productName} x${line.quantity}`)
        .join(", ");
      void fetch("/api/notification-rules/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_type: "sale_completed",
          customer_id: trimmedClientId,
          variables: {
            customer_name: getCustomerDisplayName(
              trimmedClientId,
              trimmedCustomerName,
              initialClients,
            ),
            invoice_no: summary.invoiceNo,
            amount: String(cartTotal(receiptLines)),
            product_summary: productSummary,
          },
        }),
      }).catch(() => {
        /* best-effort */
      });
    }

    if (summary.taxSyncWarning) {
      setError(
        `Sale recorded, but the VFRS tax ledger could not be updated: ${summary.taxSyncWarning}`,
      );
    }
  }

  async function completeMobileMoneySale(
    trimmedClientId: string | null,
    trimmedCustomerName: string | null,
  ) {
    setMomoWaiting(true);

    try {
      const initResponse = await fetch("/api/sales/paystack/momo/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sale_date: todayIsoDate(),
          client_id: trimmedClientId,
          customer_name: trimmedClientId ? null : trimmedCustomerName,
          notes: notes.trim() || null,
          due_date: dueDate,
          delivery_email: payerEmail.trim() || null,
          cart_lines: cartLines,
        }),
      });

      const initPayload = (await initResponse.json()) as MomoInitializeResponse;
      if (!initResponse.ok || !initPayload.ok) {
        if (initPayload.code === PAYMENT_SETTINGS_REQUIRED_CODE) {
          setPaymentSettingsRequired(true);
        }
        setError(initPayload.error ?? "Could not start Mobile Money payment.");
        setMomoWaiting(false);
        setLoading(false);
        return;
      }

      const accessCode = initPayload.access_code?.trim() ?? "";
      const paymentRequestId = initPayload.payment_request_id?.trim() ?? "";
      if (!accessCode || !paymentRequestId) {
        setError("Paystack did not return an access code for Mobile Money.");
        setMomoWaiting(false);
        setLoading(false);
        return;
      }

      const cartSnapshotForReceipt = [...cartLines];
      const customerLabel = getCustomerDisplayName(
        trimmedClientId,
        trimmedCustomerName,
        initialClients,
      );

      await openPaystackInlineWithAccessCode(accessCode, {
        onSuccess: async (transaction) => {
          try {
            const confirmResponse = await fetch(
              "/api/sales/paystack/momo/confirm",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  payment_request_id: paymentRequestId,
                  reference: transaction.reference ?? initPayload.reference,
                }),
              },
            );
            const confirmPayload =
              (await confirmResponse.json()) as MomoConfirmResponse;

            if (!confirmResponse.ok || !confirmPayload.ok) {
              setError(
                confirmPayload.error ??
                  "Payment succeeded but sale confirmation failed. Retry or check Product Sales.",
              );
              setMomoWaiting(false);
              setLoading(false);
              return;
            }

            if (!confirmPayload.invoice_no) {
              setError("Payment confirmed but no invoice number was returned.");
              setMomoWaiting(false);
              setLoading(false);
              return;
            }

            await refreshProducts();
            showPaidReceipt({
              invoiceNo: confirmPayload.invoice_no,
              customerLabel,
              paymentMethod: POS_MOMO_PAYMENT_METHOD,
              lines: cartSnapshotForReceipt,
              amountReceived: cartTotal(cartSnapshotForReceipt),
            });
          } catch (confirmError) {
            setError(
              confirmError instanceof Error
                ? confirmError.message
                : "Failed to confirm Mobile Money payment.",
            );
          } finally {
            setMomoWaiting(false);
            setLoading(false);
          }
        },
        onCancel: () => {
          setError(
            "Mobile Money payment was cancelled. Your cart is unchanged — you can retry.",
          );
          setMomoWaiting(false);
          setLoading(false);
        },
        onError: (paystackError) => {
          setError(
            paystackError.message?.trim() ||
              "Mobile Money payment failed. Your cart is unchanged — you can retry.",
          );
          setMomoWaiting(false);
          setLoading(false);
        },
      });
    } catch (momoError) {
      setError(
        momoError instanceof Error
          ? momoError.message
          : "Could not open Mobile Money payment.",
      );
      setMomoWaiting(false);
      setLoading(false);
    }
  }

  async function handleCompleteSale(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setPaymentSettingsRequired(false);
    setReceipt(null);

    const basics = validateCheckoutBasics();
    if (!basics) {
      setLoading(false);
      return;
    }

    try {
      if (isMobileMoney) {
        await completeMobileMoneySale(
          basics.trimmedClientId,
          basics.trimmedCustomerName,
        );
        // loading cleared in MoMo callbacks when popup closes
        return;
      }

      await completeCashSale(
        basics.trimmedClientId,
        basics.trimmedCustomerName,
      );
      setLoading(false);
    } catch (checkoutError) {
      setError(
        checkoutError instanceof Error
          ? checkoutError.message
          : "Checkout failed.",
      );
      setMomoWaiting(false);
      setLoading(false);
    }
  }

  /**
   * Charge-first Request Payment link: open modal with cart snapshot.
   * No sale / stock change until Paystack webhook (or confirm) fulfills.
   */
  function handleRequestPaymentLink() {
    setError(null);
    setPaymentSettingsRequired(false);
    setReceipt(null);

    const basics = validateCheckoutBasics();
    if (!basics) {
      return;
    }

    const amountGhs = cartTotal(cartLines);
    if (amountGhs <= 0) {
      setError("Cart total must be greater than zero.");
      return;
    }

    // Request Payment is independent of Cash/MoMo selection — store as POS
    // until Paystack reports the actual channel on fulfillment.
    setRequestPaymentDraft({
      cartLines: [...cartLines],
      saleDate: todayIsoDate(),
      clientId: basics.trimmedClientId,
      customerName: basics.trimmedClientId
        ? null
        : basics.trimmedCustomerName,
      notes: notes.trim() || null,
      dueDate,
      amountGhs,
      paymentMethod: "POS",
    });
    setShowRequestPayment(true);
  }

  function handleRequestPaymentLinkSent() {
    setCartLines([]);
    setCheckoutResult(null);
    setPendingInvoiceNo(null);
    setAccumulatedReceiptLines([]);
  }

  if (receipt) {
    return (
      <PosReceiptPanel
        receipt={receipt}
        onPrint={() => window.print()}
        onNewSale={resetCheckoutForm}
      />
    );
  }

  return (
    <div className="min-w-0 space-y-6">
      <div>
        {showTitle ? (
          <h1 className="text-2xl font-semibold text-[#0f2744]">POS</h1>
        ) : null}
        <p className={`text-sm text-slate-600 ${showTitle ? "mt-2" : ""}`}>
          Search products, build a cart, and complete a multi-line product sale
          with one shared invoice number.
        </p>
      </div>

      {error ? (
        <div className="space-y-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p>{error}</p>
          {paymentSettingsRequired ? (
            <p>
              <Link
                href="/dashboard/administration/billing?tab=payment"
                className="inline-block rounded-md bg-[#0f2744] px-3 py-1.5 font-medium text-white transition-colors hover:bg-[#1a3a5c]"
              >
                Set up Payment Settings
              </Link>{" "}
              <span className="text-red-600">
                (Administration → Billing Settings → Payment Settings)
              </span>
            </p>
          ) : null}
        </div>
      ) : null}

      {momoWaiting ? (
        <p className="rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          Waiting for Mobile Money confirmation in the Paystack window…
        </p>
      ) : null}

      {checkoutResult ? (
        <section className="space-y-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-medium">
            Partial checkout on invoice {checkoutResult.invoiceNo ?? "—"}.{" "}
            {checkoutResult.succeeded.length} line
            {checkoutResult.succeeded.length === 1 ? "" : "s"} posted; checkout
            stopped before the failed line.
          </p>

          {checkoutResult.succeeded.length > 0 ? (
            <div>
              <p className="font-medium text-emerald-900">Already posted</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-emerald-900">
                {checkoutResult.succeeded.map((line) => (
                  <li key={line.lineId}>
                    {line.productLabel} — qty {formatInventoryQuantity(line.quantity)}{" "}
                    @ {formatGHS(line.unitPrice)} ({formatGHS(line.lineTotal)})
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {checkoutResult.failed.length > 0 ? (
            <div>
              <p className="font-medium text-red-900">Failed line</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-red-900">
                {checkoutResult.failed.map((line) => (
                  <li key={line.lineId}>
                    {line.productLabel} — {line.errorMessage}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <p>
            Remove the posted lines from your cart (or start a new sale), then
            retry only the remaining items. Posted lines already reduced stock
            and cannot be undone from POS.
          </p>
        </section>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-[#0f2744]">
          Product Search
        </h2>
        <input
          type="search"
          value={productSearch}
          onChange={(event) => setProductSearch(event.target.value)}
          placeholder="Search by product name or code"
          className={inputClassName}
        />
        <div className="mt-4 max-h-64 space-y-2 overflow-y-auto">
          {filteredProducts.length === 0 ? (
            <p className="text-sm text-slate-500">No products match your search.</p>
          ) : (
            filteredProducts.map((product) => {
              const available = getAvailableStockForProduct(product, cartLines);
              const outOfStock = available <= 0;

              return (
                <div
                  key={product.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 px-4 py-3"
                >
                  <div>
                    <p className="font-medium text-[#0f2744]">
                      {product.product_code} — {product.product_name}
                    </p>
                    <p className="text-sm text-slate-600">
                      Stock:{" "}
                      <span
                        className={
                          outOfStock ? "font-medium text-red-700" : "font-medium"
                        }
                      >
                        {formatInventoryQuantity(available)} {product.unit_of_measure}
                      </span>
                      {" · "}
                      Price: {formatInventoryMoney(product.standard_selling_price)}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={outOfStock || busy}
                    onClick={() => addProductToCart(product)}
                    className="rounded-md bg-[#0f2744] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Add to Cart
                  </button>
                </div>
              );
            })
          )}
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-[#0f2744]">Cart</h2>
        {cartLines.length === 0 ? (
          <p className="text-sm text-slate-500">No items in cart yet.</p>
        ) : (
          <ScrollableTable>
            <table className={scrollableTableClassName}>
              <thead className={scrollableTableHeadClassName}>
                <tr>
                  <th className={scrollableTableThClassName}>Product</th>
                  <th className={scrollableTableThClassName}>Qty</th>
                  <th className={scrollableTableThClassName}>Unit Price</th>
                  <th className={scrollableTableThClassName}>Subtotal</th>
                  <th className={scrollableTableThClassName}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {cartLines.map((line, index) => (
                  <tr key={line.id} className={getStripedRowClassName(index)}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-[#0f2744]">
                        {line.productCode} — {line.productName}
                      </p>
                      <p className="text-xs text-slate-500">
                        Available:{" "}
                        {formatInventoryQuantity(
                          getAvailableStockForProduct(
                            products.find((item) => item.id === line.productId)!,
                            cartLines,
                            line.id,
                          ),
                        )}{" "}
                        {line.unitOfMeasure}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        min={0.0001}
                        step="0.0001"
                        value={line.quantity}
                        onChange={(event) =>
                          updateCartLine(line.id, "quantity", event.target.value)
                        }
                        className={`${inputClassName} min-w-[100px]`}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={line.unitPrice}
                        onChange={(event) =>
                          updateCartLine(line.id, "unitPrice", event.target.value)
                        }
                        className={`${inputClassName} min-w-[120px]`}
                      />
                    </td>
                    <td className="px-4 py-3 font-medium text-[#0f2744]">
                      {formatGHS(lineSubtotal(line))}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => removeCartLine(line.id)}
                        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollableTable>
        )}
        <p className="mt-4 text-sm text-slate-700">
          Cart total:{" "}
          <span className="text-lg font-semibold text-[#0f2744]">
            {formatGHS(total)}
          </span>
        </p>
      </section>

      <form
        onSubmit={handleCompleteSale}
        className="space-y-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      >
        <h2 className="text-lg font-semibold text-[#0f2744]">Checkout</h2>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Customer
            </label>
            <select
              value={clientId}
              onChange={(event) => {
                const nextClientId = event.target.value;
                setClientId(nextClientId);
                if (nextClientId) {
                  setCustomerName("");
                  const selected = initialClients.find(
                    (client) => client.client_id === nextClientId,
                  );
                  setPayerEmail(selected?.email?.trim() ?? "");
                  setPayerPhone(selected?.phone?.trim() ?? "");
                }
              }}
              className={inputClassName}
            >
              <option value="">Select customer</option>
              {initialClients.map((client) => (
                <option key={client.client_id} value={client.client_id}>
                  {client.client_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Walk-in / Other Payer Name
            </label>
            <input
              type="text"
              value={customerName}
              onChange={(event) => setCustomerName(event.target.value)}
              placeholder="Optional — for one-off payers not in the customer list"
              disabled={Boolean(clientId)}
              className={`${inputClassName}${clientId ? " bg-slate-50 text-slate-600" : ""}`}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Payer Email
            </label>
            <input
              type="email"
              value={payerEmail}
              onChange={(event) => setPayerEmail(event.target.value)}
              placeholder="Optional — for payment link / MoMo"
              className={inputClassName}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Payer Phone
            </label>
            <input
              type="tel"
              value={payerPhone}
              onChange={(event) => setPayerPhone(event.target.value)}
              placeholder="Optional — e.g. +233…"
              className={inputClassName}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Payment Method
            </label>
            <select
              required
              value={paymentMethod}
              onChange={(event) => setPaymentMethod(event.target.value)}
              className={inputClassName}
            >
              <option value="">Select payment method</option>
              {POS_CHECKOUT_PAYMENT_METHODS.map((method) => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Due Date
            </label>
            <input
              type="date"
              required
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              className={inputClassName}
            />
          </div>
          <div className="md:col-span-2 xl:col-span-3">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Notes
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className={inputClassName}
            />
          </div>
        </div>

        <p className="text-sm text-slate-600">
          {isMobileMoney
            ? "Mobile Money opens a Paystack popup. Sale and stock update only after payment is confirmed."
            : paymentMethod.trim()
              ? "Cash sales are recorded as fully paid for the cart total. Request Payment (link) charges first — no sale or stock change until the customer pays."
              : "Select a payment method to continue. Cash sales are recorded as fully paid; Request Payment (link) charges first — no sale or stock change until the customer pays."}
        </p>
        <p className="text-sm text-slate-600">
          Mobile Money payments are remitted through Paystack. Paystack charges
          apply, and remittance to your account may take up to 24 hours.
        </p>

        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={busy || cartLines.length === 0}
            className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {momoWaiting
              ? "Waiting for MoMo…"
              : loading
                ? isMobileMoney
                  ? "Opening payment…"
                  : "Completing sale…"
                : isMobileMoney
                  ? "Pay with Mobile Money"
                  : "Complete Sale"}
          </button>
          <button
            type="button"
            disabled={busy || cartLines.length === 0}
            onClick={() => handleRequestPaymentLink()}
            className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-900 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Request Payment (link)
          </button>
        </div>
      </form>

      {showRequestPayment && requestPaymentDraft ? (
        <RequestPaymentModal
          mode="cart"
          cartLines={requestPaymentDraft.cartLines}
          saleDate={requestPaymentDraft.saleDate}
          clientId={requestPaymentDraft.clientId}
          customerName={requestPaymentDraft.customerName}
          notes={requestPaymentDraft.notes}
          dueDate={requestPaymentDraft.dueDate}
          paymentMethod={requestPaymentDraft.paymentMethod}
          defaultAmountGhs={requestPaymentDraft.amountGhs}
          defaultEmail={payerEmail}
          defaultPhone={payerPhone}
          onLinkSent={handleRequestPaymentLinkSent}
          onClose={() => {
            setShowRequestPayment(false);
            setRequestPaymentDraft(null);
          }}
        />
      ) : null}
    </div>
  );
}
