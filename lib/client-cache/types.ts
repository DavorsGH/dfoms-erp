import type { DashboardViewModel } from "@/app/dashboard/dashboard-utils";

export type CacheEnvelope<T> = {
  /** ISO timestamp when this entry was written. */
  cachedAt: string;
  /** Hard expiry — entry must not be served after this time. */
  expiresAt: string;
  tenantId: string;
  authUid: string;
  payload: T;
};

export type ReferenceLookupsPayload = {
  departments: Array<{ code: string; name: string }>;
  positions: Array<{ id: string; name: string }>;
  projects: Array<{ code: string; name: string }>;
  shifts: Array<{ name: string }>;
  expenseCategories: Array<{ name: string }>;
  paymentMethods: Array<{ name: string }>;
  leaveTypes: Array<{ type_name: string }>;
  serviceTypes: Array<{ name: string }>;
};

export type DashboardSummaryCachePayload = {
  viewModel: DashboardViewModel;
  fetchError: string | null;
};

/** Subset of finished_products needed for POS stock display / cart. */
export type StockLevelCacheRow = {
  id: string;
  product_code: string;
  product_name: string;
  unit_of_measure: string;
  current_stock: number;
  standard_selling_price: number | null;
  sourcing_type: string | null;
  supplier_id: string | null;
  photo_url: string | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
  manufacturing_date: string | null;
  expiration_date: string | null;
};

export type StockLevelsCachePayload = {
  products: StockLevelCacheRow[];
};

export type CustomerBalanceCacheRow = {
  client_id: string;
  client_name: string;
  loyalty_points: number;
  open_ar: number;
};

export type CustomerBalancesCachePayload = {
  customers: CustomerBalanceCacheRow[];
};
