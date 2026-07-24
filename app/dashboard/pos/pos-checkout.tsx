"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
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
import {
  calculateOutstanding,
  formatGHS,
} from "../finance/income-register-utils";
import { getStripedRowClassName } from "../finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import {
  POS_PAYMENT_STATUS_OPTIONS,
  cartTotal,
  getAvailableStockForProduct,
  getCustomerDisplayName,
  lineSubtotal,
  runPosCheckout,
  type PosCartLine,
  type PosCheckoutRunSummary,
} from "./pos-utils";
import { PosReceiptPanel, type PosReceiptData } from "./pos-receipt";

type PosCheckoutProps = {
  /** Hidden when the page renders inside the Sales & CRM shell, which already
   * shows a "POS" section title. */
  showTitle?: boolean;
  initialClients: ClientEntry[];
  initialProducts: FinishedProductRecord[];
  initialPaymentMethods: string[];
  fetchError: string | null;
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
  const [paymentMethod, setPaymentMethod] = useState(
    initialPaymentMethods[0] ?? "",
  );
  const [amountReceived, setAmountReceived] = useState("");
  const [paymentStatus, setPaymentStatus] = useState<string>(
    POS_PAYMENT_STATUS_OPTIONS[2],
  );
  const [dueDate, setDueDate] = useState(todayIsoDate());
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);
  const [checkoutResult, setCheckoutResult] =
    useState<PosCheckoutRunSummary | null>(null);
  const [pendingInvoiceNo, setPendingInvoiceNo] = useState<string | null>(null);
  const [accumulatedReceiptLines, setAccumulatedReceiptLines] = useState<
    PosCartLine[]
  >([]);
  const [receipt, setReceipt] = useState<PosReceiptData | null>(null);

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
  const receivedAmount = Number.parseFloat(amountReceived) || 0;
  const outstandingPreview = calculateOutstanding(total, receivedAmount);

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
    setAmountReceived("");
    setPaymentStatus(POS_PAYMENT_STATUS_OPTIONS[2]);
    setDueDate(todayIsoDate());
    setNotes("");
    setProductSearch("");
    setCheckoutResult(null);
    setPendingInvoiceNo(null);
    setAccumulatedReceiptLines([]);
    setReceipt(null);
    setError(null);
  }

  async function handleCompleteSale(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setReceipt(null);

    const trimmedClientId = clientId.trim() || null;
    const trimmedCustomerName = customerName.trim() || null;

    if (!trimmedClientId && !trimmedCustomerName) {
      setError("Select a contract client or enter a walk-in / other payer name.");
      setLoading(false);
      return;
    }

    if (cartLines.length === 0) {
      setError("Add at least one product to the cart.");
      setLoading(false);
      return;
    }

    if (!paymentMethod.trim()) {
      setError("Select a payment method.");
      setLoading(false);
      return;
    }

    if (Number.isNaN(receivedAmount) || receivedAmount < 0) {
      setError("Amount received must be zero or greater.");
      setLoading(false);
      return;
    }

    if (!paymentStatus) {
      setError("Select a payment status.");
      setLoading(false);
      return;
    }

    for (const line of cartLines) {
      if (line.quantity <= 0) {
        setError("Each cart line must have a quantity greater than zero.");
        setLoading(false);
        return;
      }

      if (line.unitPrice < 0) {
        setError("Unit prices must be zero or greater.");
        setLoading(false);
        return;
      }

      const product = products.find((item) => item.id === line.productId);
      if (!product) {
        setError("A product in the cart is no longer available.");
        setLoading(false);
        return;
      }

      const available = getAvailableStockForProduct(product, cartLines, line.id);
      if (line.quantity > available) {
        setError(
          `Only ${formatInventoryQuantity(available)} ${product.unit_of_measure} of ${product.product_name} available.`,
        );
        setLoading(false);
        return;
      }
    }

    try {
      const summary = await runPosCheckout(supabase, {
        saleDate: todayIsoDate(),
        invoiceNo: pendingInvoiceNo,
        clientId: trimmedClientId,
        customerName: trimmedClientId ? null : trimmedCustomerName,
        paymentMethod: paymentMethod.trim(),
        amountReceived: receivedAmount,
        paymentStatus,
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
        setLoading(false);
        return;
      }

      if (!summary.invoiceNo) {
        setError("Checkout completed but no invoice number was returned from the server.");
        setLoading(false);
        return;
      }

      const receiptLines = [...accumulatedReceiptLines, ...cartLines];

      setReceipt({
        invoiceNo: summary.invoiceNo,
        saleDate: todayIsoDate(),
        customerLabel: getCustomerDisplayName(
          trimmedClientId,
          trimmedCustomerName,
          initialClients,
        ),
        paymentMethod: paymentMethod.trim(),
        paymentStatus,
        amountReceived: receivedAmount,
        cartTotal: cartTotal(receiptLines),
        lines: receiptLines,
      });
      setCheckoutResult(null);
      setPendingInvoiceNo(null);
      setAccumulatedReceiptLines([]);
      setCartLines([]);
      setLoading(false);
    } catch (checkoutError) {
      setError(
        checkoutError instanceof Error
          ? checkoutError.message
          : "Checkout failed.",
      );
      setLoading(false);
    }
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
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
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
                    disabled={outOfStock || loading}
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
              Contract Customer
            </label>
            <select
              value={clientId}
              onChange={(event) => {
                setClientId(event.target.value);
                if (event.target.value) {
                  setCustomerName("");
                }
              }}
              className={inputClassName}
            >
              <option value="">Select contract client</option>
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
              placeholder="Optional — for one-off payers not in clients list"
              disabled={Boolean(clientId)}
              className={`${inputClassName}${clientId ? " bg-slate-50 text-slate-600" : ""}`}
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
              {initialPaymentMethods.map((method) => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Amount Received
            </label>
            <input
              type="number"
              min={0}
              step="0.01"
              required
              value={amountReceived}
              onChange={(event) => setAmountReceived(event.target.value)}
              className={inputClassName}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Payment Status
            </label>
            <select
              required
              value={paymentStatus}
              onChange={(event) => setPaymentStatus(event.target.value)}
              className={inputClassName}
            >
              {POS_PAYMENT_STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {status}
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
          Outstanding balance:{" "}
          <span className="font-medium text-[#0f2744]">
            {formatGHS(outstandingPreview)}
          </span>
        </p>

        <button
          type="submit"
          disabled={loading || cartLines.length === 0}
          className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Completing sale…" : "Complete Sale"}
        </button>
      </form>
    </div>
  );
}
