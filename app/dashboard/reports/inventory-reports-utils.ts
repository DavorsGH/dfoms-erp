import type { RawMaterialRecord } from "../inventory/raw-materials-utils";
import type { FinishedProductRecord } from "../inventory/finished-products-utils";
import type { ProductionBatchRecord } from "../inventory/production-batches-utils";
import {
  buildAverageFinishedProductCostMap,
  type FinishedProductAverageCostRow,
} from "../inventory/inventory-balance-sheet-utils";
import {
  getInternalConsumptionClientName,
  getInternalConsumptionSiteName,
  type InternalConsumptionRecord,
} from "../inventory/internal-consumption-utils";
import {
  getIncomeCustomerDisplayName,
  type ProductSaleStatus,
} from "../finance/income-register-utils";

export type ProductSaleReportRecord = {
  id: string;
  date: string;
  invoice_no: string;
  client_id: string | null;
  customer_name: string | null;
  amount: number;
  sale_quantity: number | null;
  unit_price: number | null;
  product_id: string | null;
  cogs_expense_id: string | null;
  sale_status?: ProductSaleStatus | null;
  client?: {
    client_id: string;
    client_name: string;
  } | null;
  product?: {
    product_code: string;
    product_name: string;
    unit_of_measure: string;
  } | null;
  cogs?: {
    amount: number;
  } | { amount: number }[] | null;
};

export type StockOnHandRawMaterialRow = {
  id: string;
  materialName: string;
  unit: string;
  currentStock: number;
  averageCostPerUnit: number;
  totalStockValue: number;
  reorderLevel: number | null;
  isLowStock: boolean;
};

export type StockOnHandFinishedProductRow = {
  id: string;
  productName: string;
  unit: string;
  currentStock: number;
  averageCostPerUnit: number;
  totalStockValue: number;
  standardSellingPrice: number | null;
};

export type ProductionHistoryRow = {
  id: string;
  batchNumber: string;
  productionDate: string;
  productName: string;
  quantityProduced: number;
  unit: string;
  materialsConsumed: string;
  totalBatchCost: number;
  costPerUnit: number;
  finishedProductId: string;
};

export type ProductSaleBuyerType = "contract_client" | "retail";

export type ProductSaleBuyerTypeFilter = "all" | ProductSaleBuyerType;

export const PRODUCT_SALE_BUYER_TYPE_LABELS: Record<ProductSaleBuyerType, string> =
  {
    contract_client: "Contract Customer",
    retail: "Retail / Walk-in",
  };

export type ProductSalesReportTotals = {
  revenue: number;
  cogs: number;
  grossMargin: number;
  marginPercent: number;
};

export type ProductSalesReportRow = {
  id: string;
  date: string;
  buyerType: ProductSaleBuyerType;
  buyerTypeLabel: string;
  customerName: string;
  productName: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  revenue: number;
  cogs: number;
  grossMargin: number;
  marginPercent: number;
  clientId: string | null;
  productId: string | null;
};

export type InternalConsumptionReportRow = {
  id: string;
  consumptionDate: string;
  clientName: string;
  siteName: string;
  productName: string;
  quantity: number;
  unit: string;
  reason: string;
  recordedBy: string;
  productId: string;
  siteId: string | null;
  clientId: string | null;
};

export type InternalConsumptionProductTotal = {
  productId: string;
  productName: string;
  unit: string;
  totalQuantity: number;
};

export function isRawMaterialLowStock(material: {
  current_stock: number;
  reorder_level: number | null;
}): boolean {
  return (
    material.reorder_level != null &&
    Number(material.current_stock) <= Number(material.reorder_level)
  );
}

export function countLowStockRawMaterials(
  materials: Array<{ current_stock: number; reorder_level: number | null }>,
): number {
  return materials.filter((material) => isRawMaterialLowStock(material)).length;
}

