"use client";

import { confirmDialog } from "@/components/feedback/app-dialogs";
import { useAlert, useToast } from "@/components/feedback";
import Tooltip from "@/components/ui/tooltip";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import type { Approver, NamedLookup } from "../lookup-types";
import {
  calculateAmount,
  formatDate,
  formatGHS,
  getExpenseGrossBeforeWht,
  EXPENSE_REGISTER_PROJECT_OVERHEAD_VALUE,
  expenseRegisterInputClassName,
  expenseRegisterProjectOptionsForForm,
  formatExpenseRegisterContractProjectLabel,
  initialExpenseRegisterProjectFormValue,
  normalizeExpenseRegisterEntry,
  normalizeExpenseRegisterProjectIdForDatabase,
  resolveExpenseRegisterProjectIdForSave,
  syncExpenseRegisterFormCustomValidity,
  tenantHasActiveExpenseProjects,
  type ExpenseRegisterEntry,
  type ExpenseRegisterFormValidityControls,
  type ExpenseSubcategoryLookup,
} from "./expense-register-utils";
import {
  ExpenseRegisterReceiptNoField,
  ExpenseRegisterSubCategorySelect,
  ExpenseRegisterSupplierFields,
  expenseCategorySelectOptionsForCreate,
  toVendorSupplierOptions,
} from "./expense-register-form-fields";
import { useExpenseRegisterCreateLookups } from "./use-expense-register-create-lookups";
import { requestTenantAdminDirectorNotification } from "@/utils/request-tenant-admin-director-notification";
import { resolveManualExpenseReceiptNo } from "./expense-register-api";
import {
  canMarkAutoPostedExpenseAsPaid,
  getRegisterRowClassName,
  isAutoPostedExpenseRegisterEntry,
  customerRefundExpenseLockMessage,
  isPayrollEssnitExpense,
  markAutoPostedExpensePaid,
} from "./register-auto-posted-utils";
import { isCustomerRefundCashOutflowExpense } from "./customer-refund-expense-utils";
import {
  fetchLinkedProductSaleCogsByExpenseId,
  formatLinkedProductSaleCogsDeleteMessage,
  isIncomeRegisterCogsExpenseFkError,
  lookupLinkedProductSaleCogsForExpense,
  type LinkedProductSaleCogs,
} from "./product-sale-cogs-expense-utils";
import { lookupOptionLabel } from "../administration/lookup-settings-shared";
import {
  computePurchaseTaxAmounts,
  computeWhtAmount,
  resolveDefaultWhtRate,
  roundTaxAmount,
  roundTaxRate,
  selectTaxRateOptions,
  type TaxRateCatalogEntry,
  type TaxSettings,
} from "./tax-utils";
import {
  deleteTaxLedgerEntriesForSource,
  syncPurchaseTaxLedger,
} from "./tax-ledger-sync";
import RegisterRowActions, {
  confirmDeleteEntry,
  highlightRegisterTableRow,
  toDateInputValue,
} from "./register-row-actions";
import {
  RegisterColumnFilterHeader,
  RegisterDateRangeFilterHeader,
  RegisterFilteredTotal,
  collectDistinctColumnValues,
  columnValuePassesFilter,
  createRegisterDateSortState,
  dateValuePassesRangeFilter,
  registerColumnSortConfig,
  registerTieBreakByIdDesc,
  sortRegisterRows,
  type RegisterColumnFilterValue,
  type RegisterColumnSortState,
  type RegisterColumnSortValueType,
  type RegisterDateRangeFilterValue,
} from "./register-column-filter";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableNoTruncateCellClassName,
  scrollableTableRegisterCategoryCellClassName,
  scrollableTableRegisterCategoryThClassName,
  scrollableTableRegisterDateCellClassName,
  scrollableTableRegisterStickyNameThClassName,
  scrollableTableRegisterStickyNameWrapTdClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import { buildExpenseRegisterDetailSections } from "./register-detail-sections";
import {
  AP_ACCRUAL_EXPENSE_EDIT_DISABLED_TITLE,
  collectApIdsFromApAccrualExpenseEntries,
  fetchLinkedAccountsPayableForApAccrualExpenses,
  resolveApAccrualPaymentStatusDisplay,
  resolveExpenseRegisterPaymentMethodLabel,
  resolveExpenseRegisterPaymentStatusLabel,
  type ApAccrualLinkedPayableSummary,
} from "./expense-register-ap-accrual-display";
import { buildApAccrualPaymentStatusListCell } from "./expense-register-ap-accrual-display-ui";
import RegisterRecordDetailDrawer from "../register-record-detail-drawer";
import { RegisterRecordNameLink } from "../register-record-name-link";
import TruncatedCell, {
  registerTruncatedCellHostClassName,
} from "../register-truncated-cell";
import FilteredListCount, {
  anyRegisterColumnFiltersActive,
} from "../filtered-list-count";
import type { SupplierRow } from "@/utils/suppliers-types";
import {
  inferVendorSelectState,
  resolveVendorNameFromSelect,
  VENDOR_OTHER_VALUE,
} from "./vendor-select-utils";
import { useOnlineStatus } from "@/hooks/use-online-status";
import {
  useBusinessUnitView,
  useStampBusinessUnitId,
  useBusinessUnitReadScope,
} from "@/app/dashboard/business-unit-view-context";
import { applyBusinessUnitScope } from "@/utils/business-unit-view";
import {
  assertCanModifyBusinessUnitRow,
  formatBusinessUnitAccessError,
  loadWriteBusinessUnitContext,
  resolveWriteBusinessUnitIdForCreate,
} from "@/utils/business-unit-access";
import { useWriteQueueOptional } from "@/components/write-queue-provider";
import { enqueueWriteQueueItem } from "@/lib/offline-write-queue/store";
import type { ExpenseQueuePayload } from "@/lib/offline-write-queue/types";
import { resolveClientCacheSession } from "@/lib/client-cache/session-context";
import type { ContractProjectOption } from "../administration/projects-utils";
import ExpenseRegisterBulkProjectDialog from "./expense-register-bulk-project-dialog";
import {
  bulkAssignExpenseRegisterProjectIds,
  expenseBulkProjectSelectionBlockTooltip,
  explainExpenseBulkProjectSelectionBlock,
  normalizeBulkAssignProjectFormValue,
} from "./expense-register-bulk-project-utils";
import { resolveSessionTenantId } from "@/utils/session-tenant-client";
import { parseAccountsPayableIdFromAccrualReceiptNo } from "./accounts-payable-accrual-utils";
import {
  isApAccrualExpenseRegisterRow,
  isSystemManagedExpenseRegisterRow,
  resolveExpenseRegisterLockMessage,
  MANUAL_EXPENSE_REGISTER_PAYMENT_STATUS,
  manualExpensePaymentStatusSelectOptions,
  validateManualExpenseRegisterPaymentStatusForWrite,
} from "@/utils/manual-expense-payment-status";

type ExpenseRegisterProps = {
  initialEntries: ExpenseRegisterEntry[];
  initialExpenseCategories: NamedLookup[];
  initialExpenseSubcategories: ExpenseSubcategoryLookup[];
  initialPaymentMethods: NamedLookup[];
  initialApprovers: Approver[];
  initialSuppliers: SupplierRow[];
  taxSettings: TaxSettings | null;
  taxRateCatalog: TaxRateCatalogEntry[];
  initialProjects: ContractProjectOption[];
  fetchError: string | null;
  /** Create-only stamp; null = All Businesses. */
  activeBusinessUnitId?: string | null;
};

type ExpenseFormState = {
  date: string;
  expense_category: string;
  sub_category: string;
  description: string;
  vendor_select: string;
  vendor_other: string;
  price: string;
  quantity: string;
  payment_method: string;
  approved_by: string;
  receipt_no: string;
  payment_status: string;
  has_wht_vat: boolean;
  wht_rate: string;
  wht_amount: string;
  input_vat_amount: string;
  notes: string;
  project_id: string;
};

const emptyForm: ExpenseFormState = {
  date: "",
  expense_category: "",
  sub_category: "",
  description: "",
  vendor_select: "",
  vendor_other: "",
  price: "",
  quantity: "",
  payment_method: "",
  approved_by: "",
  receipt_no: "",
  payment_status: MANUAL_EXPENSE_REGISTER_PAYMENT_STATUS,
  has_wht_vat: false,
  wht_rate: "0",
  wht_amount: "",
  input_vat_amount: "",
  notes: "",
  project_id: "",
};

function formatRateValue(rate: number): string {
  return String(roundTaxRate(rate));
}

function formatWhtAmount(gross: string, ratePct: string): string {
  const rate = Number(ratePct) || 0;
  if (rate <= 0) {
    return "";
  }

  return String(computeWhtAmount(Number(gross) || 0, rate));
}

