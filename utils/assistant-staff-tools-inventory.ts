import "server-only";

import {
  fetchFinishedProductLotDateSources,
  FINISHED_PRODUCT_SELECT,
  getFinishedProductExpirationStatus,
  mergeFinishedProductsWithLotDates,
  normalizeFinishedProduct,
} from "@/app/dashboard/inventory/finished-products-utils";
import {
  fetchProductionHistoryReportData,
} from "@/app/dashboard/reports/inventory-report-data";
import {
  PURCHASE_ORDER_LIST_SELECT,
  normalizePurchaseOrderListRow,
} from "@/utils/purchase-orders-types";
import { canAccessInventorySection } from "@/utils/rbac-access";
import {
  LIST_LIMIT,
  STAFF_DATA_UNAVAILABLE_MESSAGE,
  getStaffSupabase,
  requireStaffSession,
} from "@/utils/assistant-staff-tool-common";

export async function getFinishedProductsSummary(): Promise<unknown> {
  const sessionResult = await requireStaffSession();
  if ("error" in sessionResult) {
    return sessionResult;
  }
  if (!canAccessInventorySection(sessionResult.session.role)) {
    return { error: "You do not have access to inventory data." };
  }

  try {
    const supabase = await getStaffSupabase();
    const [{ data: products, error: productsError }, lotSources] =
      await Promise.all([
        supabase
          .from("finished_products")
          .select(FINISHED_PRODUCT_SELECT)
          .eq("is_archived", false)
          .order("product_name", { ascending: true }),
        fetchFinishedProductLotDateSources(supabase),
      ]);

    if (productsError) {
      console.error(
        "[assistant] get_finished_products_summary failed:",
        productsError.message,
      );
      return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
    }

    const merged = mergeFinishedProductsWithLotDates(
      (products ?? []).map(normalizeFinishedProduct),
      lotSources.lots,
    );

    let lowStockCount = 0;
    let outOfStockCount = 0;
    let expiredCount = 0;
    let nearingExpirationCount = 0;

    for (const product of merged) {
      const stock = Number(product.current_stock) || 0;
      if (stock <= 0) {
        outOfStockCount += 1;
      } else if (stock <= 5) {
        lowStockCount += 1;
      }

      const expirationStatus = getFinishedProductExpirationStatus(
        product.expiration_date,
      );
      if (expirationStatus === "expired") {
        expiredCount += 1;
      } else if (expirationStatus === "nearing_expiration") {
        nearingExpirationCount += 1;
      }
    }

    return {
      productCount: merged.length,
      lowStockCount,
      outOfStockCount,
      expiredLotAlerts: expiredCount,
      nearingExpirationAlerts: nearingExpirationCount,
      products: merged.slice(0, LIST_LIMIT).map((row) => ({
        productCode: row.product_code,
        productName: row.product_name,
        currentStock: row.current_stock,
        expirationDate: row.expiration_date,
        expirationStatus: getFinishedProductExpirationStatus(row.expiration_date),
      })),
    };
  } catch (error) {
    console.error("[assistant] get_finished_products_summary threw:", error);
    return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
  }
}

export async function getProductionSummary(): Promise<unknown> {
  const sessionResult = await requireStaffSession();
  if ("error" in sessionResult) {
    return sessionResult;
  }
  if (!canAccessInventorySection(sessionResult.session.role)) {
    return { error: "You do not have access to production data." };
  }

  try {
    const supabase = await getStaffSupabase();
    const data = await fetchProductionHistoryReportData(supabase);
    const batches = (data.initialBatches ?? []).slice(0, LIST_LIMIT);

    return {
      recentBatchCount: batches.length,
      batches: batches.map((row) => {
        const product = Array.isArray(row.product) ? row.product[0] : row.product;
        return {
          batchNumber: row.batch_number,
          productName: product?.product_name ?? "Product",
          quantityProduced: row.quantity_produced,
          productionDate: row.production_date,
        };
      }),
      fetchWarning: data.fetchError,
    };
  } catch (error) {
    console.error("[assistant] get_production_summary threw:", error);
    return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
  }
}

export async function getPurchasingSummary(): Promise<unknown> {
  const sessionResult = await requireStaffSession();
  if ("error" in sessionResult) {
    return sessionResult;
  }
  if (!canAccessInventorySection(sessionResult.session.role)) {
    return { error: "You do not have access to purchasing data." };
  }

  try {
    const supabase = await getStaffSupabase();
    const startIso = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const [{ data: purchaseOrders, error: poError }, { data: purchases, error: purchasesError }] =
      await Promise.all([
        supabase
          .from("purchase_orders")
          .select(PURCHASE_ORDER_LIST_SELECT)
          .order("order_date", { ascending: false })
          .limit(LIST_LIMIT),
        supabase
          .from("product_purchases")
          .select("purchase_date, product_id, quantity, total_cost")
          .gte("purchase_date", startIso)
          .order("purchase_date", { ascending: false })
          .limit(LIST_LIMIT),
      ]);

    if (poError || purchasesError) {
      console.error(
        "[assistant] get_purchasing_summary failed:",
        poError?.message ?? purchasesError?.message,
      );
      return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
    }

    const orders = (purchaseOrders ?? []).map((row) =>
      normalizePurchaseOrderListRow(row),
    );
    const openOrders = orders.filter(
      (row) => row.status === "draft" || row.status === "sent",
    );

    return {
      openPurchaseOrderCount: openOrders.length,
      recentPurchaseCount: (purchases ?? []).length,
      openPurchaseOrders: openOrders.slice(0, LIST_LIMIT).map((row) => {
        const supplier = Array.isArray(row.supplier)
          ? row.supplier[0]
          : row.supplier;
        return {
          poNumber: row.po_number,
          supplierName: supplier?.name ?? "Supplier",
          status: row.status,
          orderDate: row.order_date,
          expectedDate: row.expected_date,
        };
      }),
      recentPurchases: (purchases ?? []).slice(0, LIST_LIMIT).map((row) => ({
        purchaseDate: row.purchase_date,
        quantity: Number(row.quantity) || 0,
        totalCostGhs: Number(row.total_cost) || 0,
      })),
    };
  } catch (error) {
    console.error("[assistant] get_purchasing_summary threw:", error);
    return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
  }
}