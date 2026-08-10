"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { uploadEmployeePhoto } from "@/utils/employee-photo";
import ImageFileUploadButton from "@/components/image-file-upload-button";
import EmployeePhotoAvatar from "../employee-photo-avatar";
import {
  confirmDeleteEntry,
  getStripedRowClassName,
  toDateInputValue,
} from "../finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import EmployeeRowActions from "./employee-row-actions";
import {
  compareStaffIds,
  DEFAULT_EMPLOYMENT_STATUS,
  EMPLOYEE_SELECT,
  EMPLOYMENT_STATUS_OPTIONS,
  EMPLOYMENT_TYPE_OPTIONS,
  GENDER_OPTIONS,
  MARITAL_STATUS_OPTIONS,
  PAYMENT_METHOD_OPTIONS,
  SHIFT_OPTIONS,
  formatGHS,
  inputClassName,
  textareaClassName,
  type EmployeeRecord,
} from "./employee-record-utils";
import { allocateNewEmployeeCodes } from "./employee-ids-api";
import {
  getDepartmentName,
  getPositionName,
  getProjectName,
  type DepartmentLookup,
  type EmployeeLookups,
  type EmployeePayConfig,
  type ProjectLookup,
} from "./lookup-utils";
import {
  calculateEstimatedNetMonthlyPay,
  type PayEstimateConfig,
} from "./pay-estimate-utils";
import {
  mapAllowancesToLegacyColumns,
  resolveEmployeeCompensation,
  type ResolvedCompensation,
} from "../administration/compensation-policy-utils";
import { isActiveEmployee } from "../hr-payroll/employee-utils";
import {
  buildEmploymentHistoryInsert,
  EMPLOYMENT_HISTORY_SELECT,
  hasTrackedEmploymentChange,
  normalizeHistoryText,
  snapshotFromEmployee,
  snapshotFromPayload,
  type EmploymentHistoryEntry,
} from "./employment-history-utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import FilteredListCount from "../filtered-list-count";

async function resolveChangedByLabel(
  supabase: SupabaseClient,
): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return "Unknown user";
  }

  const { data } = await supabase
    .from("user_accounts")
    .select("email")
    .eq("auth_uid", user.id)
    .maybeSingle();

  const accountEmail = (data as { email?: string | null } | null)?.email?.trim();
  if (accountEmail) {
    return accountEmail;
  }

  const authEmail = user.email?.trim();
  if (authEmail) {
    return authEmail;
  }

  return "Unknown user";
}

type EmployeesDirectoryProps = {
  initialEmployees: EmployeeRecord[];
  initialLookups: EmployeeLookups;
  initialPayConfig: EmployeePayConfig;
  /** Current open payroll period net pay (server-computed). */
  netPayByEmployeeId: Record<string, number>;
  netPayPeriodLabel: string;
  departmentNameMap: Map<string, string>;
  projectNameMap: Map<string, string>;
  fetchError: string | null;
  canEditEmployees: boolean;
  canViewSalary: boolean;
};

const emptyForm = {
  employee_id: "",
  staff_id: "",
  full_name: "",
  gender: "",
  date_of_birth: "",
  nationality: "",
  marital_status: "",
  phone: "",
  email: "",
  residential_address: "",
  ghana_card_number: "",
  ssnit_number: "",
  tin_number: "",
  payment_method: "",
  bank_name: "",
  account_number: "",
  momo_number: "",
  momo_name: "",
  department: "",
  position: "",
  supervisor: "",
  employment_type: "",
  date_hired: "",
  appointment_end_date: "",
  employment_status: DEFAULT_EMPLOYMENT_STATUS,
  contract_project: "",
  shift: "",
  assigned_site_id: "",
  basic_salary: "",
  housing_allowance: "",
  transport_allowance: "",
  other_allowances: "",
  emergency_contact_name: "",
  emergency_contact_address: "",
  emergency_contact_phone: "",
  emergency_contact_relationship: "",
  data_notes: "",
  photo_url: "",
};

function SectionHeading({ title }: { title: string }) {
  return (
    <h4 className="border-b border-slate-200 pb-2 text-sm font-semibold uppercase tracking-wide text-[#0f2744]">
      {title}
    </h4>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700">
        {label}
      </label>
      {children}
    </div>
  );
}

function employeeToForm(employee: EmployeeRecord) {
  return {
    employee_id: employee.employee_id,
    staff_id: employee.staff_id,
    full_name: employee.full_name,
    gender: employee.gender ?? "",
    date_of_birth: employee.date_of_birth
      ? toDateInputValue(employee.date_of_birth)
      : "",
    nationality: employee.nationality ?? "",
    marital_status: employee.marital_status ?? "",
    phone: employee.phone ?? "",
    email: employee.email ?? "",
    residential_address: employee.residential_address ?? "",
    ghana_card_number: employee.ghana_card_number ?? "",
    ssnit_number: employee.ssnit_number ?? "",
    tin_number: employee.tin_number ?? "",
    payment_method: employee.payment_method ?? "",
    bank_name: employee.bank_name ?? "",
    account_number: employee.account_number ?? "",
    momo_number: employee.momo_number ?? "",
    momo_name: employee.momo_name ?? "",
    department: employee.department ?? "",
    position: employee.position ?? "",
    supervisor: employee.supervisor ?? "",
    employment_type: employee.employment_type ?? "",
    date_hired: employee.date_hired ? toDateInputValue(employee.date_hired) : "",
    appointment_end_date: employee.appointment_end_date
      ? toDateInputValue(employee.appointment_end_date)
      : "",
    employment_status: employee.employment_status ?? DEFAULT_EMPLOYMENT_STATUS,
    contract_project: employee.contract_project ?? "",
    shift: employee.shift ?? "",
    assigned_site_id: employee.assigned_site_id ?? "",
    basic_salary:
      employee.basic_salary === null ? "" : String(employee.basic_salary),
    housing_allowance:
      employee.housing_allowance === null
        ? ""
        : String(employee.housing_allowance),
    transport_allowance:
      employee.transport_allowance === null
        ? ""
        : String(employee.transport_allowance),
    other_allowances:
      employee.other_allowances === null
        ? ""
        : String(employee.other_allowances),
    emergency_contact_name: employee.emergency_contact_name ?? "",
    emergency_contact_address: employee.emergency_contact_address ?? "",
    emergency_contact_phone: employee.emergency_contact_phone ?? "",
    emergency_contact_relationship:
      employee.emergency_contact_relationship ?? "",
    data_notes: employee.data_notes ?? "",
    photo_url: employee.photo_url ?? "",
  };
}

