"use client";

import { useCallback, useMemo, useState } from "react";
import { formatGHS } from "../finance/income-register-utils";
import {
  RegisterColumnFilterHeader,
  collectDistinctColumnValues,
  columnValuePassesFilter,
  registerColumnSortConfig,
  sortRegisterRows,
  type RegisterColumnFilterValue,
  type RegisterColumnSortState,
} from "../finance/register-column-filter";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import { getStripedRowClassName } from "../finance/register-row-actions";
import {
  buildConsumableStockRows,
  groupMovementsByItemId,
  type ConsumableItemRecord,
  type ConsumableMovementRecord,
} from "./consumables-store-utils";
import { ConsumablesScopeSubtitle } from "./consumables-scope-subtitle";

type Props = {
  initialItems: ConsumableItemRecord[];
  initialMovements: ConsumableMovementRecord[];
  fetchError: string | null;
};

export default function ConsumablesStoreStockScreen({
  initialItems,
  initialMovements,
  fetchError,
}: Props) {
  const [nameFilter, setNameFilter] = useState<RegisterColumnFilterValue>(null);
  const [categoryFilter, setCategoryFilter] =
    useState<RegisterColumnFilterValue>(null);
  const [statusFilter, setStatusFilter] =
    useState<RegisterColumnFilterValue>(null);
  const [columnSort, setColumnSort] = useState<RegisterColumnSortState | null>({
    columnId: "name",
    direction: "asc",
    valueType: "text",
  });

  const columnSortConfig = useCallback(
    (columnId: string, valueType: "text" | "number") =>
      registerColumnSortConfig(columnId, valueType, columnSort, setColumnSort),
    [columnSort],
  );

  const stockRows = useMemo(() => {
    const byItem = groupMovementsByItemId(initialMovements);
    return buildConsumableStockRows(initialItems, byItem);
  }, [initialItems, initialMovements]);

  const filtered = useMemo(() => {
    const rows = stockRows.filter(
      (row) =>
        columnValuePassesFilter(row.item.name, nameFilter) &&
        columnValuePassesFilter(row.item.category ?? "", categoryFilter) &&
        columnValuePassesFilter(row.status, statusFilter),
    );
    const activeSort = columnSort ?? {
      columnId: "name",
      direction: "asc" as const,
      valueType: "text" as const,
    };
    return sortRegisterRows(rows, activeSort, (row) => {
      switch (activeSort.columnId) {
        case "item_code":
          return row.item.item_code;
        case "category":
          return row.item.category ?? "";
        case "onHand":
          return row.onHand;
        case "stockValue":
          return row.stockValue;
        case "status":
          return row.status;
        default:
          return row.item.name;
      }
    });
  }, [stockRows, nameFilter, categoryFilter, statusFilter, columnSort]);

  const totalValue = useMemo(
    () =>
      Math.round(
        filtered.reduce((sum, row) => sum + row.stockValue, 0) * 100,
      ) / 100,
    [filtered],
  );

  return (
    <div className="space-y-4">
      {fetchError ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {fetchError}
        </p>
      ) : null}
      <ConsumablesScopeSubtitle title="Store stock" />
      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>Code</th>
              <th className={scrollableTableThClassName}>
                <RegisterColumnFilterHeader
                  label="Name"
                  options={collectDistinctColumnValues(
                    stockRows.map((r) => r.item.name),
                  )}
                  applied={nameFilter}
                  onApply={setNameFilter}
                  sort={columnSortConfig("name", "text")}
                />
              </th>
              <th className={scrollableTableThClassName}>
                <RegisterColumnFilterHeader
                  label="Category"
                  options={collectDistinctColumnValues(
                    stockRows.map((r) => r.item.category ?? ""),
                  )}
                  applied={categoryFilter}
                  onApply={setCategoryFilter}
                  sort={columnSortConfig("category", "text")}
                />
              </th>
              <th className={scrollableTableThClassName}>Unit</th>
              <th className={scrollableTableThClassName}>On hand</th>
              <th className={scrollableTableThClassName}>Avg cost</th>
              <th className={scrollableTableThClassName}>Stock value</th>
              <th className={scrollableTableThClassName}>Min</th>
              <th className={scrollableTableThClassName}>
                <RegisterColumnFilterHeader
                  label="Status"
                  options={collectDistinctColumnValues(
                    stockRows.map((r) => r.status),
                  )}
                  applied={statusFilter}
                  onApply={setStatusFilter}
                  sort={columnSortConfig("status", "text")}
                />
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                  No store stock for this scope.
                </td>
              </tr>
            ) : (
              filtered.map((row, index) => (
                <tr key={row.item.id} className={getStripedRowClassName(index)}>
                  <td className="px-4 py-3 text-sm">{row.item.item_code}</td>
                  <td className="px-4 py-3 text-sm">{row.item.name}</td>
                  <td className="px-4 py-3 text-sm">
                    {row.item.category ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-sm">{row.item.unit ?? "—"}</td>
                  <td className="px-4 py-3 text-sm">{row.onHand}</td>
                  <td className="px-4 py-3 text-sm">
                    {formatGHS(row.averageCost)}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {formatGHS(row.stockValue)}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {row.item.minimum_level ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-sm">{row.status}</td>
                </tr>
              ))
            )}
            {filtered.length > 0 ? (
              <tr className="bg-slate-100 font-semibold text-[#0f2744]">
                <td colSpan={6} className="px-4 py-3 text-sm">
                  Total stock value
                </td>
                <td className="px-4 py-3 text-sm">{formatGHS(totalValue)}</td>
                <td colSpan={2} />
              </tr>
            ) : null}
          </tbody>
        </table>
      </ScrollableTable>
    </div>
  );
}
