import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getCurrentUserRole,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import {
  applyBusinessUnitScope,
  resolveBusinessUnitReadScope,
} from "@/utils/business-unit-view";
import type { AppRole } from "@/app/dashboard/user-account-types";
import {
  canEditInventory,
  isFinanceSuppliersOnlyRole,
} from "@/utils/rbac-access";
import {
  normalizeSupplier,
  SUPPLIER_SELECT,
  type SupplierRow,
} from "@/utils/suppliers-types";
import FinanceNav from "../../finance-nav";
import Supplier360 from "../supplier-360";
import {
  SUPPLIER_360_CONTRACT_SELECT,
  SUPPLIER_360_EXPENSE_SELECT,
  SUPPLIER_360_FIXED_ASSET_SELECT,
  SUPPLIER_360_PAYABLE_SELECT,
  SUPPLIER_360_PRODUCT_PURCHASE_SELECT,
  SUPPLIER_360_PURCHASE_ORDER_SELECT,
  SUPPLIER_360_RAW_MATERIAL_PURCHASE_SELECT,
  computeSupplier360Summary,
  normalizeSupplier360Contract,
  normalizeSupplier360Expense,
  normalizeSupplier360FixedAsset,
  normalizeSupplier360Payable,
  normalizeSupplier360ProductPurchase,
  normalizeSupplier360PurchaseOrder,
  normalizeSupplier360RawMaterialPurchase,
  reportSupplier360QueryError,
  vendorNameMatchesSupplier,
  type Supplier360Contract,
  type Supplier360Expense,
  type Supplier360FixedAsset,
  type Supplier360Payable,
  type Supplier360SectionErrors,
} from "../supplier-360-utils";

type SupplierDetailPageProps = {
  params: Promise<{ supplierId: string }>;
};

