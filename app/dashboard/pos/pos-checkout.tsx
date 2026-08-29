"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/utils/supabase/client";
import PromoCodeField from "@/components/promo-code-field";
import FinishedProductPhoto from "@/components/finished-product-photo";
import SalesRepSelect from "@/components/sales-rep-select";
import { PAYMENT_SETTINGS_REQUIRED_CODE } from "@/utils/product-sale-paystack";
import { redeemLoyaltyPointsForCheckout } from "@/utils/promo-discount-utils";
import {
  LOYALTY_ACCOUNT_SELECT,
  earnLoyaltyPointsForSale,
  formatLoyaltyPoints,
  normalizeLoyaltyAccount,
  type LoyaltyAccountRow,
} from "@/utils/loyalty-types";
import { inputClassName } from "../employees/employee-record-utils";
import type { HrEmployee } from "../hr-payroll/employee-utils";
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
  POS_CUSTOMER_OTHER_VALUE,
  POS_MOMO_PAYMENT_METHOD,
  cartTotal,
  effectiveCartTotal,
  getAvailableStockForProduct,
  getCustomerDisplayName,
  lineSubtotal,
  resolvePosCustomerSelection,
  runPosCheckout,
  type PosCartLine,
  type PosCheckoutRunSummary,
} from "./pos-utils";
import { PosReceiptPanel, type PosReceiptData } from "./pos-receipt";
import RequestPaymentModal from "./request-payment-modal";
import {
  extractPaystackInlineReference,
  openPaystackInlineWithAccessCode,
} from "./paystack-inline";
import { recordQuoteSaleConversions } from "@/utils/sales-quotes-types";
import { requestTenantAdminDirectorNotification } from "@/utils/request-tenant-admin-director-notification";
import { useOfflineWriteBlocked } from "@/hooks/use-online-status";
import type { CustomerBalanceCacheRow } from "@/lib/client-cache/types";
import { resolveClientCacheSession } from "@/lib/client-cache/session-context";
import { getCachedStockLevels } from "@/lib/client-cache/stock-levels-cache";
import { stockCachePayloadToFinishedProducts } from "@/lib/client-cache/pos-cache-mappers";
import { useWriteQueueOptional } from "@/components/write-queue-provider";
import { enqueueWriteQueueItem } from "@/lib/offline-write-queue/store";
import {
  applyOptimisticStockDecrement,
  buildOfflineProvisionalToken,
} from "@/lib/offline-write-queue/pos-optimistic-stock";
import type { PosCashSaleQueuePayload } from "@/lib/offline-write-queue/types";