function buildPayload(
  form: typeof emptyForm,
  resolved?: ReturnType<typeof resolveEmployeeCompensation>,
) {
  const legacy = resolved
    ? mapAllowancesToLegacyColumns(resolved.allowances)
    : {
        housing_allowance: form.housing_allowance
          ? Number(form.housing_allowance)
          : 0,
        transport_allowance: form.transport_allowance
          ? Number(form.transport_allowance)
          : 0,
        other_allowances: form.other_allowances
          ? Number(form.other_allowances)
          : 0,
      };

  return {
    staff_id: form.staff_id,
    full_name: form.full_name,
    gender: form.gender || null,
    date_of_birth: form.date_of_birth || null,
    nationality: form.nationality || null,
    marital_status: form.marital_status || null,
    phone: form.phone || null,
    email: form.email || null,
    residential_address: form.residential_address || null,
    ghana_card_number: form.ghana_card_number || null,
    ssnit_number: form.ssnit_number || null,
    tin_number: form.tin_number || null,
    payment_method: form.payment_method || null,
    bank_name: form.bank_name || null,
    account_number: form.account_number || null,
    momo_number: form.momo_number || null,
    momo_name:
      form.payment_method === "momo"
        ? form.momo_name.trim() || form.full_name.trim() || null
        : form.momo_name || null,
    department: form.department || null,
    position: form.position || null,
    supervisor: form.supervisor || null,
    employment_type: form.employment_type || null,
    date_hired: form.date_hired || null,
    appointment_end_date: form.appointment_end_date || null,
    employment_status: form.employment_status || DEFAULT_EMPLOYMENT_STATUS,
    contract_project: form.contract_project || null,
    shift: form.shift || null,
    assigned_site_id: form.assigned_site_id || null,
    basic_salary: resolved
      ? resolved.basic_salary
      : form.basic_salary
        ? Number(form.basic_salary)
        : 0,
    housing_allowance: legacy.housing_allowance,
    transport_allowance: legacy.transport_allowance,
    other_allowances: legacy.other_allowances,
    emergency_contact_name: form.emergency_contact_name || null,
    emergency_contact_address: form.emergency_contact_address || null,
    emergency_contact_phone: form.emergency_contact_phone || null,
    emergency_contact_relationship: form.emergency_contact_relationship || null,
    data_notes: form.data_notes || null,
    photo_url: form.photo_url || null,
  };
}

function resolveDirectoryListCompensation(
  employee: Pick<
    EmployeeRecord,
    "position" | "employment_type" | "shift"
  >,
  payConfig: EmployeePayConfig,
): ResolvedCompensation {
  return resolveEmployeeCompensation(
    payConfig.salaryRates,
    payConfig.compensationPolicies,
    payConfig.allowanceTypes,
    employee.position,
    employee.employment_type,
    employee.shift,
  );
}

type SortColumn =
  | "staff_id"
  | "full_name"
  | "department"
  | "position"
  | "contract_project"
  | "employment_type"
  | "employment_status"
  | "basic_salary"
  | "gross_monthly_pay"
  | "current_net_pay";

type SortDirection = "asc" | "desc";

const DEFAULT_SORT_COLUMN: SortColumn = "staff_id";
const DEFAULT_SORT_DIRECTION: SortDirection = "asc";

function matchesPositionFilter(
  employeePosition: string | null | undefined,
  filterPosition: string,
  positions: EmployeeLookups["positions"],
): boolean {
  if (!filterPosition) {
    return true;
  }

  if (!employeePosition) {
    return false;
  }

  const selected = positions.find((position) => position.name === filterPosition);

  if (!selected) {
    return employeePosition === filterPosition;
  }

  return (
    employeePosition === selected.name || employeePosition === selected.id
  );
}

function SortableHeader({
  label,
  column,
  sortColumn,
  sortDirection,
  onSort,
  title,
}: {
  label: string;
  column: SortColumn;
  sortColumn: SortColumn;
  sortDirection: SortDirection;
  onSort: (column: SortColumn) => void;
  title?: string;
}) {
  const active = sortColumn === column;

  return (
    <th className={scrollableTableThClassName} title={title}>
      <button
        type="button"
        onClick={() => onSort(column)}
        title={title}
        className="flex w-full items-center gap-1 text-left font-medium text-white transition-opacity hover:opacity-90"
      >
        <span>{label}</span>
        {active ? (
          <span aria-hidden="true">{sortDirection === "asc" ? "↑" : "↓"}</span>
        ) : null}
      </button>
    </th>
  );
}