export default function ExpenseRegister({
  initialEntries,
  initialExpenseCategories,
  initialExpenseSubcategories,
  initialPaymentMethods,
  initialApprovers,
  initialSuppliers,
  taxSettings,
  taxRateCatalog,
  initialProjects,
  fetchError,
  activeBusinessUnitId = null,
}: ExpenseRegisterProps) {
  const supabase = createClient();
  const { alertError } = useAlert();
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const expenseIdFromQueryHandled = useRef<string | null>(null);
  const stampBusinessUnit = useStampBusinessUnitId();
  const buReadScope = useBusinessUnitReadScope();
  const { units: businessUnits } = useBusinessUnitView();
  const isOnline = useOnlineStatus();
  const writeQueue = useWriteQueueOptional();
  const [entries, setEntries] = useState(
    initialEntries.map(normalizeExpenseRegisterEntry),
  );
  const [categoryFilter, setCategoryFilter] =
    useState<RegisterColumnFilterValue>(null);
  const [subCategoryFilter, setSubCategoryFilter] =
    useState<RegisterColumnFilterValue>(null);
  const [descriptionFilter, setDescriptionFilter] =
    useState<RegisterColumnFilterValue>(null);
  const [paymentStatusFilter, setPaymentStatusFilter] =
    useState<RegisterColumnFilterValue>(null);
  const [projectSiteFilter, setProjectSiteFilter] =
    useState<RegisterColumnFilterValue>(null);
  const [dateFilter, setDateFilter] =
    useState<RegisterDateRangeFilterValue>(null);
  const [columnSort, setColumnSort] = useState<RegisterColumnSortState | null>(
    () => createRegisterDateSortState("date"),
  );
  const [showForm, setShowForm] = useState(false);
  const createLookups = useExpenseRegisterCreateLookups({
    enabled: showForm,
  });
  const expenseCategories = showForm
    ? createLookups.expenseCategories
    : initialExpenseCategories;
  const expenseSubcategories = showForm
    ? createLookups.expenseSubcategories
    : initialExpenseSubcategories;
  const paymentMethods = showForm
    ? createLookups.paymentMethods
    : initialPaymentMethods;
  const approvers = showForm ? createLookups.approvers : initialApprovers;
  const suppliers = showForm ? createLookups.suppliers : initialSuppliers;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [markingPaidId, setMarkingPaidId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  // Once the user types a WHT amount we stop overwriting it from Gross × rate.
  const [whtAmountEdited, setWhtAmountEdited] = useState(false);
  const [loading, setLoading] = useState(false);
  const expenseFormRef = useRef<HTMLFormElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);
  const expenseCategorySelectRef = useRef<HTMLSelectElement>(null);
  const projectSelectRef = useRef<HTMLSelectElement>(null);
  const subCategoryFieldRef = useRef<HTMLDivElement>(null);
  const supplierFieldsRef = useRef<HTMLDivElement>(null);
  const priceInputRef = useRef<HTMLInputElement>(null);
  const quantityInputRef = useRef<HTMLInputElement>(null);
  const paymentStatusSelectRef = useRef<HTMLSelectElement>(null);
  const [linkedProductSaleCogsByExpenseId, setLinkedProductSaleCogsByExpenseId] =
    useState<Map<string, LinkedProductSaleCogs>>(() => new Map());
  const [linkedApAccrualPayables, setLinkedApAccrualPayables] = useState<
    Map<string, ApAccrualLinkedPayableSummary>
  >(() => new Map());
  const [linkedApAccrualPayablesLoaded, setLinkedApAccrualPayablesLoaded] =
    useState(true);
  const linkedApAccrualDisplayOptions = useMemo(
    () => ({ linkedPayablesLoaded: linkedApAccrualPayablesLoaded }),
    [linkedApAccrualPayablesLoaded],
  );
  const [detailExpenseId, setDetailExpenseId] = useState<string | null>(null);
  const [detailExpense, setDetailExpense] = useState<ExpenseRegisterEntry | null>(
    null,
  );
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedExpenseIds, setSelectedExpenseIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [bulkProjectDialogOpen, setBulkProjectDialogOpen] = useState(false);
  const [bulkProjectDialogKey, setBulkProjectDialogKey] = useState(0);
  const [bulkProjectAssigning, setBulkProjectAssigning] = useState(false);

  const defaultWhtRate = formatRateValue(resolveDefaultWhtRate(taxSettings));

  const whtRateOptions = useMemo(() => {
    const options = new Map<string, string>([["0", "No WHT (0%)"]]);

    for (const rate of selectTaxRateOptions(taxRateCatalog, "wht")) {
      options.set(formatRateValue(rate.rate_pct), rate.label);
    }

    for (const rate of [defaultWhtRate, form.wht_rate]) {
      if (rate && rate !== "0" && !options.has(rate)) {
        options.set(rate, `WHT ${rate}%`);
      }
    }

    return [...options.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) => Number(left.value) - Number(right.value));
  }, [taxRateCatalog, defaultWhtRate, form.wht_rate]);

  const expenseCategorySelectOptions = useMemo(
    () =>
      expenseCategorySelectOptionsForCreate(
        expenseCategories,
        Boolean(editingId),
        form.expense_category,
      ),
    [expenseCategories, editingId, form.expense_category],
  );

  const manualPaymentStatusOptions = useMemo(
    () => {
      const current = editingId
        ? entries.find((entry) => entry.id === editingId)?.payment_status
        : null;
      return manualExpensePaymentStatusSelectOptions(
        Boolean(editingId),
        current,
      );
    },
    [editingId, entries],
  );

  const hasActiveExpenseProjects = useMemo(
    () => tenantHasActiveExpenseProjects(initialProjects),
    [initialProjects],
  );

  const expenseFormProjectOptions = useMemo(
    () =>
      expenseRegisterProjectOptionsForForm(initialProjects, form.project_id),
    [initialProjects, form.project_id],
  );

  const contractSiteLabelForEntry = useCallback(
    (entry: { project_id?: string | null }) =>
      formatExpenseRegisterContractProjectLabel(entry.project_id, initialProjects),
    [initialProjects],
  );

  const columnSortConfig = useCallback(
    (columnId: string, valueType: RegisterColumnSortValueType) =>
      registerColumnSortConfig(columnId, valueType, columnSort, setColumnSort),
    [columnSort],
  );

  const expenseRegisterSortValue = useCallback(
    (
      entry: ExpenseRegisterEntry & { pendingSync?: boolean },
      columnId: string,
    ) => {
      switch (columnId) {
        case "date":
          return toDateInputValue(entry.date);
        case "description":
          return entry.description;
        case "expense_category":
          return entry.expense_category;
        case "project_site":
          return contractSiteLabelForEntry(entry);
        case "sub_category":
          return entry.sub_category;
        case "payment_status":
          return resolveExpenseRegisterPaymentStatusLabel(
            entry,
            linkedApAccrualPayables,
            linkedApAccrualDisplayOptions,
          );
        default:
          return "";
      }
    },
    [
      contractSiteLabelForEntry,
      linkedApAccrualPayables,
      linkedApAccrualDisplayOptions,
    ],
  );

  const categoryOptions = useMemo(
    () =>
      collectDistinctColumnValues(
        entries
          .filter(
            (entry) =>
              dateValuePassesRangeFilter(
                toDateInputValue(entry.date),
                dateFilter,
              ) &&
              columnValuePassesFilter(entry.sub_category, subCategoryFilter) &&
              columnValuePassesFilter(entry.description, descriptionFilter) &&
              columnValuePassesFilter(
                resolveExpenseRegisterPaymentStatusLabel(
                  entry,
                  linkedApAccrualPayables,
                  linkedApAccrualDisplayOptions,
                ),
                paymentStatusFilter,
              ) &&
              columnValuePassesFilter(
                contractSiteLabelForEntry(entry),
                projectSiteFilter,
              ),
          )
          .map((entry) => entry.expense_category),
      ),
    [
      entries,
      dateFilter,
      subCategoryFilter,
      descriptionFilter,
      paymentStatusFilter,
      projectSiteFilter,
      contractSiteLabelForEntry,
      linkedApAccrualPayables,
      linkedApAccrualDisplayOptions,
    ],
  );

  const subCategoryOptions = useMemo(
    () =>
      collectDistinctColumnValues(
        entries
          .filter(
            (entry) =>
              dateValuePassesRangeFilter(
                toDateInputValue(entry.date),
                dateFilter,
              ) &&
              columnValuePassesFilter(entry.expense_category, categoryFilter) &&
              columnValuePassesFilter(entry.description, descriptionFilter) &&
              columnValuePassesFilter(
                resolveExpenseRegisterPaymentStatusLabel(
                  entry,
                  linkedApAccrualPayables,
                  linkedApAccrualDisplayOptions,
                ),
                paymentStatusFilter,
              ) &&
              columnValuePassesFilter(
                contractSiteLabelForEntry(entry),
                projectSiteFilter,
              ),
          )
          .map((entry) => entry.sub_category),
      ),
    [
      entries,
      dateFilter,
      categoryFilter,
      descriptionFilter,
      paymentStatusFilter,
      projectSiteFilter,
      contractSiteLabelForEntry,
      linkedApAccrualPayables,
      linkedApAccrualDisplayOptions,
    ],
  );

  const projectSiteOptions = useMemo(
    () =>
      collectDistinctColumnValues(
        entries
          .filter(
            (entry) =>
              dateValuePassesRangeFilter(
                toDateInputValue(entry.date),
                dateFilter,
              ) &&
              columnValuePassesFilter(entry.expense_category, categoryFilter) &&
              columnValuePassesFilter(entry.sub_category, subCategoryFilter) &&
              columnValuePassesFilter(entry.description, descriptionFilter) &&
              columnValuePassesFilter(
                resolveExpenseRegisterPaymentStatusLabel(
                  entry,
                  linkedApAccrualPayables,
                  linkedApAccrualDisplayOptions,
                ),
                paymentStatusFilter,
              ),
          )
          .map((entry) => contractSiteLabelForEntry(entry)),
      ),
    [
      entries,
      dateFilter,
      categoryFilter,
      subCategoryFilter,
      descriptionFilter,
      paymentStatusFilter,
      contractSiteLabelForEntry,
      linkedApAccrualPayables,
      linkedApAccrualDisplayOptions,
    ],
  );

  const descriptionOptions = useMemo(
    () =>
      collectDistinctColumnValues(
        entries
          .filter(
            (entry) =>
              dateValuePassesRangeFilter(
                toDateInputValue(entry.date),
                dateFilter,
              ) &&
              columnValuePassesFilter(entry.expense_category, categoryFilter) &&
              columnValuePassesFilter(entry.sub_category, subCategoryFilter) &&
              columnValuePassesFilter(
                resolveExpenseRegisterPaymentStatusLabel(
                  entry,
                  linkedApAccrualPayables,
                  linkedApAccrualDisplayOptions,
                ),
                paymentStatusFilter,
              ) &&
              columnValuePassesFilter(
                contractSiteLabelForEntry(entry),
                projectSiteFilter,
              ),
          )
          .map((entry) => entry.description),
      ),
    [
      entries,
      dateFilter,
      categoryFilter,
      subCategoryFilter,
      paymentStatusFilter,
      projectSiteFilter,
      contractSiteLabelForEntry,
      linkedApAccrualPayables,
      linkedApAccrualDisplayOptions,
    ],
  );

  const paymentStatusOptions = useMemo(
    () =>
      collectDistinctColumnValues(
        entries
          .filter(
            (entry) =>
              dateValuePassesRangeFilter(
                toDateInputValue(entry.date),
                dateFilter,
              ) &&
              columnValuePassesFilter(entry.expense_category, categoryFilter) &&
              columnValuePassesFilter(entry.sub_category, subCategoryFilter) &&
              columnValuePassesFilter(entry.description, descriptionFilter) &&
              columnValuePassesFilter(
                contractSiteLabelForEntry(entry),
                projectSiteFilter,
              ),
          )
          .map((entry) =>
            resolveExpenseRegisterPaymentStatusLabel(
              entry,
              linkedApAccrualPayables,
              linkedApAccrualDisplayOptions,
            ),
          ),
      ),
    [
      entries,
      dateFilter,
      categoryFilter,
      subCategoryFilter,
      descriptionFilter,
      projectSiteFilter,
      contractSiteLabelForEntry,
      linkedApAccrualPayables,
      linkedApAccrualDisplayOptions,
    ],
  );

  const apAccrualLinkedIdsKey = useMemo(
    () =>
      collectApIdsFromApAccrualExpenseEntries(entries).sort().join("\0"),
    [entries],
  );

  const visibleEntries = useMemo(() => {
    type DisplayExpense = ExpenseRegisterEntry & {
      pendingSync?: boolean;
      queueFailed?: boolean;
      queueError?: string | null;
    };

    const queued: DisplayExpense[] = (writeQueue?.items ?? [])
      .filter((item) => item.type === "expense")
      .map((item) => {
        const payload = item.payload as ExpenseQueuePayload;
        return {
          id: item.id,
          date: payload.date,
          expense_category: payload.expense_category,
          sub_category: payload.sub_category,
          description: payload.description,
          vendor: payload.vendor,
          price: payload.price,
          quantity: payload.quantity,
          amount: payload.amount,
          payment_method: payload.payment_method,
          approved_by: payload.approved_by,
          receipt_no: payload.supplied_receipt_no || "(pending EXP#)",
          payment_status: payload.payment_status,
          notes: payload.notes,
          gross_before_wht: payload.gross_before_wht,
          wht_rate: payload.wht_rate,
          wht_amount: payload.wht_amount,
          input_vat_amount: payload.input_vat_amount,
          net_of_tax_amount: payload.net_of_tax_amount,
          project_id: payload.project_id,
          pendingSync: true,
          queueFailed: item.status === "failed",
          queueError: item.lastError,
        };
      });

    const live = entries.filter(
      (entry) =>
        dateValuePassesRangeFilter(toDateInputValue(entry.date), dateFilter) &&
              columnValuePassesFilter(entry.expense_category, categoryFilter) &&
              columnValuePassesFilter(entry.sub_category, subCategoryFilter) &&
              columnValuePassesFilter(entry.description, descriptionFilter) &&
              columnValuePassesFilter(
                resolveExpenseRegisterPaymentStatusLabel(
                  entry,
                  linkedApAccrualPayables,
                  linkedApAccrualDisplayOptions,
                ),
                paymentStatusFilter,
              ) &&
              columnValuePassesFilter(
                contractSiteLabelForEntry(entry),
                projectSiteFilter,
              ),
    );

    const queuedFiltered = queued.filter(
      (entry) =>
        dateValuePassesRangeFilter(toDateInputValue(entry.date), dateFilter) &&
        columnValuePassesFilter(entry.expense_category, categoryFilter) &&
        columnValuePassesFilter(entry.sub_category, subCategoryFilter) &&
        columnValuePassesFilter(entry.description, descriptionFilter) &&
        columnValuePassesFilter(
          resolveExpenseRegisterPaymentStatusLabel(
            entry,
            linkedApAccrualPayables,
            linkedApAccrualDisplayOptions,
          ),
          paymentStatusFilter,
        ) &&
        columnValuePassesFilter(
          contractSiteLabelForEntry(entry),
          projectSiteFilter,
        ),
    );

    const combined = [...queuedFiltered, ...live] as DisplayExpense[];
    const activeSort = columnSort ?? createRegisterDateSortState("date");
    return sortRegisterRows(
      combined,
      activeSort,
      (entry) => expenseRegisterSortValue(entry, activeSort.columnId),
      registerTieBreakByIdDesc,
    );
  }, [
    entries,
    writeQueue?.items,
    dateFilter,
    categoryFilter,
    subCategoryFilter,
    descriptionFilter,
    paymentStatusFilter,
    projectSiteFilter,
    contractSiteLabelForEntry,
    linkedApAccrualPayables,
    linkedApAccrualDisplayOptions,
    columnSort,
    expenseRegisterSortValue,
  ]);

  const visibleNetPaidTotal = useMemo(() => {
    let total = 0;
    for (const entry of visibleEntries) {
      total += Number(entry.amount) || 0;
    }
    return Math.round(total * 100) / 100;
  }, [visibleEntries]);

  const isEntrySelectableForBulkProject = useCallback(
    (entry: ExpenseRegisterEntry & { pendingSync?: boolean }) =>
      explainExpenseBulkProjectSelectionBlock(entry) === null,
    [],
  );

  const visibleSelectableEntries = useMemo(
    () =>
      visibleEntries.filter((entry) =>
        isEntrySelectableForBulkProject(
          entry as ExpenseRegisterEntry & { pendingSync?: boolean },
        ),
      ),
    [visibleEntries, isEntrySelectableForBulkProject],
  );

  const visibleEntryIdSet = useMemo(
    () => new Set(visibleEntries.map((entry) => entry.id)),
    [visibleEntries],
  );

  const visibleEntryIdsKey = useMemo(
    () => [...visibleEntryIdSet].sort().join("\0"),
    [visibleEntryIdSet],
  );

  useEffect(() => {
    setSelectedExpenseIds((current) => {
      if (current.size === 0) {
        return current;
      }
      let changed = false;
      const next = new Set<string>();
      for (const id of current) {
        if (visibleEntryIdSet.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [visibleEntryIdsKey, visibleEntryIdSet]);

  const selectedVisibleSelectableEntries = useMemo(
    () =>
      visibleSelectableEntries.filter((entry) =>
        selectedExpenseIds.has(entry.id),
      ),
    [visibleSelectableEntries, selectedExpenseIds],
  );

  const selectedBulkCount = selectedVisibleSelectableEntries.length;

  const selectedBulkTotal = useMemo(() => {
    let total = 0;
    for (const entry of selectedVisibleSelectableEntries) {
      total += Number(entry.amount) || 0;
    }
    return Math.round(total * 100) / 100;
  }, [selectedVisibleSelectableEntries]);

  const entriesByIdForBulk = useMemo(() => {
    const map = new Map<
      string,
      ExpenseRegisterEntry & { business_unit_id?: string | null }
    >();
    for (const entry of entries) {
      map.set(entry.id, entry as ExpenseRegisterEntry & { business_unit_id?: string | null });
    }
    return map;
  }, [entries]);

  const allVisibleSelectableSelected =
    visibleSelectableEntries.length > 0 &&
    visibleSelectableEntries.every((entry) => selectedExpenseIds.has(entry.id));

  const someVisibleSelectableSelected = visibleSelectableEntries.some((entry) =>
    selectedExpenseIds.has(entry.id),
  );

  const hasActiveListFilters = anyRegisterColumnFiltersActive(
    categoryFilter,
    subCategoryFilter,
    descriptionFilter,
    paymentStatusFilter,
    projectSiteFilter,
    dateFilter,
  );

  function toggleExpenseSelected(expenseId: string, checked: boolean) {
    setSelectedExpenseIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(expenseId);
      } else {
        next.delete(expenseId);
      }
      return next;
    });
  }

  function toggleSelectAllVisibleSelectable(checked: boolean) {
    if (!checked) {
      setSelectedExpenseIds((current) => {
        const next = new Set(current);
        for (const entry of visibleSelectableEntries) {
          next.delete(entry.id);
        }
        return next;
      });
      return;
    }
    setSelectedExpenseIds((current) => {
      const next = new Set(current);
      for (const entry of visibleSelectableEntries) {
        next.add(entry.id);
      }
      return next;
    });
  }

  function selectAllFilteredSelectable() {
    setSelectedExpenseIds(
      new Set(visibleSelectableEntries.map((entry) => entry.id)),
    );
  }

  function resolveSelectedVisibleSelectableIds(): string[] {
    return visibleSelectableEntries
      .filter((entry) => selectedExpenseIds.has(entry.id))
      .map((entry) => entry.id);
  }

  function closeBulkProjectDialog() {
    setBulkProjectDialogOpen(false);
    setBulkProjectAssigning(false);
  }

  function openBulkProjectDialog() {
    setBulkProjectDialogKey((current) => current + 1);
    setBulkProjectDialogOpen(true);
  }

  async function handleBulkAssignProject(projectFormValue: string) {
    if (!isOnline || !navigator.onLine) {
      return;
    }
    const projectId = normalizeBulkAssignProjectFormValue(projectFormValue);
    const ids = resolveSelectedVisibleSelectableIds();
    if (ids.length === 0) {
      closeBulkProjectDialog();
      return;
    }

    setBulkProjectAssigning(true);
    try {
      const writeContext = await loadWriteBusinessUnitContext(supabase);
      if (!writeContext.ok) {
        void alertError(writeContext.error, { title: "Could not assign project" });
        closeBulkProjectDialog();
        return;
      }
      const { tenantId, error: tenantError } =
        await resolveSessionTenantId(supabase);
      if (tenantError || !tenantId) {
        void alertError(tenantError ?? "Unable to resolve workspace.", {
          title: "Could not assign project",
        });
        closeBulkProjectDialog();
        return;
      }

      const result = await bulkAssignExpenseRegisterProjectIds({
        supabase,
        tenantId,
        buReadScope,
        allowedUnits: writeContext.allowedUnits,
        entriesById: entriesByIdForBulk,
        expenseIds: ids,
        projectId,
      });

      if (result.failed.length === 0) {
        closeBulkProjectDialog();
        setSelectedExpenseIds(new Set());
        await refreshEntries();
        toast(`${result.succeededIds.length} expenses updated`);
        return;
      }

      if (result.succeededIds.length > 0) {
        await refreshEntries();
      }

      const failedVisible = result.failed
        .map((row) => row.id)
        .filter((id) =>
          visibleSelectableEntries.some((entry) => entry.id === id),
        );
      setSelectedExpenseIds(new Set(failedVisible));
      closeBulkProjectDialog();

      const failureLines = result.failed
        .slice(0, 8)
        .map((row) => `${row.id.slice(0, 8)}… — ${row.reason}`);
      const more =
        result.failed.length > 8
          ? `\n…and ${result.failed.length - 8} more.`
          : "";
      void alertError(
        `${result.succeededIds.length} updated, ${result.failed.length} failed.\n${failureLines.join("\n")}${more}`,
        { title: "Bulk assign partly failed" },
      );
    } catch (unexpected) {
      void alertError(
        unexpected instanceof Error
          ? unexpected.message
          : "Unable to assign project.",
        { title: "Could not assign project" },
      );
      closeBulkProjectDialog();
    } finally {
      setBulkProjectAssigning(false);
    }
  }

  useEffect(() => {
    if (fetchError) {
      void alertError(fetchError, { title: "Could not load expense register" });
    }
  }, [alertError, fetchError]);

  useEffect(() => {
    if (createLookups.error) {
      void alertError(createLookups.error, {
        title: "Could not load expense form options",
      });
    }
  }, [alertError, createLookups.error]);

  useEffect(() => {
    setEntries(initialEntries.map(normalizeExpenseRegisterEntry));
  }, [initialEntries]);

  useEffect(() => {
    void (async () => {
      try {
        const linked = await fetchLinkedProductSaleCogsByExpenseId(supabase);
        setLinkedProductSaleCogsByExpenseId(linked);
      } catch (loadError) {
        void alertError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load linked product sale COGS entries.",
          { title: "Could not load linked sales data" },
        );
      }
    })();
    // Load linked product-sale COGS map once on mount (shared client instance).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshLinkedApAccrualPayables(
    entryList: ExpenseRegisterEntry[],
  ) {
    const apIds = collectApIdsFromApAccrualExpenseEntries(entryList);
    if (apIds.length === 0) {
      setLinkedApAccrualPayables(new Map());
      setLinkedApAccrualPayablesLoaded(true);
      return;
    }
    setLinkedApAccrualPayablesLoaded(false);
    const map = await fetchLinkedAccountsPayableForApAccrualExpenses(
      supabase,
      buReadScope,
      apIds,
    );
    setLinkedApAccrualPayables(map);
    setLinkedApAccrualPayablesLoaded(true);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const apIds = apAccrualLinkedIdsKey
          ? apAccrualLinkedIdsKey.split("\0")
          : [];
        if (apIds.length === 0) {
          if (!cancelled) {
            setLinkedApAccrualPayables(new Map());
            setLinkedApAccrualPayablesLoaded(true);
          }
          return;
        }
        if (!cancelled) {
          setLinkedApAccrualPayablesLoaded(false);
        }
        const map = await fetchLinkedAccountsPayableForApAccrualExpenses(
          supabase,
          buReadScope,
          apIds,
        );
        if (!cancelled) {
          setLinkedApAccrualPayables(map);
          setLinkedApAccrualPayablesLoaded(true);
        }
      } catch (loadError) {
        if (!cancelled) {
          void alertError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load Accounts Payable status for accrual expenses.",
            { title: "Could not load payment status" },
          );
          setLinkedApAccrualPayablesLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apAccrualLinkedIdsKey, buReadScope, supabase]);

  async function refreshLinkedProductSaleCogs() {
    const linked = await fetchLinkedProductSaleCogsByExpenseId(supabase);
    setLinkedProductSaleCogsByExpenseId(linked);
  }

  async function refreshEntries() {
    const { data, error: refreshError } = await applyBusinessUnitScope(
      supabase.from("expense_register").select("*"),
      buReadScope,
    ).order("date", { ascending: false });

    if (refreshError) {
      void alertError(refreshError.message, {
        title: "Could not refresh expense register",
      });
      return;
    }

    const normalized =
      ((data as ExpenseRegisterEntry[] | null) ?? []).map((entry) =>
        normalizeExpenseRegisterEntry(entry),
      );
    setEntries(normalized);

    try {
      await refreshLinkedApAccrualPayables(normalized);
      await refreshLinkedProductSaleCogs();
    } catch (loadError) {
      void alertError(
        loadError instanceof Error
          ? loadError.message
          : "Could not refresh linked product sale COGS entries.",
        { title: "Could not refresh linked sales data" },
      );
    }
  }

  function closeExpenseDetail() {
    setDetailExpenseId(null);
    setDetailExpense(null);
    setDetailLoading(false);
  }

  async function openExpenseDetail(expenseId: string) {
    setDetailExpenseId(expenseId);
    const cached = entries.find((entry) => entry.id === expenseId) ?? null;
    setDetailExpense(cached);
    setDetailLoading(true);

    const { data, error: fetchError } = await applyBusinessUnitScope(
      supabase.from("expense_register").select("*").eq("id", expenseId),
      buReadScope,
    ).maybeSingle();

    setDetailLoading(false);

    if (fetchError) {
      void alertError(fetchError.message, {
        title: "Could not load expense details",
      });
      return;
    }

    if (!data) {
      void alertError(
        "Record not found or not accessible in this business view.",
        { title: "Could not load expense details" },
      );
      return;
    }

    setDetailExpense(normalizeExpenseRegisterEntry(data as ExpenseRegisterEntry));
  }

  useEffect(() => {
    const expenseId = searchParams.get("expenseId")?.trim();
    if (!expenseId || expenseIdFromQueryHandled.current === expenseId) {
      return;
    }
    expenseIdFromQueryHandled.current = expenseId;
    highlightRegisterTableRow(`expense-${expenseId}`);
    void openExpenseDetail(expenseId);
    router.replace("/dashboard/finance/expenses", { scroll: false });
  }, [searchParams, router]);

  function openAddForm() {
    setLoading(false);
    setEditingId(null);
    setWhtAmountEdited(false);
    setForm({
      ...emptyForm,
      payment_status: MANUAL_EXPENSE_REGISTER_PAYMENT_STATUS,
    });
    setShowForm(true);
  }

  function closeForm() {
    setLoading(false);
    setEditingId(null);
    setWhtAmountEdited(false);
    setForm(emptyForm);
    setShowForm(false);
  }

  function openEditForm(
    entry: ExpenseRegisterEntry & { pendingSync?: boolean },
  ) {
    if (entry.pendingSync) {
      void alertError(
        "Queued offline expenses sync as recorded. Discard and re-add to change them.",
        { title: "Cannot edit queued expense" },
      );
      return;
    }
    if (!isOnline) {
      void alertError("Editing saved expenses requires a connection.", {
        title: "Connection required",
      });
      return;
    }
    const linkedProductSaleCogs = linkedProductSaleCogsByExpenseId.get(
      entry.id,
    );
    if (linkedProductSaleCogs) {
      void alertError(formatLinkedProductSaleCogsDeleteMessage(linkedProductSaleCogs), {
        title: "Cannot edit expense",
      });
      return;
    }

    const editLockMessage = resolveExpenseRegisterLockMessage(entry);
    if (editLockMessage) {
      void alertError(editLockMessage, { title: "Cannot edit expense" });
      return;
    }
    setEditingId(entry.id);
    setWhtAmountEdited(false);
    const vendorState = inferVendorSelectState(entry.vendor, suppliers);
    const hasTax =
      (entry.wht_rate ?? 0) > 0 ||
      (entry.wht_amount ?? 0) > 0 ||
      (entry.input_vat_amount ?? 0) > 0;
    setForm({
      date: toDateInputValue(entry.date),
      expense_category: entry.expense_category,
      sub_category: entry.sub_category,
      description: entry.description ?? "",
      vendor_select: vendorState.vendorSelect,
      vendor_other: vendorState.vendorOther,
      price: String(entry.price),
      quantity: String(entry.quantity),
      payment_method: entry.payment_method,
      approved_by: entry.approved_by,
      receipt_no: entry.receipt_no,
      payment_status: entry.payment_status,
      has_wht_vat: hasTax,
      wht_rate: hasTax ? formatRateValue(entry.wht_rate ?? 0) : "0",
      wht_amount: entry.wht_amount == null ? "" : String(entry.wht_amount),
      input_vat_amount:
        entry.input_vat_amount == null || entry.input_vat_amount === 0
          ? ""
          : String(entry.input_vat_amount),
      notes: entry.notes ?? "",
      project_id: initialExpenseRegisterProjectFormValue(
        entry.project_id,
        initialProjects,
      ),
    });
    setLoading(false);
    setShowForm(true);
  }

  async function handleMarkAsPaid(entry: ExpenseRegisterEntry) {
    if (!canMarkAutoPostedExpenseAsPaid(entry)) {
      return;
    }

    const essnit = isPayrollEssnitExpense(entry);
    const confirmMessage = essnit
      ? `Mark this Employer SSNIT expense as Paid? This posts a Cash Position outflow for ${formatGHS(entry.amount)} and remits matching employer SSNIT Tax Ledger legs (Tier 1 + Tier 2) for the payroll period. Employee SSNIT remains open — use Statutory Ledger → Remit SSNIT for period for the remaining employee remittance (employer cash will not be posted again).`
      : `Mark this Staff Salaries expense as Paid? This posts a Cash Position outflow for ${formatGHS(entry.amount)} and clears Accrued Wages for the period.`;

    if (!(await confirmDialog({ message: confirmMessage }))) {
      return;
    }

    setMarkingPaidId(entry.id);

    const result = await markAutoPostedExpensePaid(supabase, entry);
    if (result.error) {
      void alertError(result.error, { title: "Could not mark expense as paid" });
      setMarkingPaidId(null);
      await refreshEntries();
      return;
    }

    await refreshEntries();
    toast("Expense marked as paid.");
    setMarkingPaidId(null);
  }

  async function handleDelete(id: string) {
    const target = entries.find((entry) => entry.id === id);
    const pending = (writeQueue?.items ?? []).find(
      (item) => item.id === id && item.type === "expense",
    );
    if (pending) {
      if (!(await confirmDeleteEntry())) return;
      setDeletingId(id);
      await writeQueue?.discardItem(id);
      setDeletingId(null);
      return;
    }

    if (!isOnline) {
      void alertError("Deleting saved expenses requires a connection.", {
        title: "Connection required",
      });
      return;
    }

    if (target) {
      const deleteLockMessage = resolveExpenseRegisterLockMessage(target);
      if (deleteLockMessage) {
        void alertError(deleteLockMessage, { title: "Cannot delete expense" });
        return;
      }
    }

    const knownLink = linkedProductSaleCogsByExpenseId.get(id);
    if (knownLink) {
      void alertError(formatLinkedProductSaleCogsDeleteMessage(knownLink), {
        title: "Cannot delete expense",
      });
      return;
    }

    if (!(await confirmDeleteEntry())) {
      return;
    }

    setDeletingId(id);

    const buContext = await loadWriteBusinessUnitContext(supabase);
    if (!buContext.ok) {
      void alertError(buContext.error, { title: "Cannot delete expense" });
      setDeletingId(null);
      return;
    }

    try {
      assertCanModifyBusinessUnitRow(
        buContext.allowedUnits,
        (target as { business_unit_id?: string | null } | undefined)
          ?.business_unit_id,
      );
    } catch (accessError) {
      void alertError(formatBusinessUnitAccessError(accessError), {
        title: "Cannot delete expense",
      });
      setDeletingId(null);
      return;
    }

    let linkedProductSaleCogs: LinkedProductSaleCogs | null = null;
    try {
      linkedProductSaleCogs = await lookupLinkedProductSaleCogsForExpense(
        supabase,
        id,
      );
    } catch (lookupError) {
      void alertError(
        lookupError instanceof Error
          ? lookupError.message
          : "Could not verify whether this expense is linked to a product sale.",
        { title: "Could not delete expense" },
      );
      setDeletingId(null);
      return;
    }

    if (linkedProductSaleCogs) {
      setLinkedProductSaleCogsByExpenseId((current) => {
        const next = new Map(current);
        next.set(id, linkedProductSaleCogs!);
        return next;
      });
      void alertError(
        formatLinkedProductSaleCogsDeleteMessage(linkedProductSaleCogs),
        { title: "Cannot delete expense" },
      );
      setDeletingId(null);
      return;
    }

    const { error: deleteError } = await supabase
      .from("expense_register")
      .delete()
      .eq("id", id);

    if (deleteError) {
      if (isIncomeRegisterCogsExpenseFkError(deleteError)) {
        try {
          const fallbackLink = await lookupLinkedProductSaleCogsForExpense(
            supabase,
            id,
          );
          if (fallbackLink) {
            setLinkedProductSaleCogsByExpenseId((current) => {
              const next = new Map(current);
              next.set(id, fallbackLink);
              return next;
            });
            void alertError(
              formatLinkedProductSaleCogsDeleteMessage(fallbackLink),
              { title: "Cannot delete expense" },
            );
          } else {
            void alertError(
              "This expense is linked to a product sale and cannot be deleted directly. Cancel the original sale from Sales & CRM → Sales instead.",
              { title: "Cannot delete expense" },
            );
          }
        } catch {
          void alertError(
            "This expense is linked to a product sale and cannot be deleted directly. Cancel the original sale from Sales & CRM → Sales instead.",
            { title: "Cannot delete expense" },
          );
        }
      } else {
        void alertError(deleteError.message, { title: "Could not delete expense" });
      }
      setDeletingId(null);
      return;
    }

    const { error: ledgerError } = await deleteTaxLedgerEntriesForSource(
      supabase,
      "expense_register",
      id,
    );

    if (ledgerError) {
      void alertError(
        `Entry deleted, but its tax ledger entries could not be removed: ${ledgerError}`,
        { title: "Expense deleted with warnings" },
      );
    } else {
      toast("Expense deleted.");
    }

    if (editingId === id) {
      closeForm();
    }

    await refreshEntries();
    setDeletingId(null);
  }

  function buildExpenseRegisterValidityControls(): ExpenseRegisterFormValidityControls {
    const subCategoryRoot = subCategoryFieldRef.current;
    const supplierRoot = supplierFieldsRef.current;
    return {
      date: dateInputRef.current,
      expenseCategory: expenseCategorySelectRef.current,
      project: projectSelectRef.current,
      subCategory: subCategoryRoot?.querySelector("select") ?? null,
      vendorSelect: supplierRoot?.querySelector("select") ?? null,
      vendorOther:
        supplierRoot?.querySelector<HTMLInputElement>('input[type="text"]') ??
        null,
      price: priceInputRef.current,
      quantity: quantityInputRef.current,
      paymentStatus: paymentStatusSelectRef.current,
    };
  }

  function clearNativeValidity(
    control: HTMLInputElement | HTMLSelectElement | null | undefined,
  ) {
    control?.setCustomValidity("");
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const formElement = expenseFormRef.current;
    if (!formElement) {
      return;
    }

    const editingEntry = editingId
      ? entries.find((entry) => entry.id === editingId)
      : null;
    const validatePaymentStatus =
      !editingEntry || !isSystemManagedExpenseRegisterRow(editingEntry);

    syncExpenseRegisterFormCustomValidity(
      buildExpenseRegisterValidityControls(),
      {
        form,
        editingId,
        hasActiveExpenseProjects,
        validatePaymentStatus,
        expenseCategories,
        expenseSubcategories,
      },
    );

    if (!formElement.reportValidity()) {
      return;
    }

    const projectIdResult = resolveExpenseRegisterProjectIdForSave(
      form.project_id,
      hasActiveExpenseProjects,
    );
    if (!projectIdResult.ok) {
      return;
    }

    const vendorName = resolveVendorNameFromSelect(
      form.vendor_select,
      form.vendor_other,
      suppliers,
    );

    setLoading(true);

    try {
    const buContext = await loadWriteBusinessUnitContext(supabase);
    if (!buContext.ok) {
      void alertError(buContext.error, { title: "Could not save expense" });
      return;
    }

    let stampId: string | null = null;
    if (editingId) {
      const existingEntry = entries.find((entry) => entry.id === editingId);
      try {
        assertCanModifyBusinessUnitRow(
          buContext.allowedUnits,
          (existingEntry as { business_unit_id?: string | null } | undefined)
            ?.business_unit_id,
        );
      } catch (accessError) {
        void alertError(formatBusinessUnitAccessError(accessError), {
          title: "Could not save expense",
        });
        return;
      }
    } else {
      const stampResult = resolveWriteBusinessUnitIdForCreate({
        allowedUnits: buContext.allowedUnits,
        stamp: stampBusinessUnit,
      });
      if (!stampResult.ok) {
        void alertError(stampResult.error, { title: "Could not save expense" });
        return;
      }
      stampId = stampResult.businessUnitId;
    }

    const price = Number(form.price);
    const quantity = form.quantity.trim() === "" ? 1 : Number(form.quantity);
    const grossBeforeWht = calculateAmount(price, quantity);

    const whtRate = form.has_wht_vat ? Number(form.wht_rate) || 0 : 0;
    const whtAmount = form.has_wht_vat
      ? Math.max(0, roundTaxAmount(Number(form.wht_amount) || 0))
      : 0;
    const inputVatAmount = form.has_wht_vat
      ? Math.max(0, roundTaxAmount(Number(form.input_vat_amount) || 0))
      : 0;
    const purchaseTax = computePurchaseTaxAmounts({
      grossBeforeWht,
      whtRatePct: whtRate,
      whtAmount,
      inputVatAmount,
    });

    const offlineNow = !isOnline || !navigator.onLine;

    let receiptNo = form.receipt_no.trim();
    if (!editingId && !offlineNow) {
      // Create only: blank → generate_next_code('EXP'); filled → keep vendor paper receipt #.
      const resolved = await resolveManualExpenseReceiptNo(supabase, form.receipt_no);
      if (resolved.error || !resolved.receiptNo) {
        void alertError(
          resolved.error ?? "Unable to allocate receipt number.",
          { title: "Could not save expense" },
        );
        return;
      }
      receiptNo = resolved.receiptNo;
    }

    // amount = net paid to supplier (gross − WHT); price×qty remains the gross line.
    const payload = {
      date: form.date,
      expense_category: form.expense_category,
      sub_category: form.sub_category,
      description: form.description || null,
      vendor: vendorName,
      price,
      quantity,
      amount: purchaseTax.netPaidToSupplier,
      payment_method: form.payment_method,
      approved_by: form.approved_by,
      receipt_no: receiptNo,
      payment_status: form.payment_status,
      gross_before_wht: purchaseTax.grossBeforeWht,
      wht_rate: whtRate > 0 ? whtRate : null,
      wht_amount: purchaseTax.whtAmount,
      input_vat_amount: purchaseTax.inputVatAmount,
      net_of_tax_amount: purchaseTax.netOfTaxAmount,
      notes: form.notes || null,
      project_id: projectIdResult.projectId,
    };

    if (offlineNow) {
      if (editingId) {
        void alertError("Editing saved expenses requires a connection.", {
          title: "Connection required",
        });
        return;
      }
      const session =
        writeQueue?.session ?? (await resolveClientCacheSession());
      if (!session) {
        void alertError("Unable to queue offline — session not available.", {
          title: "Could not queue expense",
        });
        return;
      }
      const queuePayload: ExpenseQueuePayload = {
        date: payload.date,
        expense_category: payload.expense_category,
        sub_category: payload.sub_category,
        description: payload.description,
        vendor: payload.vendor,
        price: payload.price,
        quantity: payload.quantity,
        amount: payload.amount,
        payment_method: payload.payment_method,
        approved_by: payload.approved_by,
        supplied_receipt_no: form.receipt_no.trim(),
        payment_status: payload.payment_status,
        gross_before_wht: payload.gross_before_wht,
        wht_rate: payload.wht_rate,
        wht_amount: payload.wht_amount,
        input_vat_amount: payload.input_vat_amount,
        net_of_tax_amount: payload.net_of_tax_amount,
        notes: payload.notes,
        project_id: payload.project_id,
        business_unit_id: stampId,
        wht_rate_pct: whtRate > 0 ? whtRate : null,
        input_tax_component: purchaseTax.inputTaxComponent,
        notification_detail: formatGHS(purchaseTax.netPaidToSupplier),
      };
      try {
        await enqueueWriteQueueItem({
          session,
          type: "expense",
          payload: queuePayload,
        });
      } catch (queueError) {
        void alertError(
          queueError instanceof Error
            ? queueError.message
            : "Unable to queue the expense entry.",
          { title: "Could not queue expense" },
        );
        return;
      }
      try {
        await writeQueue?.refresh();
      } catch {
        // Entry is queued; list refresh on reconnect is enough if queue UI fails to reload.
      }
      closeForm();
      toast("Expense queued for sync.");
      return;
    }

    let savedId = editingId;
    let linkedApProjectSyncError: string | null = null;

    if (editingId) {
      const { error: updateError } = await supabase
        .from("expense_register")
        .update(payload)
        .eq("id", editingId);

      if (updateError) {
        void alertError(updateError.message, { title: "Could not save expense" });
        return;
      }

      const linkedApId = parseAccountsPayableIdFromAccrualReceiptNo(receiptNo);
      const previousProjectId = normalizeExpenseRegisterProjectIdForDatabase(
        editingEntry?.project_id,
      );
      const nextProjectId = projectIdResult.projectId;
      if (
        linkedApId &&
        previousProjectId !== nextProjectId
      ) {
        const { tenantId, error: tenantError } =
          await resolveSessionTenantId(supabase);
        if (tenantError || !tenantId) {
          linkedApProjectSyncError =
            tenantError ?? "Unable to resolve workspace.";
        } else {
          const { error: apProjectError } = await applyBusinessUnitScope(
            supabase
              .from("accounts_payable")
              .update({ project_id: nextProjectId })
              .eq("id", linkedApId)
              .eq("tenant_id", tenantId),
            buReadScope,
          );
          if (apProjectError) {
            linkedApProjectSyncError = apProjectError.message;
          }
        }
      }
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from("expense_register")
        .insert({
          ...payload,
          business_unit_id: stampId,
        })
        .select("id")
        .single();

      if (insertError || !inserted) {
        void alertError(
          insertError?.message ?? "Unable to save the expense entry.",
          { title: "Could not save expense" },
        );
        return;
      }

      savedId = (inserted as { id: string }).id;

      requestTenantAdminDirectorNotification({
        title: "New expense recorded",
        detail: formatGHS(purchaseTax.netPaidToSupplier),
        actionUrl: "/dashboard/finance/expenses",
      });
    }

    const { error: ledgerError } = await syncPurchaseTaxLedger(supabase, {
      sourceType: "expense_register",
      sourceId: savedId as string,
      entryDate: form.date,
      grossBeforeWht: purchaseTax.grossBeforeWht,
      whtRatePct: whtRate > 0 ? whtRate : null,
      whtAmount: purchaseTax.whtAmount,
      inputTaxComponent: purchaseTax.inputTaxComponent,
      inputTaxRatePct: null,
      inputVatAmount: purchaseTax.inputVatAmount,
      counterpartyName: vendorName || null,
      notes: receiptNo ? `Receipt ${receiptNo}` : null,
      businessUnitId: stampId,
    });

    closeForm();
    await refreshEntries();
    try {
      await writeQueue?.refresh();
    } catch {
      // Saved online; queue badge refresh is non-blocking.
    }

    if (linkedApProjectSyncError) {
      void alertError(linkedApProjectSyncError, {
        title:
          "Expense saved, but the linked bill's Contract / Project could not be updated",
      });
    } else if (ledgerError) {
      void alertError(
        `Entry saved, but the tax ledger could not be updated: ${ledgerError}`,
        { title: "Expense saved with warnings" },
      );
    } else {
      toast(editingId ? "Expense updated." : "Expense saved.");
    }
    } catch (unexpected) {
      void alertError(
        unexpected instanceof Error
          ? unexpected.message
          : "Unable to save the expense entry.",
        { title: "Could not save expense" },
      );
    } finally {
      setLoading(false);
    }
  }

  function updateField<K extends keyof ExpenseFormState>(
    field: K,
    value: ExpenseFormState[K],
  ) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function toggleHasWhtVat(checked: boolean) {
    setWhtAmountEdited(false);
    setForm((current) => ({
      ...current,
      has_wht_vat: checked,
      wht_rate: checked ? defaultWhtRate : "0",
      wht_amount: checked
        ? formatWhtAmount(currentGrossString(current), defaultWhtRate)
        : "",
      input_vat_amount: checked ? current.input_vat_amount : "",
    }));
  }

  function currentGrossString(next?: Partial<ExpenseFormState>): string {
    const price = Number(next?.price ?? form.price) || 0;
    const quantityRaw = (next?.quantity ?? form.quantity).trim();
    const quantity = quantityRaw === "" ? 1 : Number(quantityRaw) || 1;
    return String(calculateAmount(price, quantity));
  }

  function updatePrice(value: string) {
    clearNativeValidity(priceInputRef.current);
    setForm((current) => {
      const next = { ...current, price: value };
      const gross = currentGrossString(next);
      return {
        ...next,
        wht_amount: whtAmountEdited
          ? current.wht_amount
          : formatWhtAmount(gross, current.wht_rate),
      };
    });
  }

  function updateQuantity(value: string) {
    clearNativeValidity(quantityInputRef.current);
    setForm((current) => {
      const next = { ...current, quantity: value };
      const gross = currentGrossString(next);
      return {
        ...next,
        wht_amount: whtAmountEdited
          ? current.wht_amount
          : formatWhtAmount(gross, current.wht_rate),
      };
    });
  }

  function updateWhtRate(value: string) {
    setWhtAmountEdited(false);
    setForm((current) => ({
      ...current,
      wht_rate: value,
      wht_amount: formatWhtAmount(currentGrossString(current), value),
    }));
  }

  function updateWhtAmount(value: string) {
    setWhtAmountEdited(true);
    setForm((current) => ({ ...current, wht_amount: value }));
  }

  const previewGross = calculateAmount(
    Number(form.price) || 0,
    form.quantity.trim() === "" ? 1 : Number(form.quantity) || 1,
  );
  const previewPurchaseTax = computePurchaseTaxAmounts({
    grossBeforeWht: previewGross,
    whtRatePct: form.has_wht_vat ? Number(form.wht_rate) || 0 : 0,
    whtAmount: form.has_wht_vat
      ? Math.max(0, roundTaxAmount(Number(form.wht_amount) || 0))
      : 0,
    inputVatAmount: form.has_wht_vat
      ? Math.max(0, roundTaxAmount(Number(form.input_vat_amount) || 0))
      : 0,
  });

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          Track expenses, receipts, and payment status.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/dashboard/bulk-import?type=expense"
            className="rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50"
          >
            Bulk Import
          </Link>
          <button
            type="button"
            onClick={() => (showForm ? closeForm() : openAddForm())}
            className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
          >
            {showForm ? "Cancel" : "Add Entry"}
          </button>
        </div>
      </div>

      {!isOnline ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Offline — new expenses are saved to the sync queue (receipt numbers
          and tax ledger post on reconnect). Edits/deletes of confirmed rows need
          a connection.
        </p>
      ) : null}

      {showForm && (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-[#0f2744]">
            {editingId ? "Edit Expense Entry" : "New Expense Entry"}
          </h2>
          <form
            ref={expenseFormRef}
            onSubmit={handleSubmit}
            className="space-y-4"
          >
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div className="md:col-span-2 xl:col-span-3">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Expense Name
                </label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => updateField("description", e.target.value)}
                  className={expenseRegisterInputClassName()}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Date
                </label>
                <input
                  ref={dateInputRef}
                  type="date"
                  required
                  value={form.date}
                  onChange={(e) => {
                    updateField("date", e.target.value);
                    clearNativeValidity(dateInputRef.current);
                  }}
                  className={expenseRegisterInputClassName()}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Expense Category
                </label>
                <select
                  ref={expenseCategorySelectRef}
                  required={!editingId}
                  value={form.expense_category}
                  onChange={(e) => {
                    const value = e.target.value;
                    setForm((current) => ({
                      ...current,
                      expense_category: value,
                      sub_category: "",
                    }));
                    clearNativeValidity(expenseCategorySelectRef.current);
                    clearNativeValidity(
                      subCategoryFieldRef.current?.querySelector("select"),
                    );
                  }}
                  className={expenseRegisterInputClassName()}
                  disabled={createLookups.loading}
                >
                  <option value="">Select category</option>
                  {expenseCategorySelectOptions.map((category) => (
                    <option key={category.name} value={category.name}>
                      {lookupOptionLabel(category.name, category.is_active)}
                    </option>
                  ))}
                </select>
                {!editingId ? (
                  <p className="mt-1 text-xs text-slate-500">
                    Buying an asset? Record it in Finance → Fixed Assets.
                  </p>
                ) : null}
              </div>
              {hasActiveExpenseProjects ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Contract / Project
                  </label>
                  <select
                    ref={projectSelectRef}
                    required
                    value={form.project_id}
                    onChange={(e) => {
                      updateField("project_id", e.target.value);
                      clearNativeValidity(projectSelectRef.current);
                    }}
                    className={expenseRegisterInputClassName()}
                  >
                    <option value="">Select contract or project…</option>
                    <option value={EXPENSE_REGISTER_PROJECT_OVERHEAD_VALUE}>
                      Company overhead (not tied to a contract)
                    </option>
                    {expenseFormProjectOptions.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.project_code} — {project.project_name}
                        {project.is_archived ? " (Inactive)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div ref={subCategoryFieldRef}>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Sub-Category
                </label>
                <ExpenseRegisterSubCategorySelect
                  expenseCategory={form.expense_category}
                  value={form.sub_category}
                  onChange={(value) => {
                    updateField("sub_category", value);
                    clearNativeValidity(
                      subCategoryFieldRef.current?.querySelector("select"),
                    );
                  }}
                  allSubcategories={expenseSubcategories}
                  expenseCategories={expenseCategories}
                  disabled={createLookups.loading}
                />
              </div>
              <div ref={supplierFieldsRef} className="contents">
                <ExpenseRegisterSupplierFields
                  vendorSelect={form.vendor_select}
                  vendorOther={form.vendor_other}
                  onVendorSelectChange={(value) => {
                    updateField("vendor_select", value);
                    clearNativeValidity(
                      supplierFieldsRef.current?.querySelector("select"),
                    );
                    clearNativeValidity(
                      supplierFieldsRef.current?.querySelector<HTMLInputElement>(
                        'input[type="text"]',
                      ),
                    );
                  }}
                  onVendorOtherChange={(value) => {
                    updateField("vendor_other", value);
                    clearNativeValidity(
                      supplierFieldsRef.current?.querySelector<HTMLInputElement>(
                        'input[type="text"]',
                      ),
                    );
                  }}
                  suppliers={toVendorSupplierOptions(suppliers)}
                  disabled={createLookups.loading}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Price
                </label>
                <input
                  ref={priceInputRef}
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={form.price}
                  onChange={(e) => updatePrice(e.target.value)}
                  className={expenseRegisterInputClassName()}
                />
                <p className="mt-1 text-xs text-slate-500">
                  Unit price before WHT (gross line = Price × Quantity).
                </p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Quantity
                </label>
                <input
                  ref={quantityInputRef}
                  type="number"
                  min="1"
                  step="1"
                  value={form.quantity}
                  onChange={(e) => updateQuantity(e.target.value)}
                  placeholder="1"
                  className={expenseRegisterInputClassName()}
                />
              </div>
              <div className="md:col-span-2 xl:col-span-3">
                <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.has_wht_vat}
                    onChange={(e) => toggleHasWhtVat(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-[#0f2744] focus:ring-[#0f2744]"
                  />
                  This expense has WHT/VAT
                </label>
              </div>
              {form.has_wht_vat ? (
                <>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">
                      WHT Rate
                    </label>
                    <select
                      value={form.wht_rate}
                      onChange={(e) => updateWhtRate(e.target.value)}
                      className={expenseRegisterInputClassName()}
                    >
                      {whtRateOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">
                      WHT Amount
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.wht_amount}
                      onChange={(e) => updateWhtAmount(e.target.value)}
                      className={expenseRegisterInputClassName()}
                    />
                    <p className="mt-1 text-xs text-slate-500">
                      Auto-calculated from Gross × rate. Edit to match the
                      withholding certificate.
                    </p>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">
                      Input VAT Amount
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.input_vat_amount}
                      onChange={(e) =>
                        updateField("input_vat_amount", e.target.value)
                      }
                      className={expenseRegisterInputClassName()}
                    />
                    <p className="mt-1 text-xs text-slate-500">
                      Optional — VAT/NHIL/GETFund on this purchase (reclaimable
                      input credit).
                    </p>
                  </div>
                </>
              ) : null}
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Payment Method
                </label>
                <select
                  required
                  value={form.payment_method}
                  onChange={(e) => updateField("payment_method", e.target.value)}
                  className={expenseRegisterInputClassName()}
                >
                  <option value="">Select payment method</option>
                  {paymentMethods.map((method) => (
                    <option key={method.name} value={method.name}>
                      {method.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Approved By
                </label>
                <select
                  required
                  value={form.approved_by}
                  onChange={(e) => updateField("approved_by", e.target.value)}
                  className={expenseRegisterInputClassName()}
                >
                  <option value="">Select approver</option>
                  {approvers.map((approver) => (
                    <option key={approver.employee_id} value={approver.full_name}>
                      {approver.full_name}
                    </option>
                  ))}
                </select>
              </div>
              <ExpenseRegisterReceiptNoField
                value={form.receipt_no}
                onChange={(value) => updateField("receipt_no", value)}
                isCreate={!editingId}
                disabled={createLookups.loading}
              />
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Payment Status
                </label>
                <select
                  ref={paymentStatusSelectRef}
                  required
                  value={
                    form.payment_status ||
                    MANUAL_EXPENSE_REGISTER_PAYMENT_STATUS
                  }
                  onChange={(e) => {
                    updateField("payment_status", e.target.value);
                    clearNativeValidity(paymentStatusSelectRef.current);
                  }}
                  className={expenseRegisterInputClassName()}
                >
                  {manualPaymentStatusOptions.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
                {!editingId ? (
                  <p className="mt-1 text-xs text-slate-500">
                    Not paid yet? Record it in{" "}
                    <Link
                      href="/dashboard/finance/accounts-payable"
                      className="font-medium text-[#0f2744] underline hover:text-[#1a3a5c]"
                    >
                      Finance → Accounts Payable
                    </Link>{" "}
                    so the amount owed is tracked.
                  </p>
                ) : null}
              </div>
              <div className="md:col-span-2 xl:col-span-3">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Notes
                </label>
                <textarea
                  rows={3}
                  value={form.notes}
                  onChange={(e) => updateField("notes", e.target.value)}
                  className={expenseRegisterInputClassName()}
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-600">
              <p>
                Gross (before WHT):{" "}
                <span className="font-medium text-[#0f2744]">
                  {formatGHS(previewPurchaseTax.grossBeforeWht)}
                </span>
              </p>
              <p>
                Net paid to supplier:{" "}
                <span className="font-medium text-[#0f2744]">
                  {formatGHS(previewPurchaseTax.netPaidToSupplier)}
                </span>{" "}
                <span className="text-xs text-slate-500">
                  (Gross − WHT — cash outflow / amount saved)
                </span>
              </p>
            </div>

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={loading}
                className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading
                  ? "Saving…"
                  : editingId
                    ? "Save Changes"
                    : isOnline
                      ? "Save Entry"
                      : "Queue Entry"}
              </button>
              <button
                type="button"
                onClick={closeForm}
                disabled={loading}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}

      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-3">
          <FilteredListCount
            filteredCount={visibleEntries.length}
            totalCount={entries.length}
            itemSingular="entry"
            hasActiveFilters={hasActiveListFilters}
          />
          {hasActiveListFilters && visibleSelectableEntries.length > 0 ? (
            <button
              type="button"
              onClick={selectAllFilteredSelectable}
              className="text-sm font-medium text-[#0f2744] underline hover:text-[#1a3a5c]"
            >
              Select all {visibleSelectableEntries.length} filtered
            </button>
          ) : null}
        </div>
        {selectedBulkCount === 0 ? (
          <p className="text-sm text-slate-500">
            Tick the boxes in the &quot;Select&quot; column to assign a Contract /
            Project to many expenses at once.
          </p>
        ) : null}
      </div>

      {selectedBulkCount > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-[#0f2744]/20 bg-[#0f2744]/5 px-4 py-3 text-sm">
          <span className="font-medium text-[#0f2744]">
            {selectedBulkCount} selected · {formatGHS(selectedBulkTotal)}
          </span>
          {!isOnline || !navigator.onLine ? (
            <Tooltip content="Bulk assign requires an internet connection.">
              <span className="inline-block">
                <button
                  type="button"
                  disabled
                  className="cursor-not-allowed rounded-md bg-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600"
                >
                  Assign Contract / Project
                </button>
              </span>
            </Tooltip>
          ) : (
            <button
              type="button"
              onClick={openBulkProjectDialog}
              className="rounded-md bg-[#0f2744] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#1a3a5c]"
            >
              Assign Contract / Project
            </button>
          )}
          <button
            type="button"
            onClick={() => setSelectedExpenseIds(new Set())}
            className="text-sm font-medium text-slate-600 underline hover:text-slate-900"
          >
            Clear selection
          </button>
        </div>
      ) : null}

      <ScrollableTable stickyEdgeLayout="nameCategory">
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={`${scrollableTableThClassName} px-2`}>
                  <span className="inline-flex items-center gap-1.5">
                    <span>Select</span>
                    <Tooltip content="Select expenses to assign a Contract / Project in bulk">
                      <span className="inline-flex">
                        <input
                          type="checkbox"
                          aria-label="Select all visible expenses"
                          checked={allVisibleSelectableSelected}
                          ref={(element) => {
                            if (element) {
                              element.indeterminate =
                                someVisibleSelectableSelected &&
                                !allVisibleSelectableSelected;
                            }
                          }}
                          disabled={visibleSelectableEntries.length === 0}
                          onChange={(event) =>
                            toggleSelectAllVisibleSelectable(
                              event.target.checked,
                            )
                          }
                          className="h-4 w-4 rounded border-slate-300"
                        />
                      </span>
                    </Tooltip>
                  </span>
                </th>
                <th
                  className={`${scrollableTableThClassName} ${scrollableTableNoTruncateCellClassName} scrollable-table-register-col-date`}
                >
                  <RegisterDateRangeFilterHeader
                    label="Date"
                    applied={dateFilter}
                    onApply={setDateFilter}
                    sort={columnSortConfig("date", "date")}
                  />
                </th>
                <th className={scrollableTableRegisterStickyNameThClassName}>
                  <RegisterColumnFilterHeader
                    label="Expense Name"
                    options={descriptionOptions}
                    applied={descriptionFilter}
                    onApply={setDescriptionFilter}
                    sort={columnSortConfig("description", "text")}
                  />
                </th>
                <th className={scrollableTableRegisterCategoryThClassName}>
                  <RegisterColumnFilterHeader
                    label="Expense Category"
                    options={categoryOptions}
                    applied={categoryFilter}
                    onApply={setCategoryFilter}
                    sort={columnSortConfig("expense_category", "text")}
                  />
                </th>
                <th className={scrollableTableThClassName}>
                  <RegisterColumnFilterHeader
                    label="Contract / Project"
                    options={projectSiteOptions}
                    applied={projectSiteFilter}
                    onApply={setProjectSiteFilter}
                    sort={columnSortConfig("project_site", "text")}
                  />
                </th>
                <th className={scrollableTableThClassName}>
                  <RegisterColumnFilterHeader
                    label="Sub-Category"
                    options={subCategoryOptions}
                    applied={subCategoryFilter}
                    onApply={setSubCategoryFilter}
                    sort={columnSortConfig("sub_category", "text")}
                  />
                </th>
                <th className={scrollableTableThClassName}>Supplier</th>
                <th className={scrollableTableThClassName}>Gross</th>
                <th className={scrollableTableThClassName}>WHT</th>
                <th className={scrollableTableThClassName}>Net Paid</th>
                <th className={scrollableTableThClassName}>Payment Method</th>
                <th className={scrollableTableThClassName}>
                  <RegisterColumnFilterHeader
                    label="Payment Status"
                    options={paymentStatusOptions}
                    applied={paymentStatusFilter}
                    onApply={setPaymentStatusFilter}
                    sort={columnSortConfig("payment_status", "text")}
                  />
                </th>
                <th className={scrollableTableThClassName}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {entries.length === 0 ? (
                <tr>
                  <td
                    colSpan={13}
                    className="px-4 py-8 text-center text-slate-500"
                  >
                    No expense register entries yet.
                  </td>
                </tr>
              ) : visibleEntries.length === 0 ? (
                <tr>
                  <td
                    colSpan={13}
                    className="px-4 py-8 text-center text-slate-500"
                  >
                    No entries match the current filters.
                  </td>
                </tr>
              ) : (
                visibleEntries.map((entry, index) => {
                  const gross = getExpenseGrossBeforeWht(entry);
                  const customerRefund = isCustomerRefundCashOutflowExpense(entry);
                  const autoPosted = isAutoPostedExpenseRegisterEntry(entry);
                  const linkedProductSaleCogs =
                    linkedProductSaleCogsByExpenseId.get(entry.id) ?? null;
                  const systemLinked =
                    isSystemManagedExpenseRegisterRow(entry) ||
                    linkedProductSaleCogs != null;
                  const showMarkPaid = canMarkAutoPostedExpenseAsPaid(entry);
                  const deleteBlockedMessage = customerRefund
                    ? customerRefundExpenseLockMessage()
                    : linkedProductSaleCogs
                      ? formatLinkedProductSaleCogsDeleteMessage(
                          linkedProductSaleCogs,
                        )
                      : undefined;
                  const registerLockMessage =
                    resolveExpenseRegisterLockMessage(entry);
                  const apAccrualRow = isApAccrualExpenseRegisterRow(entry);
                  const apAccrualStatus = apAccrualRow
                    ? resolveApAccrualPaymentStatusDisplay(
                        entry,
                        linkedApAccrualPayables,
                        linkedApAccrualDisplayOptions,
                      )
                    : null;

                  const selectionBlock = explainExpenseBulkProjectSelectionBlock(
                    entry as ExpenseRegisterEntry & { pendingSync?: boolean },
                  );
                  const isSelected = selectedExpenseIds.has(entry.id);

                  return (
                    <tr
                      key={entry.id}
                      id={`expense-${entry.id}`}
                      className={getRegisterRowClassName(index, systemLinked)}
                    >
                      <td className="px-2 py-3">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="invisible" aria-hidden>
                            Select
                          </span>
                          {selectionBlock ? (
                            <Tooltip
                              content={expenseBulkProjectSelectionBlockTooltip(
                                selectionBlock,
                              )}
                            >
                              <span className="inline-flex">
                                <input
                                  type="checkbox"
                                  disabled
                                  aria-label="Cannot select this expense"
                                  className="h-4 w-4 cursor-not-allowed rounded border-slate-200 opacity-50"
                                />
                              </span>
                            </Tooltip>
                          ) : (
                            <input
                              type="checkbox"
                              aria-label={`Select expense ${entry.description ?? entry.id}`}
                              checked={isSelected}
                              onChange={(event) =>
                                toggleExpenseSelected(
                                  entry.id,
                                  event.target.checked,
                                )
                              }
                              className="h-4 w-4 rounded border-slate-300"
                            />
                          )}
                        </span>
                      </td>
                      <td className={scrollableTableRegisterDateCellClassName}>
                        {formatDate(entry.date)}
                      </td>
                      <td
                        className={`${scrollableTableRegisterStickyNameWrapTdClassName({
                          striped: index % 2 === 1,
                        })} ${registerTruncatedCellHostClassName}`}
                      >
                        <RegisterRecordNameLink
                          onOpen={() => void openExpenseDetail(entry.id)}
                        >
                          <TruncatedCell>
                            {entry.description ?? "—"}
                          </TruncatedCell>
                        </RegisterRecordNameLink>
                        {"pendingSync" in entry && entry.pendingSync ? (
                          "queueError" in entry &&
                          (entry.queueError as string | null)?.trim() ? (
                            <Tooltip
                              content={String(entry.queueError).trim()}
                            >
                              <span
                                className={`ml-2 inline-flex rounded px-1.5 py-0.5 text-xs font-medium ${
                                  "queueFailed" in entry && entry.queueFailed
                                    ? "bg-red-100 text-red-800"
                                    : "bg-amber-100 text-amber-900"
                                }`}
                              >
                                {"queueFailed" in entry && entry.queueFailed
                                  ? "Sync failed"
                                  : "Pending sync"}
                              </span>
                            </Tooltip>
                          ) : (
                            <span
                              className={`ml-2 inline-flex rounded px-1.5 py-0.5 text-xs font-medium ${
                                "queueFailed" in entry && entry.queueFailed
                                  ? "bg-red-100 text-red-800"
                                  : "bg-amber-100 text-amber-900"
                              }`}
                            >
                              {"queueFailed" in entry && entry.queueFailed
                                ? "Sync failed"
                                : "Pending sync"}
                            </span>
                          )
                        ) : null}
                        {customerRefund ? (
                          <span className="ml-2 text-xs font-medium opacity-80">
                            (customer refund)
                          </span>
                        ) : autoPosted ? (
                          <span className="ml-2 text-xs font-medium opacity-80">
                            (auto-posted)
                          </span>
                        ) : linkedProductSaleCogs ? (
                          <span className="ml-2 text-xs font-medium opacity-80">
                            (product sale COGS)
                          </span>
                        ) : null}
                        {"queueFailed" in entry &&
                        entry.queueFailed &&
                        writeQueue ? (
                          <button
                            type="button"
                            className="ml-2 text-xs font-medium text-sky-800 underline"
                            onClick={() => void writeQueue.retryItem(entry.id)}
                          >
                            Retry
                          </button>
                        ) : null}
                      </td>
                      <td
                        className={`${scrollableTableRegisterCategoryCellClassName} ${registerTruncatedCellHostClassName}`}
                      >
                        <TruncatedCell>{entry.expense_category}</TruncatedCell>
                      </td>
                      <td
                        className={`px-4 py-3 ${registerTruncatedCellHostClassName}`}
                      >
                        <TruncatedCell>
                          {contractSiteLabelForEntry(entry)}
                        </TruncatedCell>
                      </td>
                      <td
                        className={`px-4 py-3 ${registerTruncatedCellHostClassName}`}
                      >
                        <TruncatedCell>{entry.sub_category}</TruncatedCell>
                      </td>
                      <td
                        className={`px-4 py-3 ${registerTruncatedCellHostClassName}`}
                      >
                        <TruncatedCell>{entry.vendor}</TruncatedCell>
                      </td>
                      <td
                        className={`px-4 py-3 ${registerTruncatedCellHostClassName}`}
                      >
                        <TruncatedCell>{formatGHS(gross)}</TruncatedCell>
                      </td>
                      <td
                        className={`px-4 py-3 ${registerTruncatedCellHostClassName}`}
                      >
                        <TruncatedCell>
                          {formatGHS(entry.wht_amount ?? 0)}
                        </TruncatedCell>
                      </td>
                      <td
                        className={`px-4 py-3 ${registerTruncatedCellHostClassName}`}
                      >
                        <TruncatedCell>{formatGHS(entry.amount)}</TruncatedCell>
                      </td>
                      <td
                        className={`px-4 py-3 ${registerTruncatedCellHostClassName}`}
                      >
                        <TruncatedCell>
                          {apAccrualRow ? (
                            <Tooltip
                              content={AP_ACCRUAL_EXPENSE_EDIT_DISABLED_TITLE}
                              variant="blocked"
                            >
                              <span>
                                {resolveExpenseRegisterPaymentMethodLabel(
                                  entry,
                                  paymentMethods,
                                )}
                              </span>
                            </Tooltip>
                          ) : (
                            resolveExpenseRegisterPaymentMethodLabel(
                              entry,
                              paymentMethods,
                            )
                          )}
                        </TruncatedCell>
                      </td>
                      <td
                        className={`px-4 py-3 ${registerTruncatedCellHostClassName}`}
                      >
                        <TruncatedCell>
                          {apAccrualStatus
                            ? buildApAccrualPaymentStatusListCell(apAccrualStatus)
                            : resolveExpenseRegisterPaymentStatusLabel(
                                entry,
                                linkedApAccrualPayables,
                                linkedApAccrualDisplayOptions,
                              )}
                        </TruncatedCell>
                      </td>
                      <RegisterRowActions
                        onEdit={() => openEditForm(entry)}
                        onDelete={
                          linkedProductSaleCogs
                            ? undefined
                            : () => handleDelete(entry.id)
                        }
                        deleting={deletingId === entry.id}
                        disableEdit={systemLinked}
                        editDisabledTitle={
                          registerLockMessage ??
                          (linkedProductSaleCogs
                            ? formatLinkedProductSaleCogsDeleteMessage(
                                linkedProductSaleCogs,
                              )
                            : undefined)
                        }
                        disableDelete={systemLinked || linkedProductSaleCogs != null}
                        deleteDisabledTitle={
                          registerLockMessage ?? deleteBlockedMessage
                        }
                        onMarkPaid={
                          showMarkPaid
                            ? () => {
                                void handleMarkAsPaid(entry);
                              }
                            : undefined
                        }
                        markingPaid={markingPaidId === entry.id}
                      />
                    </tr>
                  );
                })
              )}
            </tbody>
        </table>
      </ScrollableTable>

      <RegisterFilteredTotal
        label="Net Paid total"
        total={visibleNetPaidTotal}
        visibleCount={visibleEntries.length}
        totalCount={entries.length}
      />

      <RegisterRecordDetailDrawer
        open={detailExpenseId != null}
        title="Expense entry"
        subtitle={detailExpense?.description ?? detailExpenseId}
        sections={
          detailExpense
            ? buildExpenseRegisterDetailSections(detailExpense, businessUnits, {
                paymentMethods,
                projects: initialProjects,
                linkedApAccrualPayables,
                linkedApAccrualPayablesLoaded,
              })
            : []
        }
        loading={detailLoading}
        onClose={closeExpenseDetail}
        onEdit={
          detailExpense
            ? () => openEditForm(detailExpense)
            : undefined
        }
        disableEdit={
          detailExpense
            ? isSystemManagedExpenseRegisterRow(detailExpense) ||
              linkedProductSaleCogsByExpenseId.has(detailExpense.id)
            : false
        }
        editDisabledTitle={
          detailExpense &&
          linkedProductSaleCogsByExpenseId.has(detailExpense.id)
            ? formatLinkedProductSaleCogsDeleteMessage(
                linkedProductSaleCogsByExpenseId.get(detailExpense.id)!,
              )
            : detailExpense
              ? resolveExpenseRegisterLockMessage(detailExpense) ?? undefined
              : undefined
        }
      />

      <ExpenseRegisterBulkProjectDialog
        key={bulkProjectDialogKey}
        open={bulkProjectDialogOpen}
        selectedCount={selectedBulkCount}
        selectedTotal={selectedBulkTotal}
        projects={initialProjects}
        hasActiveProjects={hasActiveExpenseProjects}
        assigning={bulkProjectAssigning}
        onCancel={() => {
          if (!bulkProjectAssigning) {
            closeBulkProjectDialog();
          }
        }}
        onAssign={(projectFormValue) => {
          void handleBulkAssignProject(projectFormValue);
        }}
      />
    </div>
  );
}