export function buildStockOnHandReport(
  rawMaterials: RawMaterialRecord[],
  finishedProducts: FinishedProductRecord[],
  finishedProductAverageCosts: FinishedProductAverageCostRow[],
  options?: { lowStockOnly?: boolean },
): {
  rawMaterialRows: StockOnHandRawMaterialRow[];
  finishedProductRows: StockOnHandFinishedProductRow[];
  rawMaterialsTotalValue: number;
  finishedProductsTotalValue: number;
} {
  const averageCostByProductId = buildAverageFinishedProductCostMap(
    finishedProductAverageCosts,
  );

  const rawMaterialRows = rawMaterials
    .map((material) => {
      const currentStock = Number(material.current_stock) || 0;
      const averageCostPerUnit = Number(material.average_cost_per_unit) || 0;
      const reorderLevel =
        material.reorder_level == null ? null : Number(material.reorder_level);
      const isLowStock = isRawMaterialLowStock({
        current_stock: currentStock,
        reorder_level: reorderLevel,
      });

      return {
        id: material.id,
        materialName: material.material_name,
        unit: material.unit_of_measure,
        currentStock,
        averageCostPerUnit,
        totalStockValue: Math.round(currentStock * averageCostPerUnit * 100) / 100,
        reorderLevel,
        isLowStock,
      };
    })
    .filter((row) => !options?.lowStockOnly || row.isLowStock)
    .sort((left, right) => left.materialName.localeCompare(right.materialName));

  const finishedProductRows = finishedProducts
    .map((product) => {
      const currentStock = Number(product.current_stock) || 0;
      const averageCostPerUnit = averageCostByProductId.get(product.id) ?? 0;

      return {
        id: product.id,
        productName: product.product_name,
        unit: product.unit_of_measure,
        currentStock,
        averageCostPerUnit,
        totalStockValue: Math.round(currentStock * averageCostPerUnit * 100) / 100,
        standardSellingPrice:
          product.standard_selling_price == null
            ? null
            : Number(product.standard_selling_price),
      };
    })
    .sort((left, right) => left.productName.localeCompare(right.productName));

  return {
    rawMaterialRows,
    finishedProductRows,
    rawMaterialsTotalValue: rawMaterialRows.reduce(
      (sum, row) => sum + row.totalStockValue,
      0,
    ),
    finishedProductsTotalValue: finishedProductRows.reduce(
      (sum, row) => sum + row.totalStockValue,
      0,
    ),
  };
}

export function buildProductionHistoryReport(
  batches: ProductionBatchRecord[],
  startDate?: string | null,
  endDate?: string | null,
  productId?: string | null,
): ProductionHistoryRow[] {
  return batches
    .filter((batch) => {
      const date = batch.production_date.slice(0, 10);
      if (startDate && date < startDate) {
        return false;
      }
      if (endDate && date > endDate) {
        return false;
      }
      if (productId && batch.finished_product_id !== productId) {
        return false;
      }
      return true;
    })
    .map((batch) => {
      const materialsConsumed = (batch.materials ?? [])
        .map((line) => {
          const name =
            line.material?.material_name ?? line.material_id.slice(0, 8);
          const unit = line.material?.unit_of_measure ?? "";
          return `${name}: ${line.quantity_used} ${unit}`.trim();
        })
        .join("; ");

      return {
        id: batch.id,
        batchNumber: batch.batch_number,
        productionDate: batch.production_date,
        productName: batch.product?.product_name ?? "—",
        quantityProduced: Number(batch.quantity_produced) || 0,
        unit: batch.product?.unit_of_measure ?? "",
        materialsConsumed: materialsConsumed || "—",
        totalBatchCost: Number(batch.total_batch_cost) || 0,
        costPerUnit: Number(batch.cost_per_unit_produced) || 0,
        finishedProductId: batch.finished_product_id,
      };
    })
    .sort((left, right) => right.productionDate.localeCompare(left.productionDate));
}

function resolveCogsAmount(
  cogs: ProductSaleReportRecord["cogs"],
): number {
  if (!cogs) {
    return 0;
  }

  if (Array.isArray(cogs)) {
    return Number(cogs[0]?.amount) || 0;
  }

  return Number(cogs.amount) || 0;
}

export function resolveProductSaleBuyerType(sale: {
  client_id?: string | null;
  customer_name?: string | null;
}): ProductSaleBuyerType {
  if (sale.client_id?.trim()) {
    return "contract_client";
  }

  return "retail";
}

function buildProductSalesReportTotals(
  rows: ProductSalesReportRow[],
): ProductSalesReportTotals {
  const revenue = rows.reduce((sum, row) => sum + row.revenue, 0);
  const cogs = rows.reduce((sum, row) => sum + row.cogs, 0);
  const grossMargin = Math.round((revenue - cogs) * 100) / 100;
  const marginPercent =
    revenue === 0 ? 0 : Math.round((grossMargin / revenue) * 10000) / 100;

  return {
    revenue,
    cogs,
    grossMargin,
    marginPercent,
  };
}

