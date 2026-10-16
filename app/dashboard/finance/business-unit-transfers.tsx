"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { useAlert, useToast } from "@/components/feedback";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import { formatDate, formatGHS } from "./income-register-utils";
import RegisterRowActions, {
  confirmDeleteEntry,
  getStripedRowClassName,
  toDateInputValue,
} from "./register-row-actions";
import {
  RegisterColumnFilterHeader,
  RegisterDateRangeFilterHeader,
  collectDistinctColumnValues,
  columnValuePassesFilter,
  createRegisterDateSortState,
  dateValuePassesRangeFilter,
  registerColumnSortConfig,
  sortRegisterRows,
  type RegisterColumnFilterValue,
  type RegisterColumnSortState,
  type RegisterColumnSortValueType,
  type RegisterDateRangeFilterValue,
} from "./register-column-filter";
import {
  assertCanModifyBusinessUnitRow,
  formatBusinessUnitAccessError,
  loadWriteBusinessUnitContext,
} from "@/utils/business-unit-access";
import {
  BUSINESS_UNIT_TRANSFER_SELECT,
  buildInterUnitPairSummaries,
  normalizeBusinessUnitTransferRecord,
  type BusinessUnitTransferRecord,
} from "./business-unit-transfers-utils";

type BusinessUnitOption = {
  id: string;
  name: string;
};

type BusinessUnitTransfersProps = {
  tenantId: string;
  initialTransfers: BusinessUnitTransferRecord[];
  businessUnits: BusinessUnitOption[];
  fetchError: string | null;
};

type TransferListRow = BusinessUnitTransferRecord & {
  fromUnitName: string;
  toUnitName: string;
};

const emptyForm = {
  transfer_date: "",
  from_business_unit_id: "",
  to_business_unit_id: "",
  amount: "",
  description: "",
  reference: "",
};

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#18365c] disabled:cursor-not-allowed disabled:opacity-50";

function assertDistinctUnits(fromId: string, toId: string): void {
  if (fromId && toId && fromId === toId) {
    throw new Error("From and To business units must be different.");
  }
}

function assertUnitsBelongToTenant(
  unitIds: string[],
  allowedIds: Set<string>,
): void {
  for (const id of unitIds) {
    if (!allowedIds.has(id)) {
      throw new Error("Selected business unit is not valid for this workspace.");
    }
  }
}