export default function EmployeesDirectory({
  initialEmployees,
  initialLookups,
  initialPayConfig,
  netPayByEmployeeId: initialNetPayByEmployeeId,
  netPayPeriodLabel,
  departmentNameMap: initialDepartmentNameMap,
  projectNameMap: initialProjectNameMap,
  fetchError,
  canEditEmployees,
  canViewSalary,
}: EmployeesDirectoryProps) {
  const supabase = createClient();
  const formRef = useRef<HTMLElement>(null);
  const [employees, setEmployees] = useState(initialEmployees);
  const [lookups] = useState(initialLookups);
  const [payConfig] = useState(initialPayConfig);
  const [netPayByEmployeeId] = useState(initialNetPayByEmployeeId);

  /** Live Salary Settings resolution for list columns (not stamped employee fields). */
  const listCompensationByEmployeeId = useMemo(() => {
    const map: Record<string, ResolvedCompensation> = {};
    for (const employee of employees) {
      map[employee.employee_id] = resolveDirectoryListCompensation(
        employee,
        payConfig,
      );
    }
    return map;
  }, [employees, payConfig]);
  const [departmentNameMap] = useState(initialDepartmentNameMap);
  const [projectNameMap] = useState(initialProjectNameMap);
  const [showForm, setShowForm] = useState(false);
  const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(
    null,
  );
  const [deletingEmployeeId, setDeletingEmployeeId] = useState<string | null>(
    null,
  );
  const [form, setForm] = useState(emptyForm);
  const [changeReason, setChangeReason] = useState("");
  const [employmentHistory, setEmploymentHistory] = useState<
    EmploymentHistoryEntry[]
  >([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);
  const [searchName, setSearchName] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterDepartment, setFilterDepartment] = useState("");
  const [filterEmploymentType, setFilterEmploymentType] = useState("");
  const [filterPosition, setFilterPosition] = useState("");
  const [filterShift, setFilterShift] = useState("");
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [sortColumn, setSortColumn] = useState<SortColumn>(DEFAULT_SORT_COLUMN);
  const [sortDirection, setSortDirection] = useState<SortDirection>(
    DEFAULT_SORT_DIRECTION,
  );

  const payEstimateConfig: PayEstimateConfig = useMemo(
    () => ({
      ssnitConfig: payConfig.ssnitConfig,
      casualTaxConfig: payConfig.casualTaxConfig,
      payeBands: payConfig.payeBands,
    }),
    [payConfig],
  );

  useEffect(() => {
    setEmployees(initialEmployees);
  }, [initialEmployees]);

  const positionOptions = useMemo(() => {
    const names = new Set(lookups.positions.map((position) => position.name));
    if (form.position.trim()) {
      names.add(form.position.trim());
    }
    for (const employee of employees) {
      if (employee.position?.trim()) {
        names.add(employee.position.trim());
      }
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [employees, form.position, lookups.positions]);

  // Match Work Orders: active employees only; exclude self when editing.
  const supervisorOptions = useMemo(() => {
    return employees
      .filter((employee) => isActiveEmployee(employee))
      .filter((employee) => employee.employee_id !== editingEmployeeId)
      .slice()
      .sort((left, right) => compareStaffIds(left.staff_id, right.staff_id));
  }, [editingEmployeeId, employees]);

  const selectedSupervisorMissing = Boolean(
    form.supervisor &&
      !supervisorOptions.some(
        (employee) => employee.employee_id === form.supervisor,
      ),
  );

  const selectedSupervisorFallback = selectedSupervisorMissing
    ? employees.find((employee) => employee.employee_id === form.supervisor) ??
      null
    : null;

  const positionFilterOptions = useMemo(
    () =>
      [...lookups.positions]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((position) => ({
          value: position.name,
          label: position.name,
        })),
    [lookups.positions],
  );

  const filteredEmployees = useMemo(() => {
    const query = searchName.trim().toLowerCase();

    return employees.filter((employee) => {
      if (query && !employee.full_name.toLowerCase().includes(query)) {
        return false;
      }

      if (filterStatus && employee.employment_status !== filterStatus) {
        return false;
      }

      if (filterDepartment && employee.department !== filterDepartment) {
        return false;
      }

      if (
        filterEmploymentType &&
        employee.employment_type !== filterEmploymentType
      ) {
        return false;
      }

      if (
        !matchesPositionFilter(
          employee.position,
          filterPosition,
          lookups.positions,
        )
      ) {
        return false;
      }

      if (filterShift && employee.shift !== filterShift) {
        return false;
      }

      return true;
    });
  }, [
    employees,
    filterDepartment,
    filterEmploymentType,
    filterPosition,
    filterShift,
    filterStatus,
    lookups.positions,
    searchName,
  ]);

  const displayEmployees = useMemo(() => {
    const sorted = [...filteredEmployees];

    sorted.sort((left, right) => {
      let comparison = 0;

      switch (sortColumn) {
        case "staff_id":
          comparison = compareStaffIds(left.staff_id, right.staff_id);
          break;
        case "full_name":
          comparison = left.full_name.localeCompare(right.full_name);
          break;
        case "department":
          comparison = getDepartmentName(
            departmentNameMap,
            left.department,
            left.department_ref,
          ).localeCompare(
            getDepartmentName(
              departmentNameMap,
              right.department,
              right.department_ref,
            ),
          );
          break;
        case "position":
          comparison = getPositionName(
            lookups.positions,
            left.position,
          ).localeCompare(getPositionName(lookups.positions, right.position));
          break;
        case "contract_project":
          comparison = getProjectName(
            projectNameMap,
            left.contract_project,
            left.project_ref,
          ).localeCompare(
            getProjectName(
              projectNameMap,
              right.contract_project,
              right.project_ref,
            ),
          );
          break;
        case "employment_type":
          comparison = (left.employment_type ?? "").localeCompare(
            right.employment_type ?? "",
          );
          break;
        case "employment_status":
          comparison = (left.employment_status ?? "").localeCompare(
            right.employment_status ?? "",
          );
          break;
        case "basic_salary":
          comparison =
            (listCompensationByEmployeeId[left.employee_id]?.basic_salary ?? 0) -
            (listCompensationByEmployeeId[right.employee_id]?.basic_salary ?? 0);
          break;
        case "gross_monthly_pay":
          comparison =
            (listCompensationByEmployeeId[left.employee_id]?.gross_monthly ?? 0) -
            (listCompensationByEmployeeId[right.employee_id]?.gross_monthly ??
              0);
          break;
        case "current_net_pay":
          comparison =
            (netPayByEmployeeId[left.employee_id] ?? Number.NEGATIVE_INFINITY) -
            (netPayByEmployeeId[right.employee_id] ?? Number.NEGATIVE_INFINITY);
          break;
      }

      return sortDirection === "asc" ? comparison : -comparison;
    });

    return sorted;
  }, [
    departmentNameMap,
    filteredEmployees,
    listCompensationByEmployeeId,
    lookups.positions,
    netPayByEmployeeId,
    projectNameMap,
    sortColumn,
    sortDirection,
  ]);

  const hasActiveFilters = Boolean(
    searchName.trim() ||
      filterStatus ||
      filterDepartment ||
      filterEmploymentType ||
      filterPosition ||
      filterShift,
  );

  const tableColumnCount = (canViewSalary ? 12 : 9) + 1;

  const allVisibleSelected =
    displayEmployees.length > 0 &&
    displayEmployees.every((employee) =>
      selectedEmployeeIds.has(employee.employee_id),
    );

  const someVisibleSelected =
    displayEmployees.some((employee) =>
      selectedEmployeeIds.has(employee.employee_id),
    ) && !allVisibleSelected;

  const selectedCount = selectedEmployeeIds.size;

  useEffect(() => {
    const visibleIds = new Set(
      displayEmployees.map((employee) => employee.employee_id),
    );
    setSelectedEmployeeIds((current) => {
      const next = new Set(
        [...current].filter((employeeId) => visibleIds.has(employeeId)),
      );
      if (next.size === current.size) {
        return current;
      }
      return next;
    });
  }, [displayEmployees]);

  function toggleEmployeeSelection(employeeId: string) {
    setSelectedEmployeeIds((current) => {
      const next = new Set(current);
      if (next.has(employeeId)) {
        next.delete(employeeId);
      } else {
        next.add(employeeId);
      }
      return next;
    });
  }

  function toggleSelectAllVisible() {
    if (allVisibleSelected) {
      setSelectedEmployeeIds(new Set());
      return;
    }

    setSelectedEmployeeIds(
      new Set(displayEmployees.map((employee) => employee.employee_id)),
    );
  }

  function handleSort(column: SortColumn) {
    if (sortColumn === column) {
      setSortDirection((currentDirection) =>
        currentDirection === "asc" ? "desc" : "asc",
      );
      return;
    }

    setSortColumn(column);
    setSortDirection("asc");
  }

  const resolvedCompensation = useMemo(
    () =>
      resolveEmployeeCompensation(
        payConfig.salaryRates,
        payConfig.compensationPolicies,
        payConfig.allowanceTypes,
        form.position,
        form.employment_type,
        form.shift,
      ),
    [
      payConfig.salaryRates,
      payConfig.compensationPolicies,
      payConfig.allowanceTypes,
      form.position,
      form.employment_type,
      form.shift,
    ],
  );

  const editingEmployee = useMemo(
    () =>
      editingEmployeeId
        ? employees.find((employee) => employee.employee_id === editingEmployeeId) ??
          null
        : null,
    [editingEmployeeId, employees],
  );

  const pendingPayloadSnapshot = useMemo(
    () =>
      snapshotFromPayload(
        buildPayload(form, resolvedCompensation) as ReturnType<
          typeof buildPayload
        >,
      ),
    [form, resolvedCompensation],
  );

  const trackedFieldsDirty = useMemo(() => {
    if (!editingEmployee) {
      return false;
    }
    return hasTrackedEmploymentChange(
      snapshotFromEmployee(editingEmployee),
      pendingPayloadSnapshot,
    );
  }, [editingEmployee, pendingPayloadSnapshot]);

  const showChangeReasonField = !editingEmployeeId || trackedFieldsDirty;

  const previewGrossPay = resolvedCompensation.gross_monthly;

  const previewEstimatedNetPay = useMemo(
    () =>
      calculateEstimatedNetMonthlyPay(
        {
          employment_type: form.employment_type || null,
          basic_salary: resolvedCompensation.basic_salary,
          housing_allowance: mapAllowancesToLegacyColumns(
            resolvedCompensation.allowances,
          ).housing_allowance,
          transport_allowance: mapAllowancesToLegacyColumns(
            resolvedCompensation.allowances,
          ).transport_allowance,
          other_allowances: mapAllowancesToLegacyColumns(
            resolvedCompensation.allowances,
          ).other_allowances,
        },
        payEstimateConfig,
      ),
    [form.employment_type, resolvedCompensation, payEstimateConfig],
  );

  async function refreshEmployees() {
    const { data, error: refreshError } = await supabase
      .from("employees")
      .select(EMPLOYEE_SELECT)
      .order("staff_id", { ascending: true });

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    setEmployees((data as EmployeeRecord[] | null) ?? []);
    setError(null);
  }

  function scrollToForm() {
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function loadEmploymentHistory(employeeId: string) {
    setHistoryLoading(true);
    const { data, error: historyError } = await supabase
      .from("employee_employment_history")
      .select(EMPLOYMENT_HISTORY_SELECT)
      .eq("employee_id", employeeId)
      .order("changed_at", { ascending: false })
      .order("effective_date", { ascending: false });

    if (historyError) {
      setError(historyError.message);
      setEmploymentHistory([]);
      setHistoryLoading(false);
      return;
    }

    setEmploymentHistory((data as EmploymentHistoryEntry[] | null) ?? []);
    setHistoryLoading(false);
  }

  function openAddForm() {
    setEditingEmployeeId(null);
    setForm({
      ...emptyForm,
      employment_status: DEFAULT_EMPLOYMENT_STATUS,
    });
    setChangeReason("");
    setEmploymentHistory([]);
    setShowForm(true);
    scrollToForm();
  }

  function closeForm() {
    setEditingEmployeeId(null);
    setForm(emptyForm);
    setChangeReason("");
    setEmploymentHistory([]);
    setShowForm(false);
  }

  function openEmployeeForm(employee: EmployeeRecord) {
    setEditingEmployeeId(employee.employee_id);
    setForm(employeeToForm(employee));
    setChangeReason("");
    setShowForm(true);
    scrollToForm();
    void loadEmploymentHistory(employee.employee_id);
  }

  function updateField(field: keyof typeof emptyForm, value: string) {
    setForm((current) => {
      if (field === "payment_method" && value === "momo") {
        return {
          ...current,
          payment_method: value,
          momo_name: current.momo_name.trim()
            ? current.momo_name
            : current.full_name.trim(),
        };
      }

      if (
        field === "full_name" &&
        current.payment_method === "momo" &&
        !current.momo_name.trim()
      ) {
        return {
          ...current,
          full_name: value,
          momo_name: value.trim(),
        };
      }

      return { ...current, [field]: value };
    });
  }

  async function handlePhotoUpload(file: File) {
    if (!form.employee_id) {
      return;
    }

    setPhotoUploading(true);
    setError(null);

    const uploadResult = await uploadEmployeePhoto(
      supabase,
      form.employee_id,
      file,
    );

    if ("error" in uploadResult) {
      setError(uploadResult.error);
      setPhotoUploading(false);
      return;
    }

    const photoUrl = uploadResult.publicUrl;
    setForm((current) => ({ ...current, photo_url: photoUrl }));

    if (editingEmployeeId) {
      const { error: updateError } = await supabase
        .from("employees")
        .update({ photo_url: photoUrl })
        .eq("employee_id", editingEmployeeId);

      if (updateError) {
        setError(updateError.message);
        setPhotoUploading(false);
        return;
      }

      await refreshEmployees();
    }

    setPhotoUploading(false);
  }

  async function handleDelete(employeeId: string) {
    if (!confirmDeleteEntry()) {
      return;
    }

    setDeletingEmployeeId(employeeId);
    setError(null);

    const { error: deleteError } = await supabase
      .from("employees")
      .delete()
      .eq("employee_id", employeeId);

    if (deleteError) {
      setError(deleteError.message);
      setDeletingEmployeeId(null);
      return;
    }

    if (editingEmployeeId === employeeId) {
      closeForm();
    }

    await refreshEmployees();
    setDeletingEmployeeId(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.employment_type) {
      setError("Employment Type is required.");
      return;
    }

    setLoading(true);

    const changedBy = await resolveChangedByLabel(supabase);
    const reasonText = normalizeHistoryText(changeReason);

    if (editingEmployeeId) {
      const prior =
        employees.find((employee) => employee.employee_id === editingEmployeeId) ??
        null;
      const payload = buildPayload(form, resolvedCompensation);
      const afterSnapshot = snapshotFromPayload(payload);
      const shouldWriteHistory =
        prior !== null &&
        hasTrackedEmploymentChange(snapshotFromEmployee(prior), afterSnapshot);

      const { error: saveError } = await supabase
        .from("employees")
        .update(payload)
        .eq("employee_id", editingEmployeeId);

      if (saveError) {
        setError(saveError.message);
        setLoading(false);
        return;
      }

      if (shouldWriteHistory) {
        const { error: historyError } = await supabase
          .from("employee_employment_history")
          .insert(
            buildEmploymentHistoryInsert({
              employeeId: editingEmployeeId,
              snapshot: afterSnapshot,
              changeReason: reasonText,
              changedBy,
            }),
          );

        if (historyError) {
          setError(
            `Employee saved, but employment history was not recorded: ${historyError.message}`,
          );
          setLoading(false);
          await refreshEmployees();
          return;
        }
      }
    } else {
      const allocated = await allocateNewEmployeeCodes(supabase);
      if (allocated.error || !allocated.employeeId || !allocated.staffId) {
        setError(allocated.error ?? "Unable to allocate employee IDs.");
        setLoading(false);
        return;
      }

      const payload = buildPayload(
        {
          ...form,
          employee_id: allocated.employeeId,
          staff_id: allocated.staffId,
        },
        resolvedCompensation,
      );

      const { error: saveError } = await supabase.from("employees").insert({
        employee_id: allocated.employeeId,
        ...payload,
      });

      if (saveError) {
        setError(saveError.message);
        setLoading(false);
        return;
      }

      // Forward-only: create current-year leave balances from entitlement policy
      // (Annual=15 / Sick=0 / Unpaid=0 fallback when no policy row).
      const { error: leaveBalanceError } = await supabase.rpc(
        "create_employee_leave_balances_for_year",
        {
          p_employee_id: allocated.employeeId,
          p_year: new Date().getFullYear(),
        },
      );

      if (leaveBalanceError) {
        setError(
          `Employee saved, but leave balances were not created: ${leaveBalanceError.message}`,
        );
        setLoading(false);
        await refreshEmployees();
        return;
      }

      const { error: historyError } = await supabase
        .from("employee_employment_history")
        .insert(
          buildEmploymentHistoryInsert({
            employeeId: allocated.employeeId,
            snapshot: snapshotFromPayload(payload),
            changeReason: reasonText ?? "Employee created",
            changedBy,
          }),
        );

      if (historyError) {
        setError(
          `Employee saved, but employment history was not recorded: ${historyError.message}`,
        );
        setLoading(false);
        await refreshEmployees();
        return;
      }
    }

    closeForm();
    await refreshEmployees();
    setLoading(false);
  }

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[#0f2744]">Employees</h1>
          <p className="mt-1 text-sm text-slate-600">
            Master employee directory for personal, employment, and compensation
            records.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {selectedCount > 0 ? (
            <span className="text-sm font-medium text-slate-700">
              {selectedCount} selected
            </span>
          ) : null}
          <Link
            href="/dashboard/bulk-import?type=employee"
            className="rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50"
          >
            Bulk Import
          </Link>
          {canEditEmployees ? (
          <button
            type="button"
            onClick={() => (showForm ? closeForm() : openAddForm())}
            className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
          >
            {showForm ? "Cancel" : "Add Employee"}
          </button>
          ) : null}
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="min-w-[220px] flex-1">
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Search by Name
          </label>
          <input
            type="search"
            value={searchName}
            onChange={(e) => setSearchName(e.target.value)}
            placeholder="Search employees…"
            className={inputClassName}
          />
        </div>
        <div className="min-w-[180px]">
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Employment Status
          </label>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className={inputClassName}
          >
            <option value="">All statuses</option>
            {EMPLOYMENT_STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-[180px]">
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Department
          </label>
          <select
            value={filterDepartment}
            onChange={(e) => setFilterDepartment(e.target.value)}
            className={inputClassName}
          >
            <option value="">All departments</option>
            {lookups.departments.map((department) => (
              <option key={department.code} value={department.code}>
                {department.name}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-[180px]">
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Employment Type
          </label>
          <select
            value={filterEmploymentType}
            onChange={(e) => setFilterEmploymentType(e.target.value)}
            className={inputClassName}
          >
            <option value="">All types</option>
            {EMPLOYMENT_TYPE_OPTIONS.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-[180px]">
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Position
          </label>
          <select
            value={filterPosition}
            onChange={(e) => setFilterPosition(e.target.value)}
            className={inputClassName}
          >
            <option value="">All positions</option>
            {positionFilterOptions.map((position) => (
              <option key={position.value} value={position.value}>
                {position.label}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-[180px]">
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Shift
          </label>
          <select
            value={filterShift}
            onChange={(e) => setFilterShift(e.target.value)}
            className={inputClassName}
          >
            <option value="">All shifts</option>
            {SHIFT_OPTIONS.map((shift) => (
              <option key={shift} value={shift}>
                {shift}
              </option>
            ))}
          </select>
        </div>
      </div>

      <FilteredListCount
        filteredCount={filteredEmployees.length}
        totalCount={employees.length}
        itemSingular="employee"
        hasActiveFilters={hasActiveFilters}
      />

      {showForm && (
        <section
          ref={formRef}
          className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
        >
          <h3 className="mb-6 text-lg font-semibold text-[#0f2744]">
            {editingEmployeeId ? "Employee Details" : "New Employee"}
          </h3>
          <form onSubmit={handleSubmit} className="space-y-8">
            <div className="space-y-4">
              <SectionHeading title="Personal Information" />
              <div className="flex flex-wrap items-center gap-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <EmployeePhotoAvatar
                  photoUrl={form.photo_url}
                  fullName={form.full_name}
                  size="xl"
                />
                <div className="space-y-2">
                  <p className="text-sm font-medium text-slate-700">
                    Passport Photo
                  </p>
                  <ImageFileUploadButton
                    files={[]}
                    onChange={(next) => {
                      const file = next[0];
                      if (file) {
                        void handlePhotoUpload(file);
                      }
                    }}
                    multiple={false}
                    disabled={photoUploading || !form.employee_id}
                    addLabel={photoUploading ? "Uploading…" : "Add photos"}
                    showClear={false}
                    resetInputAfterSelect
                    emptyHint={
                      editingEmployeeId
                        ? "JPEG, PNG, or WebP. Saved when you upload."
                        : "JPEG, PNG, or WebP. Available after the employee is saved (IDs are assigned on save)."
                    }
                  />
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <Field label="Employee ID">
                  <input
                    type="text"
                    readOnly
                    value={
                      form.employee_id ||
                      (editingEmployeeId ? "" : "Assigned on save")
                    }
                    className={`${inputClassName} bg-slate-50 text-slate-600`}
                  />
                </Field>
                <Field label="Staff ID">
                  <input
                    type="text"
                    readOnly
                    value={
                      form.staff_id ||
                      (editingEmployeeId ? "" : "Assigned on save")
                    }
                    className={`${inputClassName} bg-slate-50 text-slate-600`}
                  />
                </Field>
                <Field label="Full Name">
                  <input
                    type="text"
                    required
                    value={form.full_name}
                    onChange={(e) => updateField("full_name", e.target.value)}
                    className={inputClassName}
                  />
                </Field>
                <Field label="Gender">
                  <select
                    value={form.gender}
                    onChange={(e) => updateField("gender", e.target.value)}
                    className={inputClassName}
                  >
                    <option value="">Select gender</option>
                    {GENDER_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Date of Birth">
                  <input
                    type="date"
                    value={form.date_of_birth}
                    onChange={(e) =>
                      updateField("date_of_birth", e.target.value)
                    }
                    className={inputClassName}
                  />
                </Field>
                <Field label="Nationality">
                  <input
                    type="text"
                    value={form.nationality}
                    onChange={(e) => updateField("nationality", e.target.value)}
                    className={inputClassName}
                  />
                </Field>
                <Field label="Marital Status">
                  <select
                    value={form.marital_status}
                    onChange={(e) =>
                      updateField("marital_status", e.target.value)
                    }
                    className={inputClassName}
                  >
                    <option value="">Select status</option>
                    {MARITAL_STATUS_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Phone/WhatsApp">
                  <input
                    type="text"
                    value={form.phone}
                    onChange={(e) => updateField("phone", e.target.value)}
                    className={inputClassName}
                  />
                </Field>
                <Field label="Email">
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => updateField("email", e.target.value)}
                    className={inputClassName}
                  />
                </Field>
                <Field label="Residential Address">
                  <input
                    type="text"
                    value={form.residential_address}
                    onChange={(e) =>
                      updateField("residential_address", e.target.value)
                    }
                    className={inputClassName}
                  />
                </Field>
                <Field label="Ghana Card Number">
                  <input
                    type="text"
                    value={form.ghana_card_number}
                    onChange={(e) =>
                      updateField("ghana_card_number", e.target.value)
                    }
                    className={inputClassName}
                  />
                </Field>
                <Field label="SSNIT Number">
                  <input
                    type="text"
                    value={form.ssnit_number}
                    onChange={(e) => updateField("ssnit_number", e.target.value)}
                    className={inputClassName}
                  />
                </Field>
                <Field label="TIN Number">
                  <input
                    type="text"
                    value={form.tin_number}
                    onChange={(e) => updateField("tin_number", e.target.value)}
                    className={inputClassName}
                  />
                </Field>
                <Field label="Payment Method">
                  <select
                    value={form.payment_method}
                    onChange={(e) =>
                      updateField("payment_method", e.target.value)
                    }
                    className={inputClassName}
                  >
                    <option value="">Select payment method</option>
                    {PAYMENT_METHOD_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </Field>
                {form.payment_method === "bank" ||
                form.payment_method === "" ? (
                  <>
                    <Field label="Bank Name">
                      <input
                        type="text"
                        value={form.bank_name}
                        onChange={(e) =>
                          updateField("bank_name", e.target.value)
                        }
                        className={inputClassName}
                      />
                    </Field>
                    <Field label="Account Number">
                      <input
                        type="text"
                        value={form.account_number}
                        onChange={(e) =>
                          updateField("account_number", e.target.value)
                        }
                        className={inputClassName}
                      />
                    </Field>
                  </>
                ) : null}
                {form.payment_method === "momo" ||
                form.payment_method === "" ? (
                  <Field label="Mobile Money Number">
                    <input
                      type="text"
                      value={form.momo_number}
                      onChange={(e) =>
                        updateField("momo_number", e.target.value)
                      }
                      className={inputClassName}
                    />
                  </Field>
                ) : null}
                {form.payment_method === "momo" ? (
                  <Field label="MoMo Name">
                    <input
                      type="text"
                      value={form.momo_name}
                      onChange={(e) =>
                        updateField("momo_name", e.target.value)
                      }
                      className={inputClassName}
                    />
                  </Field>
                ) : null}
              </div>
            </div>

            <div className="space-y-4">
              <SectionHeading title="Employment" />
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <Field label="Department">
                  <select
                    value={form.department}
                    onChange={(e) => updateField("department", e.target.value)}
                    className={inputClassName}
                  >
                    <option value="">Select department</option>
                    {form.department &&
                    !lookups.departments.some(
                      (department) => department.code === form.department,
                    ) ? (
                      <option value={form.department}>
                        {getDepartmentName(
                          departmentNameMap,
                          form.department,
                        )}
                      </option>
                    ) : null}
                    {lookups.departments.map((department: DepartmentLookup) => (
                      <option key={department.code} value={department.code}>
                        {department.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Position">
                  <select
                    value={form.position}
                    onChange={(e) => updateField("position", e.target.value)}
                    className={inputClassName}
                  >
                    <option value="">Select position</option>
                    {positionOptions.map((position) => (
                      <option key={position} value={position}>
                        {getPositionName(lookups.positions, position)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Supervisor">
                  <select
                    value={form.supervisor}
                    onChange={(e) => updateField("supervisor", e.target.value)}
                    className={inputClassName}
                  >
                    <option value="">Select supervisor</option>
                    {selectedSupervisorFallback ? (
                      <option value={selectedSupervisorFallback.employee_id}>
                        {selectedSupervisorFallback.staff_id} —{" "}
                        {selectedSupervisorFallback.full_name}
                      </option>
                    ) : selectedSupervisorMissing ? (
                      <option value={form.supervisor}>
                        {form.supervisor}
                      </option>
                    ) : null}
                    {supervisorOptions.map((employee) => (
                      <option
                        key={employee.employee_id}
                        value={employee.employee_id}
                      >
                        {employee.staff_id} — {employee.full_name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Employment Type">
                  <select
                    value={form.employment_type}
                    onChange={(e) =>
                      updateField("employment_type", e.target.value)
                    }
                    className={inputClassName}
                  >
                    <option value="">Select type</option>
                    {EMPLOYMENT_TYPE_OPTIONS.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Date Hired">
                  <input
                    type="date"
                    value={form.date_hired}
                    onChange={(e) => updateField("date_hired", e.target.value)}
                    className={inputClassName}
                  />
                </Field>
                <Field label="Appointment End Date">
                  <input
                    type="date"
                    value={form.appointment_end_date}
                    onChange={(e) =>
                      updateField("appointment_end_date", e.target.value)
                    }
                    className={inputClassName}
                  />
                </Field>
                <Field label="Employment Status">
                  <select
                    required
                    value={form.employment_status}
                    onChange={(e) =>
                      updateField("employment_status", e.target.value)
                    }
                    className={inputClassName}
                  >
                    {EMPLOYMENT_STATUS_OPTIONS.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Contract/Project Assignment">
                  <select
                    value={form.contract_project}
                    onChange={(e) =>
                      updateField("contract_project", e.target.value)
                    }
                    className={inputClassName}
                  >
                    <option value="">Select project</option>
                    {form.contract_project &&
                    !lookups.projects.some(
                      (project) => project.code === form.contract_project,
                    ) ? (
                      <option value={form.contract_project}>
                        {getProjectName(
                          projectNameMap,
                          form.contract_project,
                        )}
                      </option>
                    ) : null}
                    {lookups.projects.map((project: ProjectLookup) => (
                      <option key={project.code} value={project.code}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Shift">
                  <select
                    value={form.shift}
                    onChange={(e) => updateField("shift", e.target.value)}
                    className={inputClassName}
                  >
                    <option value="">Select shift</option>
                    {SHIFT_OPTIONS.map((shift) => (
                      <option key={shift} value={shift}>
                        {shift}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>

            {canViewSalary ? (
            <div className="space-y-4">
              <SectionHeading title="Compensation (GHS)" />
              <p className="text-sm text-slate-600">
                Read-only from Salary Settings policy (Position × Employment
                Type × Shift). Edit amounts under Administration → Salary
                Settings.
              </p>
              {resolvedCompensation.missing_basic ? (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  No basic salary rate configured for this Position/Type/Shift
                  — showing GHS 0.00 for basic until Salary Settings → Basic
                  Salary Rates has a matching row.
                </p>
              ) : null}
              {resolvedCompensation.missing_allowances ? (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  No allowance amounts configured yet for this
                  Position/Type/Shift — showing GHS 0.00 for all allowances
                  until Salary Settings → Allowance Matrix is filled in for
                  this combination.
                </p>
              ) : null}
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Basic Salary
                  </p>
                  <p className="mt-1 text-sm font-semibold text-[#0f2744]">
                    {formatGHS(resolvedCompensation.basic_salary)}
                  </p>
                </div>
                {resolvedCompensation.allowances.map((line) => (
                  <div
                    key={line.allowance_type_id}
                    className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
                  >
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      {line.allowance_name}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-[#0f2744]">
                      {formatGHS(line.amount)}
                    </p>
                  </div>
                ))}
              </div>
              <div className="space-y-1 text-sm text-slate-600">
                <p>
                  Gross Monthly Pay:{" "}
                  <span className="font-medium text-[#0f2744]">
                    {formatGHS(previewGrossPay)}
                  </span>
                </p>
                <p>
                  Estimated Net Monthly Pay:{" "}
                  <span className="font-medium text-[#0f2744]">
                    {formatGHS(previewEstimatedNetPay)}
                  </span>
                </p>
                <p className="text-xs text-slate-500">
                  Estimated — final Net Pay is calculated in Payroll
                  Processing.
                </p>
              </div>
            </div>
            ) : null}

            <div className="space-y-4">
              <SectionHeading title="Emergency Contact" />
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-2">
                <Field label="Name">
                  <input
                    type="text"
                    value={form.emergency_contact_name}
                    onChange={(e) =>
                      updateField("emergency_contact_name", e.target.value)
                    }
                    className={inputClassName}
                  />
                </Field>
                <Field label="Relationship">
                  <input
                    type="text"
                    value={form.emergency_contact_relationship}
                    onChange={(e) =>
                      updateField("emergency_contact_relationship", e.target.value)
                    }
                    className={inputClassName}
                  />
                </Field>
                <Field label="Phone">
                  <input
                    type="text"
                    value={form.emergency_contact_phone}
                    onChange={(e) =>
                      updateField("emergency_contact_phone", e.target.value)
                    }
                    className={inputClassName}
                  />
                </Field>
                <Field label="Address">
                  <input
                    type="text"
                    value={form.emergency_contact_address}
                    onChange={(e) =>
                      updateField("emergency_contact_address", e.target.value)
                    }
                    className={inputClassName}
                  />
                </Field>
              </div>
            </div>

            <div className="space-y-4">
              <SectionHeading title="Notes" />
              <Field label="Data Notes">
                  <textarea
                    rows={3}
                    value={form.data_notes}
                    onChange={(e) => updateField("data_notes", e.target.value)}
                    className={textareaClassName}
                    placeholder="Flag data quality issues or other notes about this record…"
                  />
                </Field>
              </div>

            {showChangeReasonField ? (
              <div className="space-y-4">
                <SectionHeading title="Employment Change" />
                <Field label="Reason for change">
                  <textarea
                    rows={2}
                    value={changeReason}
                    onChange={(e) => setChangeReason(e.target.value)}
                    className={textareaClassName}
                    placeholder={
                      editingEmployeeId
                        ? "Optional — why this employment change is being made…"
                        : 'Optional — blank defaults to "Employee created"'
                    }
                  />
                </Field>
                {editingEmployeeId && trackedFieldsDirty ? (
                  <p className="text-xs text-slate-500">
                    A tracked employment field has changed. Saving will add one
                    employment history row.
                  </p>
                ) : null}
              </div>
            ) : null}

            {editingEmployeeId ? (
              <div className="space-y-4">
                <SectionHeading title="Employment History" />
                <p className="text-sm text-slate-600">
                  Read-only record of position, department, shift, status, and
                  compensation changes.
                </p>
                {historyLoading ? (
                  <p className="text-sm text-slate-500">Loading history…</p>
                ) : (
                  <ScrollableTable>
                    <table className={scrollableTableClassName}>
                      <thead className={scrollableTableHeadClassName}>
                        <tr>
                          <th className={scrollableTableThClassName}>
                            Effective
                          </th>
                          <th className={scrollableTableThClassName}>
                            Position
                          </th>
                          <th className={scrollableTableThClassName}>
                            Department
                          </th>
                          <th className={scrollableTableThClassName}>Shift</th>
                          <th className={scrollableTableThClassName}>Type</th>
                          <th className={scrollableTableThClassName}>
                            Basic
                          </th>
                          <th className={scrollableTableThClassName}>
                            Allowances
                          </th>
                          <th className={scrollableTableThClassName}>
                            Status
                          </th>
                          <th className={scrollableTableThClassName}>
                            Reason
                          </th>
                          <th className={scrollableTableThClassName}>
                            Changed By
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {employmentHistory.length === 0 ? (
                          <tr>
                            <td
                              colSpan={10}
                              className="px-4 py-6 text-center text-slate-500"
                            >
                              No employment history yet.
                            </td>
                          </tr>
                        ) : (
                          employmentHistory.map((entry, index) => (
                            <tr
                              key={entry.history_id}
                              className={getStripedRowClassName(index)}
                            >
                              <td className="px-4 py-3 whitespace-nowrap">
                                {entry.effective_date
                                  ? toDateInputValue(entry.effective_date)
                                  : "—"}
                              </td>
                              <td className="px-4 py-3">
                                {entry.position ?? "—"}
                              </td>
                              <td className="px-4 py-3">
                                {getDepartmentName(
                                  departmentNameMap,
                                  entry.department,
                                )}
                              </td>
                              <td className="px-4 py-3">
                                {entry.shift ?? "—"}
                              </td>
                              <td className="px-4 py-3">
                                {entry.employment_type}
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap">
                                {formatGHS(entry.basic_salary)}
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap">
                                {formatGHS(
                                  Number(entry.housing_allowance || 0) +
                                    Number(entry.transport_allowance || 0) +
                                    Number(entry.other_allowances || 0),
                                )}
                              </td>
                              <td className="px-4 py-3">
                                {entry.employee_status}
                              </td>
                              <td className="max-w-[12rem] truncate px-4 py-3">
                                {entry.change_reason ?? "—"}
                              </td>
                              <td className="max-w-[10rem] truncate px-4 py-3">
                                {entry.changed_by ?? "—"}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </ScrollableTable>
                )}
              </div>
            ) : null}

            <div className="flex gap-3">
              {canEditEmployees ? (
              <button
                type="submit"
                disabled={loading}
                className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading
                  ? "Saving…"
                  : editingEmployeeId
                    ? "Save Changes"
                    : "Add Employee"}
              </button>
              ) : null}
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

      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  ref={(input) => {
                    if (input) {
                      input.indeterminate = someVisibleSelected;
                    }
                  }}
                  onChange={toggleSelectAllVisible}
                  aria-label="Select all visible employees"
                  className="h-4 w-4 rounded border-slate-300"
                />
              </th>
              <th className={scrollableTableThClassName}>Photo</th>
              <SortableHeader
                label="Staff ID"
                column="staff_id"
                sortColumn={sortColumn}
                sortDirection={sortDirection}
                onSort={handleSort}
              />
              <SortableHeader
                label="Full Name"
                column="full_name"
                sortColumn={sortColumn}
                sortDirection={sortDirection}
                onSort={handleSort}
              />
              <SortableHeader
                label="Department"
                column="department"
                sortColumn={sortColumn}
                sortDirection={sortDirection}
                onSort={handleSort}
              />
              <SortableHeader
                label="Position"
                column="position"
                sortColumn={sortColumn}
                sortDirection={sortDirection}
                onSort={handleSort}
              />
              <SortableHeader
                label="Contract/Project"
                column="contract_project"
                sortColumn={sortColumn}
                sortDirection={sortDirection}
                onSort={handleSort}
              />
              <SortableHeader
                label="Employment Type"
                column="employment_type"
                sortColumn={sortColumn}
                sortDirection={sortDirection}
                onSort={handleSort}
              />
              <SortableHeader
                label="Employment Status"
                column="employment_status"
                sortColumn={sortColumn}
                sortDirection={sortDirection}
                onSort={handleSort}
              />
              {canViewSalary ? (
              <>
              <SortableHeader
                label="Basic Salary"
                column="basic_salary"
                sortColumn={sortColumn}
                sortDirection={sortDirection}
                onSort={handleSort}
              />
              <SortableHeader
                label="Gross Monthly Pay"
                column="gross_monthly_pay"
                sortColumn={sortColumn}
                sortDirection={sortDirection}
                onSort={handleSort}
              />
              <SortableHeader
                label="Current Net Pay"
                column="current_net_pay"
                sortColumn={sortColumn}
                sortDirection={sortDirection}
                onSort={handleSort}
                title={`Net pay for ${netPayPeriodLabel} (current payroll period)`}
              />
              </>
              ) : null}
              <th className={scrollableTableThClassName}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {displayEmployees.length === 0 ? (
              <tr>
                <td
                  colSpan={tableColumnCount}
                  className="px-4 py-8 text-center text-slate-500"
                >
                  No employees match the current filters.
                </td>
              </tr>
            ) : (
              displayEmployees.map((employee, index) => {
                const listPay =
                  listCompensationByEmployeeId[employee.employee_id];
                const currentNetPay = netPayByEmployeeId[employee.employee_id];
                const isSelected = selectedEmployeeIds.has(employee.employee_id);

                return (
                  <tr
                    key={employee.employee_id}
                    className={`${getStripedRowClassName(index)} cursor-pointer hover:bg-slate-100 ${
                      isSelected ? "bg-slate-100" : ""
                    }`}
                    onClick={() => openEmployeeForm(employee)}
                  >
                    <td
                      className="px-4 py-3"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() =>
                          toggleEmployeeSelection(employee.employee_id)
                        }
                        aria-label={`Select ${employee.full_name}`}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <EmployeePhotoAvatar
                        photoUrl={employee.photo_url}
                        fullName={employee.full_name}
                        size="sm"
                      />
                    </td>
                    <td className="px-4 py-3">{employee.staff_id}</td>
                    <td className="px-4 py-3">{employee.full_name}</td>
                    <td className="px-4 py-3">
                      {getDepartmentName(
                        departmentNameMap,
                        employee.department,
                        employee.department_ref,
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {getPositionName(lookups.positions, employee.position)}
                    </td>
                    <td className="px-4 py-3">
                      {getProjectName(
                        projectNameMap,
                        employee.contract_project,
                        employee.project_ref,
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {employee.employment_type ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      {employee.employment_status ?? "—"}
                    </td>
                    {canViewSalary ? (
                    <>
                    <td className="px-4 py-3">
                      {formatGHS(listPay?.basic_salary ?? 0)}
                    </td>
                    <td className="px-4 py-3">
                      {formatGHS(listPay?.gross_monthly ?? 0)}
                    </td>
                    <td
                      className="px-4 py-3"
                      title={
                        currentNetPay == null
                          ? undefined
                          : `Net pay for ${netPayPeriodLabel}`
                      }
                    >
                      {currentNetPay == null ? "—" : formatGHS(currentNetPay)}
                    </td>
                    </>
                    ) : null}
                    <EmployeeRowActions
                      onView={() => openEmployeeForm(employee)}
                      onEdit={() => openEmployeeForm(employee)}
                      onDelete={() => handleDelete(employee.employee_id)}
                      deleting={deletingEmployeeId === employee.employee_id}
                      canEdit={canEditEmployees}
                      canDelete={canEditEmployees}
                    />
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </ScrollableTable>
    </div>
  );
}