export function buildProductSalesReport(
  sales: ProductSaleReportRecord[],
  startDate?: string | null,
  endDate?: string | null,
  clientId?: string | null,
  productId?: string | null,
  buyerTypeFilter: ProductSaleBuyerTypeFilter = "all",
): {
  rows: ProductSalesReportRow[];
  totals: ProductSalesReportTotals;
  splitTotals: Record<ProductSaleBuyerType, ProductSalesReportTotals>;
} {
  const rows = sales
    .filter((sale) => sale.sale_status !== "voided")
    .filter((sale) => {
      const date = sale.date.slice(0, 10);
      if (startDate && date < startDate) {
        return false;
      }
      if (endDate && date > endDate) {
        return false;
      }
      if (clientId && sale.client_id !== clientId) {
        return false;
      }
      if (productId && sale.product_id !== productId) {
        return false;
      }
      return true;
    })
    .map((sale) => {
      const revenue = Number(sale.amount) || 0;
      const cogs = resolveCogsAmount(sale.cogs);
      const grossMargin = Math.round((revenue - cogs) * 100) / 100;
      const marginPercent =
        revenue === 0 ? 0 : Math.round((grossMargin / revenue) * 10000) / 100;
      const buyerType = resolveProductSaleBuyerType(sale);

      return {
        id: sale.id,
        date: sale.date,
        buyerType,
        buyerTypeLabel: PRODUCT_SALE_BUYER_TYPE_LABELS[buyerType],
        customerName: getIncomeCustomerDisplayName(sale),
        productName: sale.product?.product_name ?? "—",
        quantity: Number(sale.sale_quantity) || 0,
        unit: sale.product?.unit_of_measure ?? "",
        unitPrice: Number(sale.unit_price) || 0,
        revenue,
        cogs,
        grossMargin,
        marginPercent,
        clientId: sale.client_id,
        productId: sale.product_id,
      };
    })
    .filter((row) => buyerTypeFilter === "all" || row.buyerType === buyerTypeFilter)
    .sort((left, right) => right.date.localeCompare(left.date));

  const contractClientRows = rows.filter(
    (row) => row.buyerType === "contract_client",
  );
  const retailRows = rows.filter((row) => row.buyerType === "retail");

  return {
    rows,
    totals: buildProductSalesReportTotals(rows),
    splitTotals: {
      contract_client: buildProductSalesReportTotals(contractClientRows),
      retail: buildProductSalesReportTotals(retailRows),
    },
  };
}

export function buildInternalConsumptionReport(
  entries: InternalConsumptionRecord[],
  startDate?: string | null,
  endDate?: string | null,
  productId?: string | null,
  clientId?: string | null,
  siteId?: string | null,
): {
  rows: InternalConsumptionReportRow[];
  productTotals: InternalConsumptionProductTotal[];
} {
  const filtered = entries.filter((entry) => {
    const date = entry.consumption_date.slice(0, 10);
    if (startDate && date < startDate) {
      return false;
    }
    if (endDate && date > endDate) {
      return false;
    }
    if (productId && entry.product_id !== productId) {
      return false;
    }
    if (clientId && entry.site?.client_id !== clientId) {
      return false;
    }
    if (siteId && entry.site_id !== siteId) {
      return false;
    }
    return true;
  });

  const rows = filtered
    .map((entry) => ({
      id: entry.id,
      consumptionDate: entry.consumption_date,
      clientName: getInternalConsumptionClientName(entry),
      siteName: getInternalConsumptionSiteName(entry),
      productName: entry.product?.product_name ?? "—",
      quantity: Number(entry.quantity) || 0,
      unit: entry.product?.unit_of_measure ?? "",
      reason: entry.reason?.trim() || "—",
      recordedBy: entry.recorded_by?.trim() || "—",
      productId: entry.product_id,
      siteId: entry.site_id,
      clientId: entry.site?.client_id ?? null,
    }))
    .sort((left, right) =>
      right.consumptionDate.localeCompare(left.consumptionDate),
    );

  const totalsByProduct = new Map<string, InternalConsumptionProductTotal>();

  for (const row of rows) {
    const existing = totalsByProduct.get(row.productId) ?? {
      productId: row.productId,
      productName: row.productName,
      unit: row.unit,
      totalQuantity: 0,
    };
    existing.totalQuantity += row.quantity;
    totalsByProduct.set(row.productId, existing);
  }

  const productTotals = Array.from(totalsByProduct.values()).sort((left, right) =>
    left.productName.localeCompare(right.productName),
  );

  return { rows, productTotals };
}

export function formatMarginPercent(value: number): string {
  return `${value.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}