export default function BusinessUnitTransfers({
  tenantId,
  initialTransfers,
  businessUnits,
  fetchError,
}: BusinessUnitTransfersProps) {
  const supabase = createClient();
  const { alertError } = useAlert();
  const { toast } = useToast();
  const [transfers, setTransfers] = useState(
    initialTransfers.map(normalizeBusinessUnitTransferRecord),
  );
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    if (fetchError) {
      void alertError(fetchError, { title: "Could not load inter-unit transfers" });
    }
  }, [alertError, fetchError]);

  const unitNameById = useMemo(
    () => new Map(businessUnits.map((unit) => [unit.id, unit.name])),
    [businessUnits],
  );
  const tenantUnitIds = useMemo(
    () => new Set(businessUnits.map((unit) => unit.id)),
    [businessUnits],
  );

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const pairSummaries = useMemo(
    () =>
      buildInterUnitPairSummaries(transfers, unitNameById, today).map(
        (summary) => ({
          ...summary,
          display: `${summary.label} ${formatGHS(summary.amount)}`,
        }),
      ),
    [transfers, unitNameById, today],
  );

  const [transferDateFilter, setTransferDateFilter] =
    useState<RegisterDateRangeFilterValue>(null);
  const [fromUnitFilter, setFromUnitFilter] =
    useState<RegisterColumnFilterValue>(null);
  const [toUnitFilter, setToUnitFilter] =
    useState<RegisterColumnFilterValue>(null);
  const [descriptionFilter, setDescriptionFilter] =
    useState<RegisterColumnFilterValue>(null);
  const [referenceFilter, setReferenceFilter] =
    useState<RegisterColumnFilterValue>(null);
  const [columnSort, setColumnSort] = useState<RegisterColumnSortState | null>(
    () => createRegisterDateSortState("transfer_date"),
  );

  const columnSortConfig = useCallback(
    (columnId: string, valueType: RegisterColumnSortValueType) =>
      registerColumnSortConfig(columnId, valueType, columnSort, setColumnSort),
    [columnSort],
  );

  const listRows: TransferListRow[] = useMemo(
    () =>
      transfers.map((row) => ({
        ...row,
        fromUnitName:
          unitNameById.get(row.from_business_unit_id) ??
          row.from_business_unit_id,
        toUnitName:
          unitNameById.get(row.to_business_unit_id) ?? row.to_business_unit_id,
      })),
    [transfers, unitNameById],
  );

  const transferSortValue = useCallback(
    (row: TransferListRow, columnId: string): unknown => {
      switch (columnId) {
        case "transfer_date":
          return row.transfer_date;
        case "fromUnitName":
          return row.fromUnitName;
        case "toUnitName":
          return row.toUnitName;
        case "description":
          return row.description;
        case "reference":
          return row.reference ?? "";
        default:
          return row.transfer_date;
      }
    },
    [],
  );

  const filteredRows = useMemo(() => {
    const filtered = listRows.filter((row) => {
      if (
        !dateValuePassesRangeFilter(row.transfer_date, transferDateFilter)
      ) {
        return false;
      }
      if (!columnValuePassesFilter(row.fromUnitName, fromUnitFilter)) {
        return false;
      }
      if (!columnValuePassesFilter(row.toUnitName, toUnitFilter)) {
        return false;
      }
      if (!columnValuePassesFilter(row.description, descriptionFilter)) {
        return false;
      }
      if (
        !columnValuePassesFilter(row.reference ?? "", referenceFilter)
      ) {
        return false;
      }
      return true;
    });
    const activeSort =
      columnSort ?? createRegisterDateSortState("transfer_date");
    return sortRegisterRows(
      filtered,
      activeSort,
      (row) => transferSortValue(row, activeSort.columnId),
      (left, right) =>
        String(right.created_at ?? right.id).localeCompare(
          String(left.created_at ?? left.id),
        ),
    );
  }, [
    listRows,
    transferDateFilter,
    fromUnitFilter,
    toUnitFilter,
    descriptionFilter,
    referenceFilter,
    columnSort,
    transferSortValue,
  ]);

  const fromUnitFilterOptions = useMemo(
    () => collectDistinctColumnValues(listRows.map((row) => row.fromUnitName)),
    [listRows],
  );
  const toUnitFilterOptions = useMemo(
    () => collectDistinctColumnValues(listRows.map((row) => row.toUnitName)),
    [listRows],
  );

  async function refreshTransfers() {
    const { data, error } = await supabase
      .from("business_unit_transfers")
      .select(BUSINESS_UNIT_TRANSFER_SELECT)
      .eq("tenant_id", tenantId)
      .order("transfer_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      void alertError(error.message, { title: "Could not refresh transfers" });
      return;
    }

    setTransfers(
      ((data as BusinessUnitTransferRecord[] | null) ?? []).map(
        normalizeBusinessUnitTransferRecord,
      ),
    );
  }

  function openAddForm() {
    setEditingId(null);
    setForm({
      ...emptyForm,
      transfer_date: today,
    });
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
    setLoading(false);
  }

  function openEditForm(row: BusinessUnitTransferRecord) {
    setEditingId(row.id);
    setForm({
      transfer_date: toDateInputValue(row.transfer_date),
      from_business_unit_id: row.from_business_unit_id,
      to_business_unit_id: row.to_business_unit_id,
      amount: String(row.amount),
      description: row.description,
      reference: row.reference ?? "",
    });
    setShowForm(true);
  }

  async function handleDelete(id: string) {
    if (!(await confirmDeleteEntry())) {
      return;
    }

    setDeletingId(id);

    const existing = transfers.find((row) => row.id === id);
    const buContext = await loadWriteBusinessUnitContext(supabase);
    if (!buContext.ok) {
      await alertError(buContext.error, { title: "Could not delete transfer" });
      setDeletingId(null);
      return;
    }

    try {
      assertCanModifyBusinessUnitRow(
        buContext.allowedUnits,
        existing?.from_business_unit_id,
      );
      assertCanModifyBusinessUnitRow(
        buContext.allowedUnits,
        existing?.to_business_unit_id,
      );
    } catch (accessError) {
      await alertError(formatBusinessUnitAccessError(accessError), {
        title: "Could not delete transfer",
      });
      setDeletingId(null);
      return;
    }

    const { error } = await supabase
      .from("business_unit_transfers")
      .delete()
      .eq("id", id)
      .eq("tenant_id", tenantId);

    if (error) {
      await alertError(error.message, { title: "Could not delete transfer" });
      setDeletingId(null);
      return;
    }

    if (editingId === id) {
      closeForm();
    }

    toast("Transfer deleted.");
    await refreshTransfers();
    setDeletingId(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);

    const formElement = event.currentTarget;
    if (!formElement.reportValidity()) {
      setLoading(false);
      return;
    }

    try {
      const fromId = form.from_business_unit_id.trim();
      const toId = form.to_business_unit_id.trim();
      const amount = Number(form.amount);
      assertDistinctUnits(fromId, toId);
      assertUnitsBelongToTenant([fromId, toId], tenantUnitIds);

      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error("Enter an amount greater than zero.");
      }

      const buContext = await loadWriteBusinessUnitContext(supabase);
      if (!buContext.ok) {
        throw new Error(buContext.error);
      }
      assertCanModifyBusinessUnitRow(buContext.allowedUnits, fromId);
      assertCanModifyBusinessUnitRow(buContext.allowedUnits, toId);

      const payload = {
        tenant_id: tenantId,
        transfer_date: form.transfer_date,
        from_business_unit_id: fromId,
        to_business_unit_id: toId,
        amount,
        description: form.description.trim(),
        reference: form.reference.trim() || null,
      };

      if (editingId) {
        const { error } = await supabase
          .from("business_unit_transfers")
          .update({
            transfer_date: payload.transfer_date,
            from_business_unit_id: payload.from_business_unit_id,
            to_business_unit_id: payload.to_business_unit_id,
            amount: payload.amount,
            description: payload.description,
            reference: payload.reference,
            updated_at: new Date().toISOString(),
          })
          .eq("id", editingId)
          .eq("tenant_id", tenantId);

        if (error) {
          throw new Error(error.message);
        }
        toast("Transfer updated.");
      } else {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        const { error } = await supabase.from("business_unit_transfers").insert({
          ...payload,
          created_by: user?.id ?? null,
        });

        if (error) {
          throw new Error(error.message);
        }
        toast("Transfer recorded.");
      }

      closeForm();
      await refreshTransfers();
    } catch (submitError) {
      await alertError(submitError, { title: "Could not save transfer" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {pairSummaries.length > 0 ? (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-3 text-lg font-semibold text-[#0f2744]">
            Net positions (cumulative to today)
          </h3>
          <ul className="space-y-2 text-sm text-slate-700">
            {pairSummaries.map((summary) => (
              <li key={`${summary.debtorUnitId}-${summary.creditorUnitId}`}>
                {summary.display}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          No outstanding net positions between business units as at today.
        </section>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          Internal cash movements between business units (non-P&amp;L).
        </p>
        <button
          type="button"
          onClick={openAddForm}
          className={primaryButtonClassName}
        >
          Add transfer
        </button>
      </div>

      {showForm ? (
        <form
          onSubmit={(event) => void handleSubmit(event)}
          className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
        >
          <h3 className="mb-4 text-lg font-semibold text-[#0f2744]">
            {editingId ? "Edit transfer" : "New transfer"}
          </h3>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Date</span>
              <input
                type="date"
                required
                className={inputClassName}
                value={form.transfer_date}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    transfer_date: event.target.value,
                  }))
                }
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">
                Amount (GHS)
              </span>
              <input
                type="number"
                required
                min={0.01}
                step="0.01"
                className={inputClassName}
                value={form.amount}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, amount: event.target.value }))
                }
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">
                From unit
              </span>
              <select
                required
                className={inputClassName}
                value={form.from_business_unit_id}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    from_business_unit_id: event.target.value,
                  }))
                }
              >
                <option value="">Select unit</option>
                {businessUnits.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">
                To unit
              </span>
              <select
                required
                className={inputClassName}
                value={form.to_business_unit_id}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    to_business_unit_id: event.target.value,
                  }))
                }
              >
                <option value="">Select unit</option>
                {businessUnits.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm md:col-span-2">
              <span className="mb-1 block font-medium text-slate-700">
                Description
              </span>
              <input
                type="text"
                required
                className={inputClassName}
                value={form.description}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    description: event.target.value,
                  }))
                }
              />
            </label>
            <label className="block text-sm md:col-span-2">
              <span className="mb-1 block font-medium text-slate-700">
                Reference (optional)
              </span>
              <input
                type="text"
                className={inputClassName}
                value={form.reference}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    reference: event.target.value,
                  }))
                }
              />
            </label>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={loading}
              className={primaryButtonClassName}
            >
              {loading ? "Saving…" : editingId ? "Save changes" : "Save transfer"}
            </button>
            <button
              type="button"
              onClick={closeForm}
              disabled={loading}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      <ScrollableTable>
        <table className={scrollableTableClassName}>
        <thead className={scrollableTableHeadClassName}>
          <tr>
            <th className={scrollableTableThClassName}>
              <RegisterDateRangeFilterHeader
                label="Date"
                applied={transferDateFilter}
                onApply={setTransferDateFilter}
                sort={columnSortConfig("transfer_date", "date")}
              />
            </th>
            <th className={scrollableTableThClassName}>
              <RegisterColumnFilterHeader
                label="From unit"
                options={fromUnitFilterOptions}
                applied={fromUnitFilter}
                onApply={setFromUnitFilter}
                sort={columnSortConfig("fromUnitName", "text")}
              />
            </th>
            <th className={scrollableTableThClassName}>
              <RegisterColumnFilterHeader
                label="To unit"
                options={toUnitFilterOptions}
                applied={toUnitFilter}
                onApply={setToUnitFilter}
                sort={columnSortConfig("toUnitName", "text")}
              />
            </th>
            <th className={scrollableTableThClassName}>Amount</th>
            <th className={scrollableTableThClassName}>
              <RegisterColumnFilterHeader
                label="Description"
                options={collectDistinctColumnValues(
                  listRows.map((row) => row.description),
                )}
                applied={descriptionFilter}
                onApply={setDescriptionFilter}
                sort={columnSortConfig("description", "text")}
              />
            </th>
            <th className={scrollableTableThClassName}>
              <RegisterColumnFilterHeader
                label="Reference"
                options={collectDistinctColumnValues(
                  listRows.map((row) => row.reference ?? ""),
                )}
                applied={referenceFilter}
                onApply={setReferenceFilter}
                sort={columnSortConfig("reference", "text")}
              />
            </th>
            <th className={scrollableTableThClassName}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filteredRows.length === 0 ? (
            <tr>
              <td
                colSpan={7}
                className="px-4 py-8 text-center text-sm text-slate-500"
              >
                No transfers match the current filters.
              </td>
            </tr>
          ) : (
            filteredRows.map((row, index) => (
              <tr
                key={row.id}
                className={getStripedRowClassName(index)}
              >
                <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">
                  {formatDate(row.transfer_date)}
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">
                  {row.fromUnitName}
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">
                  {row.toUnitName}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">
                  {formatGHS(row.amount)}
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">
                  {row.description}
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">
                  {row.reference ?? "—"}
                </td>
                <td className="px-4 py-3 text-sm">
                  <RegisterRowActions
                    onEdit={() => openEditForm(row)}
                    onDelete={() => void handleDelete(row.id)}
                    deleting={deletingId === row.id}
                  />
                </td>
              </tr>
            ))
          )}
        </tbody>
        </table>
      </ScrollableTable>
    </div>
  );
}