export default async function SupplierDetailPage({
  params,
}: SupplierDetailPageProps) {
  const { supplierId } = await params;
  const tenantId = await getCurrentUserTenantId();

  if (!tenantId) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Finance</h1>
        <p className="text-sm text-red-700">
          Unable to resolve your workspace. Contact support if this persists.
        </p>
      </div>
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const role = (await getCurrentUserRole()) as AppRole | null;
  const suppliersOnly = isFinanceSuppliersOnlyRole(role);
  const showFinanceDetails = !suppliersOnly;

  const [activeBusinessUnitId, viewAllBusinessUnits] = await Promise.all([
    getActiveBusinessUnitId(),
    getViewAllBusinessUnits(),
  ]);
  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });

  const { data: supplierRow } = await supabase
    .from("suppliers")
    .select(SUPPLIER_SELECT)
    .eq("id", supplierId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!supplierRow) {
    notFound();
  }

  const supplier = normalizeSupplier(supplierRow as SupplierRow);
  const supplierName = supplier.name;

  const [
    { data: productPurchases, error: productPurchasesError },
    { data: rawMaterialPurchases, error: rawMaterialPurchasesError },
    { data: purchaseOrders, error: purchaseOrdersError },
  ] = await Promise.all([
    applyBusinessUnitScope(
      supabase
        .from("product_purchases")
        .select(SUPPLIER_360_PRODUCT_PURCHASE_SELECT)
        .eq("tenant_id", tenantId)
        .eq("supplier_id", supplierId),
      buScope,
    ).order("purchase_date", { ascending: false }),
    applyBusinessUnitScope(
      supabase
        .from("raw_material_purchases")
        .select(SUPPLIER_360_RAW_MATERIAL_PURCHASE_SELECT),
      buScope,
    ).order("purchase_date", { ascending: false }),
    applyBusinessUnitScope(
      supabase
        .from("purchase_orders")
        .select(SUPPLIER_360_PURCHASE_ORDER_SELECT)
        .eq("tenant_id", tenantId)
        .eq("supplier_id", supplierId),
      buScope,
    ).order("order_date", { ascending: false }),
  ]);

  let payables: Supplier360Payable[] = [];
  let expenses: Supplier360Expense[] = [];
  let contracts: Supplier360Contract[] = [];
  let fixedAssets: Supplier360FixedAsset[] = [];
  let payablesError: { message: string } | null = null;
  let expensesError: { message: string } | null = null;
  let contractsError: { message: string } | null = null;
  let fixedAssetsError: { message: string } | null = null;

  if (showFinanceDetails) {
    const financeResults = await Promise.all([
      applyBusinessUnitScope(
        supabase
          .from("accounts_payable")
          .select(SUPPLIER_360_PAYABLE_SELECT)
          .eq("tenant_id", tenantId),
        buScope,
      ).order("invoice_date", { ascending: false }),
      applyBusinessUnitScope(
        supabase
          .from("expense_register")
          .select(SUPPLIER_360_EXPENSE_SELECT)
          .eq("tenant_id", tenantId),
        buScope,
      ).order("date", { ascending: false }),
      applyBusinessUnitScope(
        supabase
          .from("supplier_contracts")
          .select(SUPPLIER_360_CONTRACT_SELECT)
          .eq("tenant_id", tenantId)
          .eq("supplier_id", supplierId),
        buScope,
      ).order("start_date", { ascending: false }),
      applyBusinessUnitScope(
        supabase
          .from("fixed_assets")
          .select(SUPPLIER_360_FIXED_ASSET_SELECT)
          .eq("tenant_id", tenantId),
        buScope,
      ).order("purchase_date", { ascending: false }),
    ]);

    payables = (
      (financeResults[0].data as Record<string, unknown>[] | null) ?? []
    )
      .map((row) => normalizeSupplier360Payable(row))
      .filter((row) => vendorNameMatchesSupplier(supplierName, row.vendor_name));
    payablesError = financeResults[0].error;

    expenses = (
      (financeResults[1].data as Record<string, unknown>[] | null) ?? []
    )
      .map((row) => normalizeSupplier360Expense(row))
      .filter((row) => vendorNameMatchesSupplier(supplierName, row.vendor));
    expensesError = financeResults[1].error;

    contracts = (
      (financeResults[2].data as Record<string, unknown>[] | null) ?? []
    ).map((row) => normalizeSupplier360Contract(row));
    contractsError = financeResults[2].error;

    fixedAssets = (
      (financeResults[3].data as Record<string, unknown>[] | null) ?? []
    )
      .map((row) => normalizeSupplier360FixedAsset(row))
      .filter((row) => vendorNameMatchesSupplier(supplierName, row.vendor_name));
    fixedAssetsError = financeResults[3].error;
  }

  const normalizedProductPurchases = (
    (productPurchases as Record<string, unknown>[] | null) ?? []
  ).map((row) => normalizeSupplier360ProductPurchase(row));

  const normalizedRawMaterialPurchases = (
    (rawMaterialPurchases as Record<string, unknown>[] | null) ?? []
  )
    .map((row) => normalizeSupplier360RawMaterialPurchase(row))
    .filter((row) => vendorNameMatchesSupplier(supplierName, row.supplier));

  const normalizedPurchaseOrders = (
    (purchaseOrders as Record<string, unknown>[] | null) ?? []
  ).map((row) => normalizeSupplier360PurchaseOrder(row));

  const summary = computeSupplier360Summary({
    productPurchases: normalizedProductPurchases,
    rawMaterialPurchases: normalizedRawMaterialPurchases,
    payables: showFinanceDetails ? payables : [],
    productPurchaseDates: normalizedProductPurchases.map((row) => row.purchase_date),
    rawMaterialPurchaseDates: normalizedRawMaterialPurchases.map(
      (row) => row.purchase_date,
    ),
    purchaseOrderDates: normalizedPurchaseOrders.map((row) => row.order_date),
    expenseDates: showFinanceDetails ? expenses.map((row) => row.date) : [],
    contractDates: showFinanceDetails
      ? contracts.flatMap((row) =>
          [row.start_date, row.end_date ?? ""].filter(Boolean),
        )
      : [],
    fixedAssetDates: showFinanceDetails
      ? fixedAssets
          .map((row) => row.purchase_date)
          .filter((value): value is string => Boolean(value))
      : [],
  });

  const purchasesQueryError =
    productPurchasesError?.message ?? rawMaterialPurchasesError?.message ?? null;

  const sectionErrors: Supplier360SectionErrors = {
    purchases: reportSupplier360QueryError("purchases", purchasesQueryError),
    purchaseOrders: reportSupplier360QueryError(
      "purchaseOrders",
      purchaseOrdersError?.message,
    ),
    payables: reportSupplier360QueryError("payables", payablesError?.message),
    expenses: reportSupplier360QueryError("expenses", expensesError?.message),
    contracts: reportSupplier360QueryError("contracts", contractsError?.message),
    fixedAssets: reportSupplier360QueryError(
      "fixedAssets",
      fixedAssetsError?.message,
    ),
  };

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Finance</h1>
      <FinanceNav suppliersOnly={suppliersOnly} />
      <Supplier360
        supplier={supplier}
        summary={summary}
        productPurchases={normalizedProductPurchases}
        rawMaterialPurchases={normalizedRawMaterialPurchases}
        purchaseOrders={normalizedPurchaseOrders}
        payables={payables}
        expenses={expenses}
        contracts={contracts}
        fixedAssets={fixedAssets}
        sectionErrors={sectionErrors}
        canEditSupplier={canEditInventory(role)}
        showFinanceDetails={showFinanceDetails}
      />
    </div>
  );
}
