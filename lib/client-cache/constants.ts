/** IndexedDB database name — shared by main thread and service worker purge. */
export const CLIENT_CACHE_DB_NAME = "dfoms-client-cache";

export const CLIENT_CACHE_OBJECT_STORE = "entries";

/** Dashboard widget aggregates derived from fetchDashboardPageData pipeline. */
export const DASHBOARD_SUMMARY_TTL_MS = 10 * 60 * 1000; // 10 minutes (within 5–15min spec)

/** Reference / lookup option tables. */
export const REFERENCE_LOOKUPS_TTL_MS = 24 * 60 * 60 * 1000;

export const CLIENT_CACHE_PURGE_MESSAGE = "PURGE_CLIENT_CACHE" as const;
