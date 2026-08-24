/** IndexedDB database name — shared by main thread and service worker purge. */
export const CLIENT_CACHE_DB_NAME = "dfoms-client-cache";

/** Bump when adding object stores (v2 = offline write_queue). */
export const CLIENT_CACHE_DB_VERSION = 2;

export const CLIENT_CACHE_OBJECT_STORE = "entries";

/** Offline write-queue store (attendance / expense Phase 2+). */
export const WRITE_QUEUE_OBJECT_STORE = "write_queue";

/** Dashboard widget aggregates derived from fetchDashboardPageData pipeline. */
export const DASHBOARD_SUMMARY_TTL_MS = 10 * 60 * 1000; // 10 minutes (within 5–15min spec)

/** Reference / lookup option tables. */
export const REFERENCE_LOOKUPS_TTL_MS = 24 * 60 * 60 * 1000;

/** Finished-product stock snapshot for POS / inventory read-only offline. */
export const STOCK_LEVELS_TTL_MS = 10 * 60 * 1000;

/** Per-customer loyalty + open AR snapshot for POS read-only offline. */
export const CUSTOMER_BALANCES_TTL_MS = 10 * 60 * 1000;

export const CLIENT_CACHE_PURGE_MESSAGE = "PURGE_CLIENT_CACHE" as const;

/** Same-origin Cache API keys for remote navbar images (warmed post-login). */
export const OFFLINE_ASSET_USER_AVATAR_PATH = "/__offline_assets/user-avatar";
export const OFFLINE_ASSET_WORKSPACE_LOGO_PATH =
  "/__offline_assets/workspace-logo";

/** Must stay in sync with public/sw.js CACHE_NAME. */
export const SHELL_CACHE_NAME = "davors-erp-shell-v8";

/** localStorage mirror so enqueue works after going offline mid-session. */
export const CLIENT_CACHE_SESSION_STORAGE_KEY = "dfoms-client-cache-session";
