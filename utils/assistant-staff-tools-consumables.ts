import "server-only";

import {
  fetchConsumableItemsForScope,
  fetchConsumableMovementsForScope,
  fetchConsumableSitesForScope,
} from "@/app/dashboard/operations/consumables-store-data";
import {
  buildConsumableStockRows,
  buildSiteUsageRows,
  groupMovementsByItemId,
  STOCK_STATUS_LOW,
  STOCK_STATUS_OUT,
} from "@/app/dashboard/operations/consumables-store-utils";
import { getCurrentCalendarMonth } from "@/app/dashboard/dashboard-utils";
import { canAccessOperationsSection } from "@/utils/rbac-access";
import {
  getActiveBusinessUnitId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import { resolveBusinessUnitReadScope } from "@/utils/business-unit-view";
import {
  LIST_LIMIT,
  STAFF_DATA_UNAVAILABLE_MESSAGE,
  getStaffSupabase,
  requireStaffSession,
} from "@/utils/assistant-staff-tool-common";
import {
  formatAssistantUnit,
  roundAssistantAmount,
} from "@/utils/assistant-tool-format";

function parseOptionalNameFilter(toolInput: unknown): string | null {
  if (!toolInput || typeof toolInput !== "object") {
    return null;
  }
  const value = (toolInput as Record<string, unknown>).itemName;
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function parseStatusFilter(toolInput: unknown): "low" | "out" | null {
  if (!toolInput || typeof toolInput !== "object") {
    return null;
  }
  const raw = String((toolInput as Record<string, unknown>).status ?? "")
    .trim()
    .toLowerCase();
  if (raw === "low" || raw === "out" || raw === "out of stock") {
    return raw.startsWith("out") ? "out" : "low";
  }
  return null;
}

function parseSiteNameFilter(toolInput: unknown): string | null {
  if (!toolInput || typeof toolInput !== "object") {
    return null;
  }
  const value = (toolInput as Record<string, unknown>).siteName;
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function parseUsageDateRange(toolInput: unknown): {
  fromDate: string;
  toDate: string;
  year: number;
  month: number;
} {
  const { year: currentYear, month: currentMonth } = getCurrentCalendarMonth();
  const monthStart = `${currentYear}-${String(currentMonth).padStart(2, "0")}-01`;
  const lastDay = new Date(currentYear, currentMonth, 0).getDate();
  const monthEnd = `${currentYear}-${String(currentMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  if (!toolInput || typeof toolInput !== "object") {
    return {
      fromDate: monthStart,
      toDate: monthEnd,
      year: currentYear,
      month: currentMonth,
    };
  }

  const input = toolInput as Record<string, unknown>;
  let year = currentYear;
  let month = currentMonth;

  if (typeof input.year === "number" && Number.isFinite(input.year)) {
    year = Math.trunc(input.year);
  }
  if (typeof input.month === "number" && Number.isFinite(input.month)) {
    month = Math.min(Math.max(Math.trunc(input.month), 1), 12);
  }

  const fromRaw =
    typeof input.fromDate === "string" ? input.fromDate.trim() : "";
  const toRaw = typeof input.toDate === "string" ? input.toDate.trim() : "";

  if (fromRaw && toRaw) {
    return { fromDate: fromRaw.slice(0, 10), toDate: toRaw.slice(0, 10), year, month };
  }

  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDay = new Date(year, month, 0).getDate();
  const end = `${year}-${String(month).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`;
  return { fromDate: start, toDate: end, year, month };
}

export function buildAssistantConsumablesStoreStock(args: {
  items: Awaited<
    ReturnType<typeof fetchConsumableItemsForScope>
  >["items"];
  movements: Awaited<
    ReturnType<typeof fetchConsumableMovementsForScope>
  >["movements"];
  itemNameFilter: string | null;
  statusFilter: "low" | "out" | null;
}) {
  const byItem = groupMovementsByItemId(args.movements);
  let rows = buildConsumableStockRows(args.items, byItem);

  if (args.itemNameFilter) {
    const q = args.itemNameFilter.toLowerCase();
    rows = rows.filter(
      (row) =>
        row.item.name.toLowerCase().includes(q) ||
        row.item.item_code.toLowerCase().includes(q),
    );
  }

  if (args.statusFilter === "low") {
    rows = rows.filter((row) => row.status === STOCK_STATUS_LOW);
  } else if (args.statusFilter === "out") {
    rows = rows.filter((row) => row.status === STOCK_STATUS_OUT);
  }

  const totalValue = roundAssistantAmount(
    rows.reduce((sum, row) => sum + row.stockValue, 0),
  );
  const capped = rows.slice(0, LIST_LIMIT);

  return {
    itemCount: rows.length,
    items: capped.map((row) => ({
      itemCode: row.item.item_code,
      name: row.item.name,
      category: row.item.category ?? "",
      unit: formatAssistantUnit(row.item.unit),
      onHand: row.onHand,
      averageCostGhs: roundAssistantAmount(row.averageCost),
      stockValueGhs: roundAssistantAmount(row.stockValue),
      minimumLevel: row.item.minimum_level,
      status: row.status,
    })),
    totalStockValueGhs: totalValue,
  };
}

export async function getConsumablesStoreStock(
  toolInput?: unknown,
): Promise<unknown> {
  const sessionResult = await requireStaffSession();
  if ("error" in sessionResult) {
    return sessionResult;
  }
  if (!canAccessOperationsSection(sessionResult.session.role)) {
    return { error: "You do not have access to consumables store stock." };
  }

  const itemNameFilter = parseOptionalNameFilter(toolInput);
  const statusFilter = parseStatusFilter(toolInput);

  try {
    const supabase = await getStaffSupabase();
    const tenantId = sessionResult.session.tenantId;
    const [activeBusinessUnitId, viewAllBusinessUnits] = await Promise.all([
      getActiveBusinessUnitId(),
      getViewAllBusinessUnits(),
    ]);
    const buScope = resolveBusinessUnitReadScope({
      viewAllBusinessUnits,
      activeBusinessUnitId,
    });

    const [itemsResult, movementsResult] = await Promise.all([
      fetchConsumableItemsForScope(supabase, tenantId, buScope),
      fetchConsumableMovementsForScope(supabase, tenantId, buScope),
    ]);

    const fetchWarning = itemsResult.error ?? movementsResult.error ?? null;

    return {
      ...buildAssistantConsumablesStoreStock({
        items: itemsResult.items,
        movements: movementsResult.movements,
        itemNameFilter,
        statusFilter,
      }),
      fetchWarning,
    };
  } catch (error) {
    console.error("[assistant] get_consumables_store_stock threw:", error);
    return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
  }
}

export function buildAssistantConsumablesSiteUsage(args: {
  items: Awaited<
    ReturnType<typeof fetchConsumableItemsForScope>
  >["items"];
  movements: Awaited<
    ReturnType<typeof fetchConsumableMovementsForScope>
  >["movements"];
  sites: Awaited<ReturnType<typeof fetchConsumableSitesForScope>>["sites"];
  fromDate: string;
  toDate: string;
  siteNameFilter: string | null;
}) {
  const itemsById = new Map(args.items.map((item) => [item.id, item]));
  const sitesByCode = new Map(
    args.sites.map((site) => [
      site.site_code,
      { site_name: site.site_name, project_id: site.project_id },
    ]),
  );
  const projectLabelById = new Map<string, string>();
  for (const site of args.sites) {
    if (site.project_id) {
      projectLabelById.set(
        site.project_id,
        [site.project_code, site.project_name].filter(Boolean).join(" — ") ||
          site.project_id,
      );
    }
  }

  let detailRows = buildSiteUsageRows({
    movements: args.movements,
    itemsById,
    sitesByCode,
    projectLabelById,
    fromDate: args.fromDate,
    toDate: args.toDate,
  });

  if (args.siteNameFilter) {
    const q = args.siteNameFilter.toLowerCase();
    detailRows = detailRows.filter((row) =>
      row.siteName.toLowerCase().includes(q),
    );
  }

  const subtotalsBySite = new Map<string, number>();
  for (const row of detailRows) {
    const prev = subtotalsBySite.get(row.siteName) ?? 0;
    subtotalsBySite.set(
      row.siteName,
      roundAssistantAmount(prev + row.netValue),
    );
  }

  const grandTotal = roundAssistantAmount(
    detailRows.reduce((sum, row) => sum + row.netValue, 0),
  );

  const rows = detailRows.slice(0, LIST_LIMIT).map((row) => ({
    site: row.siteName,
    contractOrProject: row.projectLabel,
    item: row.itemName,
    netQuantity: row.netQuantity,
    unit: formatAssistantUnit(row.unit),
    valueGhs: roundAssistantAmount(row.netValue),
  }));

  const siteSubtotals = [...subtotalsBySite.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, LIST_LIMIT)
    .map(([site, valueGhs]) => ({ site, valueGhs }));

  return {
    fromDate: args.fromDate.slice(0, 10),
    toDate: args.toDate.slice(0, 10),
    rowCount: detailRows.length,
    rows,
    siteSubtotals,
    grandTotalValueGhs: grandTotal,
  };
}

export async function getConsumablesSiteUsage(
  toolInput?: unknown,
): Promise<unknown> {
  const sessionResult = await requireStaffSession();
  if ("error" in sessionResult) {
    return sessionResult;
  }
  if (!canAccessOperationsSection(sessionResult.session.role)) {
    return { error: "You do not have access to consumables site usage." };
  }

  const { fromDate, toDate } = parseUsageDateRange(toolInput);
  const siteNameFilter = parseSiteNameFilter(toolInput);

  try {
    const supabase = await getStaffSupabase();
    const tenantId = sessionResult.session.tenantId;
    const [activeBusinessUnitId, viewAllBusinessUnits] = await Promise.all([
      getActiveBusinessUnitId(),
      getViewAllBusinessUnits(),
    ]);
    const buScope = resolveBusinessUnitReadScope({
      viewAllBusinessUnits,
      activeBusinessUnitId,
    });

    const [itemsResult, movementsResult, sitesResult] = await Promise.all([
      fetchConsumableItemsForScope(supabase, tenantId, buScope),
      fetchConsumableMovementsForScope(supabase, tenantId, buScope),
      fetchConsumableSitesForScope(supabase, tenantId, buScope),
    ]);

    const fetchWarning =
      itemsResult.error ??
      movementsResult.error ??
      sitesResult.error ??
      null;

    return {
      ...buildAssistantConsumablesSiteUsage({
        items: itemsResult.items,
        movements: movementsResult.movements,
        sites: sitesResult.sites,
        fromDate,
        toDate,
        siteNameFilter,
      }),
      fetchWarning,
    };
  } catch (error) {
    console.error("[assistant] get_consumables_site_usage threw:", error);
    return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
  }
}