type PosCheckoutProps = {
  /** Hidden when the page renders inside the Sales & CRM shell, which already
   * shows a "POS" section title. */
  showTitle?: boolean;
  initialClients: ClientEntry[];
  initialProducts: FinishedProductRecord[];
  /** Loyalty + open AR snapshot (from IDB / SSR). */
  initialCustomerBalances?: CustomerBalanceCacheRow[];
  initialEmployees: HrEmployee[];
  defaultSalesRepId?: string;
  /** Kept for API compat; POS checkout uses Cash / Mobile Money only. */
  initialPaymentMethods: string[];
  /** Pre-load cart from an accepted product quote conversion. */
  initialCartLines?: PosCartLine[];
  initialClientId?: string;
  initialNotes?: string;
  quoteConversionId?: string;
  quoteNumber?: string;
  fetchError: string | null;
  /** Persist refreshed stock after an online sale (Phase 3 cache). */
  onStockLevelsChanged?: (
    products: FinishedProductRecord[],
  ) => void | Promise<void>;
  /** Parent re-reads IDB stock after an optimistic offline decrement. */
  onStockCacheChanged?: () => void | Promise<void>;
  /** Create-only stamp for product sales; null = All Businesses. */
  activeBusinessUnitId?: string | null;
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
  income_ids?: string[];
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
  initialCustomerBalances,
  initialEmployees,
  defaultSalesRepId = "",
  initialPaymentMethods,
  initialCartLines = [],
  initialClientId = "",
  initialNotes = "",
  quoteConversionId,
  quoteNumber,
  fetchError,
  onStockLevelsChanged,
  onStockCacheChanged,
  activeBusinessUnitId = null,
}: PosCheckoutProps) {
  const supabase = createClient();
  const { isOffline, offlineWriteMessage } = useOfflineWriteBlocked();
  const writeQueue = useWriteQueueOptional();
  const [products, setProducts] = useState(
    initialProducts.map(normalizeFinishedProduct),
  );
  const [cartLines, setCartLines] = useState<PosCartLine[]>(initialCartLines);
  const [productSearch, setProductSearch] = useState("");
  const [clientId, setClientId] = useState(initialClientId);
  const [customerName, setCustomerName] = useState("");
  const [salesRepId, setSalesRepId] = useState(defaultSalesRepId);
  const [paymentMethod, setPaymentMethod] = useState<string>("");
  const [dueDate, setDueDate] = useState(todayIsoDate());
  const [notes, setNotes] = useState(initialNotes);
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
  const [appliedPromoCode, setAppliedPromoCode] = useState<string | null>(null);
  const [promoDiscount, setPromoDiscount] = useState(0);
  const [loyaltyDiscount, setLoyaltyDiscount] = useState(0);
  const [loyaltyPointsRedeemed, setLoyaltyPointsRedeemed] = useState(0);
  const [loyaltyBalance, setLoyaltyBalance] = useState<number | null>(null);
  const [loyaltyRedeemInput, setLoyaltyRedeemInput] = useState("");
  const [loyaltyRedeemError, setLoyaltyRedeemError] = useState<string | null>(null);
  const [loyaltyRedeemLoading, setLoyaltyRedeemLoading] = useState(false);
  const [openArBalance, setOpenArBalance] = useState<number | null>(null);

  void initialPaymentMethods;

  useEffect(() => {
    setProducts(initialProducts.map(normalizeFinishedProduct));
  }, [initialProducts]);

  useEffect(() => {
    setError(fetchError);
  }, [fetchError]);

  async function recordQuoteConversionsForIncomeIds(incomeIds: string[]) {
    if (!quoteConversionId || incomeIds.length === 0) {
      return null;
    }

    try {
      await recordQuoteSaleConversions(supabase, quoteConversionId, incomeIds);
      return null;
    } catch (conversionError) {
      return conversionError instanceof Error
        ? conversionError.message
        : "Quote conversion recording failed.";
    }
  }

  async function recordQuoteConversionsFromSummary(
    summary: PosCheckoutRunSummary,
  ) {
    const incomeIds = summary.succeeded
      .map((line) => line.incomeId)
      .filter((id): id is string => Boolean(id));
    return recordQuoteConversionsForIncomeIds(incomeIds);
  }

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
  const payableTotal = useMemo(
    () => effectiveCartTotal(cartLines, promoDiscount, loyaltyDiscount),
    [cartLines, promoDiscount, loyaltyDiscount],
  );
  const isMobileMoney = paymentMethod === POS_MOMO_PAYMENT_METHOD;
  const busy = loading || momoWaiting;

  useEffect(() => {
    let cancelled = false;

    async function loadCustomerBalances() {
      if (!clientId) {
        setLoyaltyBalance(null);
        setOpenArBalance(null);
        return;
      }

      const cached = (initialCustomerBalances ?? []).find(
        (row) => row.client_id === clientId,
      );
      if (isOffline) {
        if (cached) {
          setLoyaltyBalance(cached.loyalty_points);
          setOpenArBalance(cached.open_ar);
        } else {
          setLoyaltyBalance(0);
          setOpenArBalance(0);
        }
        return;
      }

      if (cached) {
        setLoyaltyBalance(cached.loyalty_points);
        setOpenArBalance(cached.open_ar);
      }

      const { data, error: loyaltyError } = await supabase
        .from("loyalty_accounts")
        .select(LOYALTY_ACCOUNT_SELECT)
        .eq("client_id", clientId)
        .maybeSingle();

      if (cancelled) {
        return;
      }

      if (loyaltyError) {
        if (!cached) {
          setLoyaltyBalance(null);
        }
        return;
      }

      setLoyaltyBalance(
        data
          ? normalizeLoyaltyAccount(data as LoyaltyAccountRow).points_balance
          : 0,
      );
      if (cached) {
        setOpenArBalance(cached.open_ar);
      }
    }

    void loadCustomerBalances();

    return () => {
      cancelled = true;
    };
  }, [clientId, isOffline, initialCustomerBalances]);

  function clearCheckoutAdjustments() {
    setAppliedPromoCode(null);
    setPromoDiscount(0);
    setLoyaltyDiscount(0);
    setLoyaltyPointsRedeemed(0);
    setLoyaltyRedeemInput("");
    setLoyaltyRedeemError(null);
  }

  async function refreshProducts() {
    const { data, error: productError } = await supabase
      .from("finished_products")
      .select(FINISHED_PRODUCT_SELECT)
      .eq("is_archived", false)
      .order("product_name", { ascending: true });

    if (productError) {
      setError(productError.message);
      return;
    }

    const next = ((data as FinishedProductRecord[] | null) ?? []).map((row) =>
      normalizeFinishedProduct(row),
    );
    setProducts(next);
    await onStockLevelsChanged?.(next);
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
    clearCheckoutAdjustments();

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
    clearCheckoutAdjustments();

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
    clearCheckoutAdjustments();
    setCartLines((current) => current.filter((line) => line.id !== lineId));
  }

  async function handleRedeemLoyaltyPoints() {
    if (isOffline) {
      setLoyaltyRedeemError(offlineWriteMessage);
      return;
    }
    if (!clientId) {
      setLoyaltyRedeemError("Select a customer to redeem points.");
      return;
    }

    const points = Number.parseFloat(loyaltyRedeemInput);
    if (!Number.isFinite(points) || points <= 0) {
      setLoyaltyRedeemError("Enter a valid points amount.");
      return;
    }

    setLoyaltyRedeemLoading(true);
    setLoyaltyRedeemError(null);

    const result = await redeemLoyaltyPointsForCheckout(supabase, {
      clientId,
      points,
      sourceType: "product_sale",
    });

    if (!result.ok) {
      setLoyaltyRedeemError(result.error);
      setLoyaltyRedeemLoading(false);
      return;
    }

    setLoyaltyPointsRedeemed(points);
    setLoyaltyDiscount(result.discountAmount);
    setAppliedPromoCode(null);
    setPromoDiscount(0);
    setLoyaltyBalance((current) =>
      current == null ? current : Math.max(0, current - points),
    );
    setLoyaltyRedeemLoading(false);
  }

  function clearLoyaltyRedemption() {
    setLoyaltyDiscount(0);
    setLoyaltyPointsRedeemed(0);
    setLoyaltyRedeemInput("");
    setLoyaltyRedeemError(null);
  }

  async function recordLoyaltyEarnAfterSale(
    trimmedClientId: string | null,
    amountPaid: number,
    sourceReference: string,
  ) {
    if (!trimmedClientId || amountPaid <= 0) {
      return null;
    }

    return earnLoyaltyPointsForSale(supabase, {
      clientId: trimmedClientId,
      amountSpent: amountPaid,
      sourceType: "product_sale",
      sourceReference,
    });
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
    clearCheckoutAdjustments();
  }

  function validateCheckoutBasics(): {
    trimmedClientId: string | null;
    trimmedCustomerName: string | null;
  } | null {
    const { clientId: trimmedClientId, customerName: trimmedCustomerName } =
      resolvePosCustomerSelection(clientId, customerName);

    // Customer / walk-in payer are optional — anonymous cash sales are allowed.

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
    pendingSync?: boolean;
  }) {
    const receiptTotal = cartTotal(input.lines);
    setReceipt({
      invoiceNo: input.invoiceNo,
      saleDate: todayIsoDate(),
      customerLabel: input.customerLabel,
      paymentMethod: input.paymentMethod,
      paymentStatus: input.pendingSync ? "Pending sync" : "Paid",
      amountReceived: input.amountReceived,
      cartTotal: receiptTotal,
      lines: input.lines,
      pendingSync: input.pendingSync,
    });
    setCheckoutResult(null);
    setPendingInvoiceNo(null);
    setAccumulatedReceiptLines([]);
    setCartLines([]);
    setShowRequestPayment(false);
    setRequestPaymentDraft(null);
  }

  async function queueOfflineCashSale(
    trimmedClientId: string | null,
    trimmedCustomerName: string | null,
  ) {
    if (isMobileMoney) {
      setError(
        "Mobile Money cannot be queued offline. Use Cash, or reconnect to pay with MoMo.",
      );
      return;
    }

    if (promoDiscount > 0 || loyaltyDiscount > 0 || loyaltyPointsRedeemed > 0) {
      setError("Promo/loyalty redeem cannot be used offline");
      return;
    }

    const session =
      writeQueue?.session ?? (await resolveClientCacheSession());
    if (!session) {
      setError("Unable to queue offline — session not available.");
      return;
    }

    const provisionalToken = buildOfflineProvisionalToken();
    const amountReceived = payableTotal;
    const receiptLines = [...cartLines];
    const queuePayload: PosCashSaleQueuePayload = {
      saleDate: todayIsoDate(),
      clientId: trimmedClientId,
      customerName: trimmedClientId ? null : trimmedCustomerName,
      salesRepId: salesRepId.trim() || null,
      paymentMethod: "Cash",
      amountReceived,
      notes: notes.trim() || null,
      provisionalToken,
      business_unit_id: activeBusinessUnitId,
      lines: receiptLines.map((line) => ({
        productId: line.productId,
        productCode: line.productCode,
        productName: line.productName,
        unitOfMeasure: line.unitOfMeasure,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
      })),
    };

    await enqueueWriteQueueItem({
      session,
      type: "pos_cash_sale",
      payload: queuePayload,
    });

    await applyOptimisticStockDecrement(
      session,
      queuePayload.lines.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
      })),
    );

    const cached = await getCachedStockLevels(session);
    if (cached) {
      const nextProducts = stockCachePayloadToFinishedProducts(
        cached.payload,
      ).map(normalizeFinishedProduct);
      setProducts(nextProducts);
    }

    await onStockCacheChanged?.();
    await writeQueue?.refresh();

    showPaidReceipt({
      invoiceNo: provisionalToken,
      customerLabel: getCustomerDisplayName(
        trimmedClientId,
        trimmedCustomerName,
        initialClients,
      ),
      paymentMethod: "Cash",
      lines: receiptLines,
      amountReceived,
      pendingSync: true,
    });

    clearCheckoutAdjustments();
  }

  async function completeCashSale(
    trimmedClientId: string | null,
    trimmedCustomerName: string | null,
  ) {
    const amountReceived = payableTotal;
    const summary = await runPosCheckout(supabase, {
      saleDate: todayIsoDate(),
      invoiceNo: pendingInvoiceNo,
      clientId: trimmedClientId,
      customerName: trimmedClientId ? null : trimmedCustomerName,
      salesRepId: salesRepId.trim() || null,
      paymentMethod: paymentMethod.trim(),
      amountReceived,
      paymentStatus: "Paid",
      dueDate,
      notes: notes.trim() || null,
      cartLines,
      businessUnitId: activeBusinessUnitId,
    });

    await refreshProducts();

    const conversionWarning = await recordQuoteConversionsFromSummary(summary);

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
        conversionWarning ??
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
      amountReceived,
    });

    const loyaltyEarnWarning = await recordLoyaltyEarnAfterSale(
      trimmedClientId,
      amountReceived,
      summary.invoiceNo,
    );

    requestTenantAdminDirectorNotification({
      title: "Large product sale recorded",
      detail: formatGHS(amountReceived),
      thresholdAmount: amountReceived,
      actionUrl: "/dashboard/pos",
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
            amount: String(amountReceived),
            product_summary: productSummary,
          },
        }),
      }).catch(() => {
        /* best-effort */
      });
    }

    if (loyaltyEarnWarning) {
      setError(
        `Sale recorded, but loyalty points could not be earned: ${loyaltyEarnWarning}`,
      );
    } else if (summary.taxSyncWarning) {
      setError(
        `Sale recorded, but the VFRS tax ledger could not be updated: ${summary.taxSyncWarning}`,
      );
    } else if (conversionWarning) {
      setError(
        `Sale recorded, but quote conversion failed: ${conversionWarning}`,
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
          sales_rep_id: salesRepId.trim() || null,
          notes: notes.trim() || null,
          due_date: dueDate,
          delivery_email: payerEmail.trim() || null,
          cart_lines: cartLines,
          checkout_amount_ghs: payableTotal,
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
                  reference: extractPaystackInlineReference(
                    transaction,
                    initPayload.reference,
                  ),
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

            const conversionWarning = await recordQuoteConversionsForIncomeIds(
              confirmPayload.income_ids ?? [],
            );

            showPaidReceipt({
              invoiceNo: confirmPayload.invoice_no,
              customerLabel,
              paymentMethod: POS_MOMO_PAYMENT_METHOD,
              lines: cartSnapshotForReceipt,
              amountReceived: payableTotal,
            });

            const loyaltyEarnWarning = await recordLoyaltyEarnAfterSale(
              trimmedClientId,
              payableTotal,
              confirmPayload.invoice_no,
            );

            if (conversionWarning) {
              setError(
                `Sale recorded, but quote conversion failed: ${conversionWarning}`,
              );
            } else if (loyaltyEarnWarning) {
              setError(
                `Sale recorded, but loyalty points could not be earned: ${loyaltyEarnWarning}`,
              );
            }
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

    const offlineNow = isOffline || !navigator.onLine;
    if (offlineNow) {
      if (isMobileMoney) {
        setError(
          "Mobile Money cannot be queued offline. Use Cash, or reconnect to pay with MoMo.",
        );
        setLoading(false);
        return;
      }

      try {
        await queueOfflineCashSale(
          basics.trimmedClientId,
          basics.trimmedCustomerName,
        );
      } catch (queueError) {
        setError(
          queueError instanceof Error
            ? queueError.message
            : "Could not queue offline cash sale.",
        );
      } finally {
        setLoading(false);
      }
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
    if (isOffline) {
      setError(offlineWriteMessage);
      return;
    }
    setError(null);
    setPaymentSettingsRequired(false);
    setReceipt(null);

    const basics = validateCheckoutBasics();
    if (!basics) {
      return;
    }

    const amountGhs = payableTotal;
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
        {quoteConversionId && quoteNumber ? (
          <p className="mt-2 rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
            Converting accepted product quote {quoteNumber}. Cart and customer
            are pre-filled — review and complete checkout normally.
          </p>
        ) : null}
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
                  <div className="flex min-w-0 items-center gap-3">
                    <FinishedProductPhoto
                      photoUrl={product.photo_url}
                      productName={product.product_name}
                      size="md"
                    />
                    <div className="min-w-0">
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
                        {isOffline ? (
                          <span className="ml-1 text-xs text-amber-800">(cached)</span>
                        ) : null}
                        {" · "}
                        Price: {formatInventoryMoney(product.standard_selling_price)}
                      </p>
                    </div>
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
                        Max qty for this line:{" "}
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
          Cart subtotal:{" "}
          <span className="font-semibold text-[#0f2744]">{formatGHS(total)}</span>
        </p>
        {promoDiscount > 0 ? (
          <p className="mt-1 text-sm text-emerald-800">
            Promo discount ({appliedPromoCode}): -{formatGHS(promoDiscount)}
          </p>
        ) : null}
        {loyaltyDiscount > 0 ? (
          <p className="mt-1 text-sm text-emerald-800">
            Loyalty redemption ({formatLoyaltyPoints(loyaltyPointsRedeemed)} pts): -
            {formatGHS(loyaltyDiscount)}
          </p>
        ) : null}
        <p className="mt-2 text-sm text-slate-700">
          Amount due:{" "}
          <span className="text-lg font-semibold text-[#0f2744]">
            {formatGHS(payableTotal)}
          </span>
        </p>
      </section>

      <form
        onSubmit={handleCompleteSale}
        className="space-y-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      >
        <h2 className="text-lg font-semibold text-[#0f2744]">Checkout</h2>

        <PromoCodeField
          supabase={supabase}
          clientId={clientId || null}
          orderAmount={total}
          sourceType="product_sale"
          appliedCode={appliedPromoCode}
          appliedDiscount={promoDiscount}
          onApplied={(code, discountAmount) => {
            setAppliedPromoCode(code);
            setPromoDiscount(discountAmount);
            clearLoyaltyRedemption();
          }}
          onClear={() => {
            setAppliedPromoCode(null);
            setPromoDiscount(0);
          }}
          disabled={busy || cartLines.length === 0 || isOffline}
        />

        {clientId ? (
          <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-medium text-[#0f2744]">Customer balances</p>
            <p className="text-sm text-slate-600">
              Loyalty points:{" "}
              {loyaltyBalance == null
                ? "Loading…"
                : `${formatLoyaltyPoints(loyaltyBalance)} pts`}
            </p>
            <p className="text-sm text-slate-600">
              Open AR:{" "}
              {openArBalance == null ? "Loading…" : formatGHS(openArBalance)}
              {isOffline ? (
                <span className="ml-1 text-xs text-amber-800">(cached)</span>
              ) : null}
            </p>
            <p className="text-sm font-medium text-[#0f2744]">Redeem Points</p>
            <p className="text-sm text-slate-600">
              Available balance:{" "}
              {loyaltyBalance == null
                ? "Loading…"
                : `${formatLoyaltyPoints(loyaltyBalance)} pts`}
              {isOffline ? (
                <span className="ml-1 text-xs text-amber-800">(cached)</span>
              ) : null}
            </p>
            {loyaltyDiscount > 0 ? (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm text-emerald-800">
                  Redeemed {formatLoyaltyPoints(loyaltyPointsRedeemed)} pts for{" "}
                  {formatGHS(loyaltyDiscount)} off
                </p>
                <button
                  type="button"
                  onClick={clearLoyaltyRedemption}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  Remove
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <input
                  type="number"
                  min={1}
                  step="1"
                  value={loyaltyRedeemInput}
                  onChange={(event) => setLoyaltyRedeemInput(event.target.value)}
                  placeholder="Points to redeem"
                  disabled={busy || loyaltyRedeemLoading || isOffline}
                  className={`${inputClassName} min-w-[180px] flex-1`}
                />
                <button
                  type="button"
                  onClick={() => void handleRedeemLoyaltyPoints()}
                  disabled={
                    busy ||
                    loyaltyRedeemLoading ||
                    !loyaltyRedeemInput.trim() ||
                    isOffline
                  }
                  className="rounded-md border border-[#0f2744] px-3 py-1.5 text-sm font-medium text-[#0f2744] hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loyaltyRedeemLoading ? "Redeeming…" : "Redeem"}
                </button>
              </div>
            )}
            {loyaltyRedeemError ? (
              <p className="text-sm text-red-700">{loyaltyRedeemError}</p>
            ) : null}
          </div>
        ) : null}

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
                clearCheckoutAdjustments();
                if (nextClientId === POS_CUSTOMER_OTHER_VALUE) {
                  setPayerEmail("");
                  setPayerPhone("");
                  return;
                }
                if (nextClientId) {
                  setCustomerName("");
                  const selected = initialClients.find(
                    (client) => client.client_id === nextClientId,
                  );
                  setPayerEmail(selected?.email?.trim() ?? "");
                  setPayerPhone(selected?.phone?.trim() ?? "");
                  return;
                }
                setCustomerName("");
                setPayerEmail("");
                setPayerPhone("");
              }}
              className={inputClassName}
            >
              <option value="">Select customer (optional)</option>
              {initialClients.map((client) => (
                <option key={client.client_id} value={client.client_id}>
                  {client.client_name}
                </option>
              ))}
              <option value={POS_CUSTOMER_OTHER_VALUE}>Other / Walk-in</option>
            </select>
          </div>
          {clientId === POS_CUSTOMER_OTHER_VALUE ? (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Walk-in / Other Payer Name
              </label>
              <input
                type="text"
                value={customerName}
                onChange={(event) => setCustomerName(event.target.value)}
                placeholder="Optional — one-off payer name"
                className={inputClassName}
              />
            </div>
          ) : null}
          <SalesRepSelect
            employees={initialEmployees}
            value={salesRepId}
            onChange={setSalesRepId}
            className={inputClassName}
            hint="Defaults to your employee record when linked."
          />
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

        {isOffline ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            You are offline. Cash sales can be queued and will sync when you
            reconnect. Mobile Money and Request Payment stay blocked. Stock
            levels and customer balances shown are from a cached snapshot.
          </p>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={busy || cartLines.length === 0 || (isOffline && isMobileMoney)}
            className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {momoWaiting
              ? "Waiting for MoMo…"
              : loading
                ? isOffline
                  ? "Queuing sale…"
                  : isMobileMoney
                    ? "Opening payment…"
                    : "Completing sale…"
                : isMobileMoney
                  ? "Pay with Mobile Money"
                  : isOffline
                    ? "Queue Cash Sale"
                    : "Complete Sale"}
          </button>
          <button
            type="button"
            disabled={busy || cartLines.length === 0 || isOffline}
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
