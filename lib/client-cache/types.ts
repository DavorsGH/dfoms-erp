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
