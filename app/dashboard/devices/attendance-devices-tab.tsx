"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { inputClassName } from "../employees/employee-record-utils";
import { useAlert, useConfirm, useToast } from "@/components/feedback/feedback-context";
import DashboardButton from "@/components/dashboard-button";
import {
  HR_EMPLOYEE_SELECT,
  filterActiveEmployees,
  type HrEmployee,
} from "../hr-payroll/employee-utils";
import {
  SITE_ASSIGNMENT_SELECT,
  normalizeSiteEntry,
  type SiteEntry,
} from "../operations/sites-utils";
import {
  useBusinessUnitReadScope,
  useBusinessUnitView,
} from "@/app/dashboard/business-unit-view-context";
import { applyBusinessUnitScope } from "@/utils/business-unit-view";
import {
  applyAttendanceDeviceReadScope,
  applyStaffIdScope,
  fetchScopedStaffIds,
  filterRowsByStaffIdScope,
} from "@/app/dashboard/hr-payroll/payroll-bu-scope-utils";
import {
  assertTenantIdForMutation,
  tenantScopedDelete,
  tenantScopedUpdate,
} from "@/utils/tenant-scoped-supabase";
import { isPostgresUniqueViolation } from "@/utils/postgres-fk-violation";
import FilteredListCount, {
  anyRegisterColumnFiltersActive,
} from "../filtered-list-count";
import ScrollableTable, {
  scrollableTableActionsTdClassName,
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableHeadingClassName,
  scrollableTableNoTruncateCellClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import { useTenantDeviceSettings } from "@/hooks/use-tenant-device-settings";
import { hasRecentDeviceContact } from "@/lib/attendance-requests/rules";
import {
  COMPANY_WIDE_STAFF_GROUP,
  COMPANY_WIDE_STAFF_LABEL,
  DAVORS_OWN_STAFF_GROUP,
  DAVORS_OWN_STAFF_LABEL,
  buildStaffGroups,
  deviceStaffGroupLabel,
  employeeMatchesStaffGroup,
  findStaffGroup,
  staffGroupIsSelectable,
  staffGroupKeyForProject,
  withSiteCounts,
  type StaffGroupProject,
} from "@/lib/attendance-staff-groups";
import DeviceSettingsForm from "./device-settings-form";
import OutageAttendancePanel from "./outage-attendance-panel";
import AttendanceReviewPanel from "./attendance-review-panel";
import {
  RegisterColumnFilterHeader,
  collectDistinctColumnValues,
  columnValuePassesFilter,
  registerColumnSortConfig,
  sortRegisterRows,
  type RegisterColumnFilterValue,
  type RegisterColumnSortState,
} from "../finance/register-column-filter";
import {
  devicePinClashMessage,
  findDevicePinClash,
  normalizeDevicePin,
  pinFromStaffId,
} from "@/lib/device-pin";
import CollapsibleDeviceSection from "./collapsible-device-section";
import ScannerSimulatorPanel from "./scanner-simulator-panel";
import {
  generatePushTokenClient,
  hashPushTokenClient,
} from "@/lib/hikvision/push-token-client";

type AttendanceDeviceRow = {
  id: string;
  tenant_id: string;
  serial_number: string | null;
  device_name: string | null;
  site_code: string | null;
  contract_project: string | null;
  company_wide: boolean;
  business_unit_id: string | null;
  status: string;
  last_seen_at: string | null;
  firmware_info: string | null;
  brand: string | null;
  protocol: string | null;
  mac_address: string | null;
  push_token_hash: string | null;
};

type HikvisionTokenSetup = {
  deviceLabel: string;
  token: string;
  urlPath: string;
};

const ADMS_BRANDS = ["zkteco", "essl", "anviz"] as const;
type AdmsBrand = (typeof ADMS_BRANDS)[number];
type DeviceBrand = AdmsBrand | "hikvision";

function normalizeDeviceBrand(
  brand: string | null | undefined,
  protocol?: string | null,
): DeviceBrand {
  if (protocol === "isapi") {
    return "hikvision";
  }
  const key = (brand ?? "").trim().toLowerCase();
  if (key === "hikvision") {
    return "hikvision";
  }
  if (key === "essl" || key === "e-ssl") {
    return "essl";
  }
  if (key === "anviz") {
    return "anviz";
  }
  return "zkteco";
}

function deviceBrandLabel(brand: DeviceBrand): string {
  if (brand === "hikvision") {
    return "Hikvision";
  }
  if (brand === "essl") {
    return "eSSL";
  }
  if (brand === "anviz") {
    return "Anviz";
  }
  return "ZKTeco";
}

function isHikvisionDevice(device: {
  protocol?: string | null;
  brand?: string | null;
}): boolean {
  return normalizeDeviceBrand(device.brand, device.protocol) === "hikvision";
}

function isAdmsBrand(brand: string): brand is AdmsBrand {
  return (ADMS_BRANDS as readonly string[]).includes(brand);
}

function portalPublicHost(): { host: string; origin: string } {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) {
    try {
      const url = new URL(
        /^https?:\/\//i.test(configured) ? configured : `https://${configured}`,
      );
      return { host: url.hostname, origin: url.origin.replace(/\/$/, "") };
    } catch {
      /* fall through */
    }
  }
  if (typeof window !== "undefined") {
    return {
      host: window.location.hostname,
      origin: window.location.origin.replace(/\/$/, ""),
    };
  }
  return { host: "your-domain.com", origin: "https://your-domain.com" };
}

type BiometricPinRow = {
  id: string;
  tenant_id: string;
  staff_id: string;
  device_pin: string;
};

type UnclaimedDevice = {
  serial_number: string;
  last_seen_at: string;
};

type AttendanceDevicesTabProps = {
  tenantId: string | null;
  canWriteDevices: boolean;
  canDeleteDevices: boolean;
  canSetClockOut: boolean;
  canReprocessPunches: boolean;
  showScannerSimulator?: boolean;
};

type RecentPunch = {
  id: string;
  staff_id: string | null;
  device_pin: string;
  punch_time: string;
};

function formatUpdatedClock(date: Date): string {
  return date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function isDeviceOnline(
  lastSeenAt: string | null,
  offlineAlertMinutes: number,
): boolean {
  return hasRecentDeviceContact(lastSeenAt, offlineAlertMinutes);
}

function statusLabel(status: string): string {
  return status === "disabled" ? "Disabled" : "Active";
}

function AdmsSetupCard({
  brand,
  serialNumber,
  serverHost,
}: {
  brand: AdmsBrand;
  serialNumber?: string | null;
  serverHost: string;
}) {
  const label = deviceBrandLabel(brand);
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="text-base font-semibold text-[#0f2744]">
        {label} ADMS setup
      </h3>
      {serialNumber ? (
        <p className="mt-1 font-mono text-sm text-slate-600">{serialNumber}</p>
      ) : null}
      <p className="mt-2 text-sm text-slate-600">
        Server address: <span className="font-mono">{serverHost}</span>, port{" "}
        <span className="font-mono">443</span>, HTTPS on.
      </p>
      {brand === "anviz" || brand === "essl" ? (
        <p className="mt-2 text-sm text-slate-700">
          Your device must have an ADMS / Cloud Server / Push setting in its Comm
          or Network menu. Models that only connect to the maker&apos;s own cloud
          app will not work.
        </p>
      ) : null}
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-700">
        <li>On the device, open Comm → Cloud Server / ADMS.</li>
        <li>Enter the domain name above and enable domain name mode.</li>
        <li>Turn HTTPS on, then save.</li>
        <li>
          Within about a minute the device should show Online in the list above.
        </li>
      </ol>
    </section>
  );
}

function HikvisionOneTimeSetupCard({
  setup,
  host,
  onCopy,
  onDismiss,
}: {
  setup: HikvisionTokenSetup;
  host: string;
  onCopy: (label: string, value: string) => void;
  onDismiss: () => void;
}) {
  const fields = [
    { label: "Protocol", value: "HTTPS" },
    { label: "Host", value: host },
    { label: "Port", value: "443" },
    { label: "URL path", value: setup.urlPath },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-lg">
        <h3 className="text-lg font-semibold text-[#0f2744]">
          Hikvision HTTP Listening setup
        </h3>
        <p className="mt-1 text-sm font-medium text-amber-800">
          Shown once — copy now. The raw link is not stored and cannot be recovered.
        </p>
        <p className="mt-2 text-sm text-slate-600">{setup.deviceLabel}</p>
        <div className="mt-4 space-y-3">
          {fields.map((field) => (
            <div
              key={field.label}
              className="flex items-start justify-between gap-3 rounded border border-slate-200 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  {field.label}
                </p>
                <p className="break-all font-mono text-sm text-slate-900">
                  {field.value}
                </p>
              </div>
              <DashboardButton
                type="button"
                variant="secondary"
                onClick={() => onCopy(field.label, field.value)}
              >
                Copy
              </DashboardButton>
            </div>
          ))}
        </div>
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-slate-700">
          <li>
            On the scanner&apos;s web page go to Network → Advanced → HTTP Listening
            (some models: Event → Alarm Linkage / HTTP Host).
          </li>
          <li>Enter the values above.</li>
          <li>Turn off picture upload if the option exists.</li>
          <li>Set the scanner&apos;s time zone and time correctly.</li>
          <li>
            Enrol each person on the scanner with Employee No. = their staff number
            without letters or leading zeros (DF0020 → 20).
          </li>
        </ol>
        <div className="mt-6 flex justify-end">
          <DashboardButton type="button" onClick={onDismiss}>
            Done
          </DashboardButton>
        </div>
      </div>
    </div>
  );
}

export default function AttendanceDevicesTab({
  tenantId,
  canWriteDevices,
  canDeleteDevices,
  canSetClockOut,
  canReprocessPunches,
  showScannerSimulator = false,
}: AttendanceDevicesTabProps) {
  const supabase = useMemo(() => createClient(), []);
  const deviceSettings = useTenantDeviceSettings();
  const offlineAlertMinutes = deviceSettings.offline_alert_minutes;
  const { toast } = useToast();
  const { alertError } = useAlert();
  const confirm = useConfirm();
  const { units: businessUnits } = useBusinessUnitView();
  const buReadScope = useBusinessUnitReadScope();
  const [devices, setDevices] = useState<AttendanceDeviceRow[]>([]);
  const [projects, setProjects] = useState<StaffGroupProject[]>([]);
  const [sites, setSites] = useState<SiteEntry[]>([]);
  const [employees, setEmployees] = useState<HrEmployee[]>([]);
  const [pinRows, setPinRows] = useState<BiometricPinRow[]>([]);
  const [punchDeviceIds, setPunchDeviceIds] = useState<Set<string>>(new Set());
  const [unclaimed, setUnclaimed] = useState<UnclaimedDevice[]>([]);
  const [recentPunches, setRecentPunches] = useState<RecentPunch[]>([]);
  const [editingPinStaffId, setEditingPinStaffId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [deviceRefreshFailed, setDeviceRefreshFailed] = useState(false);
  const [reviewRefreshFailed, setReviewRefreshFailed] = useState(false);
  const [reviewRefreshToken, setReviewRefreshToken] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [simulatorDevice, setSimulatorDevice] = useState<AttendanceDeviceRow | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [hikvisionSetup, setHikvisionSetup] = useState<HikvisionTokenSetup | null>(
    null,
  );
  const [form, setForm] = useState({
    device_name: "",
    brand: "zkteco",
    serial_number: "",
    staff_group: "",
    site_code: "",
    business_unit_id: "",
    status: "active",
  });
  const [pinDrafts, setPinDrafts] = useState<Record<string, string>>({});
  const pinInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const serialInputRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  const [nameFilter, setNameFilter] = useState<RegisterColumnFilterValue>(null);
  const [brandFilter, setBrandFilter] = useState<RegisterColumnFilterValue>(null);
  const [serialFilter, setSerialFilter] =
    useState<RegisterColumnFilterValue>(null);
  const [macFilter, setMacFilter] = useState<RegisterColumnFilterValue>(null);
  const [staffGroupFilter, setStaffGroupFilter] =
    useState<RegisterColumnFilterValue>(null);
  const [siteFilter, setSiteFilter] = useState<RegisterColumnFilterValue>(null);
  const [pinStaffGroup, setPinStaffGroup] = useState("all");
  const [buFilter, setBuFilter] = useState<RegisterColumnFilterValue>(null);
  const [statusFilter, setStatusFilter] =
    useState<RegisterColumnFilterValue>(null);
  const [connectionFilter, setConnectionFilter] =
    useState<RegisterColumnFilterValue>(null);
  const [firmwareFilter, setFirmwareFilter] =
    useState<RegisterColumnFilterValue>(null);
  const [deviceSort, setDeviceSort] = useState<RegisterColumnSortState | null>(
    null,
  );

  const [staffFilter, setStaffFilter] = useState<RegisterColumnFilterValue>(null);
  const [employeeNameFilter, setEmployeeNameFilter] =
    useState<RegisterColumnFilterValue>(null);
  const [pinFilter, setPinFilter] = useState<RegisterColumnFilterValue>(null);
  const [pinSort, setPinSort] = useState<RegisterColumnSortState | null>(null);

  const siteNameByCode = useMemo(() => {
    const map = new Map<string, string>();
    for (const site of sites) {
      map.set(site.site_code, site.site_name);
    }
    return map;
  }, [sites]);

  const buNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const unit of businessUnits) {
      map.set(unit.id, unit.name);
    }
    return map;
  }, [businessUnits]);

  const pinByStaffId = useMemo(() => {
    const map = new Map<string, BiometricPinRow>();
    for (const row of pinRows) {
      map.set(row.staff_id, row);
    }
    return map;
  }, [pinRows]);

  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    if (!silent) {
      setLoading(true);
    }
    let ok = true;

    const scopedStaff =
      tenantId != null
        ? await fetchScopedStaffIds(supabase, tenantId, buReadScope)
        : { staffIds: null as string[] | null, error: null as string | null };
    if (scopedStaff.error) {
      ok = false;
      if (!silent) {
        void alertError(scopedStaff.error, {
          title: "Could not resolve business unit staff",
        });
      }
    }
    const staffIds = scopedStaff.error ? [] : scopedStaff.staffIds;

    const [
      devicesResult,
      projectsResult,
      sitesResult,
      employeesResult,
      pinsResult,
      punchesResult,
      recentResult,
      unclaimedResponse,
    ] = await Promise.all([
      applyAttendanceDeviceReadScope(
        supabase
          .from("attendance_devices")
          .select(
            "id, tenant_id, serial_number, device_name, site_code, contract_project, company_wide, business_unit_id, status, last_seen_at, firmware_info, brand, protocol, mac_address, push_token_hash",
          ),
        buReadScope,
      ).order("device_name", { ascending: true }),
      supabase
        .from("projects")
        .select("project_code, project_name, service_contract_id, is_archived")
        .order("project_name"),
      supabase.from("sites").select(SITE_ASSIGNMENT_SELECT).order("site_name"),
      applyBusinessUnitScope(
        supabase.from("employees").select(HR_EMPLOYEE_SELECT),
        buReadScope,
      ),
      applyStaffIdScope(
        supabase
          .from("employee_biometric_ids")
          .select("id, tenant_id, staff_id, device_pin"),
        staffIds,
      ),
      supabase.from("biometric_punches").select("device_id"),
      supabase
        .from("biometric_punches")
        .select("id, staff_id, device_pin, punch_time")
        .order("punch_time", { ascending: false })
        .limit(80),
      fetch("/api/attendance/unclaimed-devices"),
    ]);

    if (devicesResult.error) {
      ok = false;
      if (!silent) {
        void alertError(devicesResult.error.message, {
          title: "Could not load attendance devices",
        });
      }
    } else {
      setDevices((devicesResult.data as AttendanceDeviceRow[] | null) ?? []);
    }

    if (projectsResult.error) {
      ok = false;
      if (!silent) {
        void alertError(projectsResult.error.message, {
          title: "Could not load contracts",
        });
      }
    } else {
      setProjects((projectsResult.data as StaffGroupProject[] | null) ?? []);
    }

    if (sitesResult.error) {
      ok = false;
      if (!silent) {
        void alertError(sitesResult.error.message, {
          title: "Could not load sites",
        });
      }
    } else {
      setSites(
        (sitesResult.data ?? []).map((row) =>
          normalizeSiteEntry(row as unknown as SiteEntry),
        ),
      );
    }

    if (employeesResult.error) {
      ok = false;
      if (!silent) {
        void alertError(employeesResult.error.message, {
          title: "Could not load employees",
        });
      }
    } else {
      setEmployees(
        filterActiveEmployees((employeesResult.data as HrEmployee[] | null) ?? []),
      );
    }

    if (pinsResult.error) {
      ok = false;
      if (!silent) {
        void alertError(pinsResult.error.message, {
          title: "Could not load PIN mappings",
        });
      }
    } else {
      const pinRowsRaw = (pinsResult.data as BiometricPinRow[] | null) ?? [];
      setPinRows(
        staffIds === null
          ? pinRowsRaw
          : pinRowsRaw.filter((row) =>
              staffIds.includes(String(row.staff_id ?? "").trim()),
            ),
      );
    }

    if (punchesResult.error || recentResult.error) {
      ok = false;
      if (!silent) {
        void alertError(
          punchesResult.error?.message ??
            recentResult.error?.message ??
            "Could not load punches.",
          { title: "Could not load punches" },
        );
      }
    } else {
      const scopedDeviceIds = new Set(
        ((devicesResult.data as AttendanceDeviceRow[] | null) ?? []).map(
          (device) => device.id,
        ),
      );
      const punchIds = new Set<string>();
      for (const row of (punchesResult.data as { device_id: string | null }[] | null) ??
        []) {
        if (
          row.device_id &&
          (buReadScope.mode === "all" || scopedDeviceIds.has(row.device_id))
        ) {
          punchIds.add(row.device_id);
        }
      }
      setPunchDeviceIds(punchIds);
      const recentRaw = (recentResult.data as RecentPunch[] | null) ?? [];
      setRecentPunches(
        filterRowsByStaffIdScope(recentRaw, staffIds).slice(0, 30),
      );
    }

    const unclaimedBody = (await unclaimedResponse.json().catch(() => null)) as
      | { devices?: UnclaimedDevice[]; error?: string }
      | null;
    if (!unclaimedResponse.ok) {
      ok = false;
      if (!silent) {
        void alertError(unclaimedBody?.error ?? "Could not load unclaimed devices.", {
          title: "Could not load waiting devices",
        });
      }
    } else {
      setUnclaimed(unclaimedBody?.devices ?? []);
    }

    if (!silent) {
      setLoading(false);
    }
    if (ok) {
      setUpdatedAt(new Date());
      setDeviceRefreshFailed(false);
    } else if (silent) {
      setDeviceRefreshFailed(true);
    }
    return ok;
  }, [alertError, buReadScope, supabase, tenantId]);

  const refreshLive = useCallback(async () => {
    await refresh({ silent: true });
    setReviewRefreshToken((current) => current + 1);
  }, [refresh]);

  useEffect(() => {
    const intervalMs = 15_000;
    let timer: number | null = null;
    let wasHidden = document.visibilityState === "hidden";

    function start() {
      if (timer != null) {
        return;
      }
      timer = window.setInterval(() => {
        void refreshLive();
      }, intervalMs);
    }

    function stop() {
      if (timer != null) {
        window.clearInterval(timer);
        timer = null;
      }
    }

    function onVisibility() {
      if (document.visibilityState === "hidden") {
        wasHidden = true;
        stop();
        return;
      }
      if (wasHidden) {
        wasHidden = false;
        void refreshLive();
      }
      start();
    }

    if (document.visibilityState === "visible") {
      start();
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refreshLive]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const groupedProjects = useMemo(
    () =>
      withSiteCounts(
        projects,
        sites.map((site) => site.project?.project_code),
      ),
    [projects, sites],
  );
  const staffGroups = useMemo(
    () => buildStaffGroups(groupedProjects),
    [groupedProjects],
  );
  const selectableStaffGroups = useMemo(
    () =>
      staffGroups.filter((group) =>
        staffGroupIsSelectable(group, groupedProjects),
      ),
    [groupedProjects, staffGroups],
  );

  const filteredDevices = useMemo(() => {
    const rows = devices.filter((device) => {
      const siteName = device.site_code
        ? (siteNameByCode.get(device.site_code) ?? device.site_code)
        : "";
      const staffGroup = deviceStaffGroupLabel(device, groupedProjects);
      const buName = device.business_unit_id
        ? (buNameById.get(device.business_unit_id) ?? "")
        : "";
      const brandLabel = deviceBrandLabel(
        normalizeDeviceBrand(device.brand, device.protocol),
      );
      return (
        columnValuePassesFilter(device.device_name, nameFilter) &&
        columnValuePassesFilter(brandLabel, brandFilter) &&
        columnValuePassesFilter(device.serial_number, serialFilter) &&
        columnValuePassesFilter(device.mac_address, macFilter) &&
        columnValuePassesFilter(staffGroup, staffGroupFilter) &&
        columnValuePassesFilter(siteName, siteFilter) &&
        columnValuePassesFilter(buName, buFilter) &&
        columnValuePassesFilter(statusLabel(device.status), statusFilter) &&
        columnValuePassesFilter(
          isDeviceOnline(device.last_seen_at, offlineAlertMinutes)
            ? "Online"
            : "Offline",
          connectionFilter,
        ) &&
        columnValuePassesFilter(device.firmware_info, firmwareFilter)
      );
    });
    return sortRegisterRows(rows, deviceSort, (device) => {
      switch (deviceSort?.columnId) {
        case "brand":
          return deviceBrandLabel(
            normalizeDeviceBrand(device.brand, device.protocol),
          );
        case "serial":
          return device.serial_number;
        case "mac":
          return device.mac_address;
        case "staff_group":
          return deviceStaffGroupLabel(device, groupedProjects);
        case "site":
          return device.site_code
            ? (siteNameByCode.get(device.site_code) ?? device.site_code)
            : "";
        case "business_unit":
          return device.business_unit_id
            ? (buNameById.get(device.business_unit_id) ?? "")
            : "";
        case "status":
          return statusLabel(device.status);
        case "connection":
          return isDeviceOnline(device.last_seen_at, offlineAlertMinutes)
            ? "Online"
            : "Offline";
        case "last_seen":
          return device.last_seen_at;
        case "firmware":
          return device.firmware_info;
        default:
          return device.device_name;
      }
    });
  }, [
    devices,
    nameFilter,
    brandFilter,
    serialFilter,
    macFilter,
    staffGroupFilter,
    siteFilter,
    buFilter,
    statusFilter,
    connectionFilter,
    firmwareFilter,
    deviceSort,
    siteNameByCode,
    groupedProjects,
    buNameById,
    offlineAlertMinutes,
  ]);

  const filteredEmployees = useMemo(() => {
    const rows = employees.filter((employee) => {
      if (
        !employeeMatchesStaffGroup(
          employee.contract_project,
          pinStaffGroup,
          groupedProjects,
        )
      ) {
        return false;
      }
      const existing = pinByStaffId.get(employee.staff_id);
      const pin = existing ? normalizeDevicePin(existing.device_pin) : "";
      return (
        columnValuePassesFilter(employee.staff_id, staffFilter) &&
        columnValuePassesFilter(employee.full_name, employeeNameFilter) &&
        columnValuePassesFilter(pin, pinFilter)
      );
    });
    return sortRegisterRows(rows, pinSort, (employee) => {
      if (pinSort?.columnId === "staff_id") {
        return employee.staff_id;
      }
      if (pinSort?.columnId === "pin") {
        const existing = pinByStaffId.get(employee.staff_id);
        return existing ? normalizeDevicePin(existing.device_pin) : "";
      }
      return employee.full_name;
    });
  }, [
    employees,
    pinByStaffId,
    staffFilter,
    employeeNameFilter,
    pinFilter,
    pinSort,
    pinStaffGroup,
    groupedProjects,
  ]);

  function openAddDevice(prefillSerial?: string) {
    setEditingId(null);
    setForm({
      device_name: "",
      brand: "zkteco",
      serial_number: prefillSerial ?? "",
      staff_group: "",
      site_code: "",
      business_unit_id: "",
      status: "active",
    });
    setFormOpen(true);
  }

  function openEditDevice(device: AttendanceDeviceRow) {
    setEditingId(device.id);
    setForm({
      device_name: device.device_name ?? "",
      brand: normalizeDeviceBrand(device.brand, device.protocol),
      serial_number: device.serial_number ?? "",
      staff_group: device.company_wide
        ? COMPANY_WIDE_STAFF_GROUP
        : (staffGroupKeyForProject(device.contract_project, groupedProjects) ?? ""),
      site_code: device.site_code ?? "",
      business_unit_id: device.business_unit_id ?? "",
      status: device.status === "disabled" ? "disabled" : "active",
    });
    setFormOpen(true);
  }

  async function clearUnclaimedIfOwned(serial: string) {
    await fetch("/api/attendance/unclaimed-devices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serial_number: serial }),
    }).catch(() => null);
  }

  async function saveDevice(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    serialInputRef.current?.setCustomValidity("");
    if (!formRef.current?.reportValidity()) {
      return;
    }

    const selectedBrand = normalizeDeviceBrand(form.brand);
    const isHikvision = selectedBrand === "hikvision";
    const serial = form.serial_number.trim();
    if (!isHikvision && !serial) {
      serialInputRef.current?.setCustomValidity("Enter the device serial number.");
      serialInputRef.current?.reportValidity();
      return;
    }
    if (serial) {
      const duplicate = devices.find(
        (device) =>
          (device.serial_number ?? "") === serial && device.id !== editingId,
      );
      if (duplicate) {
        serialInputRef.current?.setCustomValidity(
          "This serial number is already registered.",
        );
        serialInputRef.current?.reportValidity();
        return;
      }
    }

    let scopedTenantId: string;
    try {
      scopedTenantId = assertTenantIdForMutation(tenantId);
    } catch (error) {
      void alertError(error, { title: "Could not save device" });
      return;
    }

    const companyWide = form.staff_group === COMPANY_WIDE_STAFF_GROUP;
    const selectedGroup = companyWide
      ? null
      : findStaffGroup(form.staff_group, groupedProjects);
    if (!form.staff_group || (!companyWide && !selectedGroup)) {
      void alertError("Choose a staff group.", { title: "Could not save device" });
      return;
    }

    if (!canWriteDevices) {
      void alertError("You do not have permission to change attendance devices.", {
        title: "Could not save device",
      });
      return;
    }

    let pushToken: string | null = null;
    let pushTokenHash: string | null = null;
    if (isHikvision && !editingId) {
      pushToken = generatePushTokenClient();
      pushTokenHash = await hashPushTokenClient(pushToken);
    }

    const payload: Record<string, unknown> = {
      tenant_id: scopedTenantId,
      device_name: form.device_name.trim() || null,
      serial_number: serial || null,
      brand: selectedBrand,
      protocol: isHikvision ? "isapi" : "adms",
      company_wide: companyWide,
      contract_project: companyWide ? null : selectedGroup!.anchorProjectCode,
      site_code: companyWide ? null : form.site_code.trim() || null,
      business_unit_id: form.business_unit_id.trim() || null,
      status: form.status === "disabled" ? "disabled" : "active",
      updated_at: new Date().toISOString(),
    };
    if (pushTokenHash) {
      payload.push_token_hash = pushTokenHash;
    }

    if (editingId) {
      const { data: savedRows, error: updateError } = await tenantScopedUpdate(
        supabase,
        "attendance_devices",
        scopedTenantId,
        payload,
        { id: editingId },
      ).select("id, contract_project, company_wide");
      if (updateError) {
        if (isPostgresUniqueViolation(updateError)) {
          serialInputRef.current?.setCustomValidity(
            "This serial number is already registered.",
          );
          serialInputRef.current?.reportValidity();
          return;
        }
        void alertError(updateError.message, { title: "Could not save device" });
        return;
      }
      const saved = (savedRows ?? [])[0] as
        | { contract_project: string | null; company_wide: boolean | null }
        | undefined;
      if (!saved) {
        void alertError(
          "The device was not updated. Refresh the list and try again.",
          { title: "Could not save device" },
        );
        return;
      }
      const storedGroup = companyWide
        ? null
        : selectedGroup!.anchorProjectCode;
      if ((saved.contract_project ?? null) !== storedGroup) {
        void alertError(
          "The staff group was not stored on this device.",
          { title: "Could not save device" },
        );
        return;
      }
    } else {
      const { error: insertError } = await supabase
        .from("attendance_devices")
        .insert(payload);
      if (insertError) {
        if (isPostgresUniqueViolation(insertError)) {
          serialInputRef.current?.setCustomValidity(
            "This serial number is already registered.",
          );
          serialInputRef.current?.reportValidity();
          return;
        }
        void alertError(insertError.message, { title: "Could not save device" });
        return;
      }
      if (serial) {
        await clearUnclaimedIfOwned(serial);
      }
    }

    setFormOpen(false);
    toast("Device saved");
    if (pushToken) {
      setHikvisionSetup({
        deviceLabel: form.device_name.trim() || "Hikvision terminal",
        token: pushToken,
        urlPath: `/api/attendance/hikvision/${pushToken}`,
      });
    }
    await refresh();
  }

  async function regenerateHikvisionToken(device: AttendanceDeviceRow) {
    if (!canWriteDevices) {
      void alertError("You do not have permission to change attendance devices.", {
        title: "Could not regenerate link",
      });
      return;
    }
    const confirmed = await confirm({
      title: "Regenerate HTTP Listening link",
      message:
        "The old URL stops working immediately. You will need to paste the new path into the scanner. Continue?",
      confirmLabel: "Regenerate",
      destructive: true,
    });
    if (!confirmed) {
      return;
    }

    try {
      const scopedTenantId = assertTenantIdForMutation(tenantId);
      const token = generatePushTokenClient();
      const pushTokenHash = await hashPushTokenClient(token);
      const { error } = await tenantScopedUpdate(
        supabase,
        "attendance_devices",
        scopedTenantId,
        {
          push_token_hash: pushTokenHash,
          updated_at: new Date().toISOString(),
        },
        { id: device.id },
      );
      if (error) {
        void alertError(error.message, { title: "Could not regenerate link" });
        return;
      }
      setHikvisionSetup({
        deviceLabel: device.device_name?.trim() || device.serial_number || "Hikvision terminal",
        token,
        urlPath: `/api/attendance/hikvision/${token}`,
      });
      toast("New listening link ready — copy it now");
      await refresh();
    } catch (error) {
      void alertError(error, { title: "Could not regenerate link" });
    }
  }

  async function disableDevice(device: AttendanceDeviceRow) {
    const confirmed = await confirm({
      title: "Disable device",
      message: `Disable ${device.device_name?.trim() || device.serial_number || "this device"}? Punches already recorded are kept.`,
      confirmLabel: "Disable",
      destructive: true,
    });
    if (!confirmed) {
      return;
    }

    try {
      const scopedTenantId = assertTenantIdForMutation(tenantId);
      const { error: updateError } = await tenantScopedUpdate(
        supabase,
        "attendance_devices",
        scopedTenantId,
        { status: "disabled", updated_at: new Date().toISOString() },
        { id: device.id },
      );
      if (updateError) {
        void alertError(updateError.message, { title: "Could not disable device" });
        return;
      }
    } catch (error) {
      void alertError(error, { title: "Could not disable device" });
      return;
    }

    toast("Device disabled.");
    await refresh();
  }

  async function deleteDevice(device: AttendanceDeviceRow) {
    if (punchDeviceIds.has(device.id)) {
      void alertError(
        "This device has punches and cannot be deleted. Disable it instead.",
        { title: "Cannot delete device" },
      );
      return;
    }

    const confirmed = await confirm({
      title: "Delete device",
      message: `Permanently delete ${device.device_name?.trim() || device.serial_number || "this device"}? This is only allowed because no punches exist.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!confirmed) {
      return;
    }

    try {
      const scopedTenantId = assertTenantIdForMutation(tenantId);
      const { error: deleteError } = await tenantScopedDelete(
        supabase,
        "attendance_devices",
        scopedTenantId,
        { id: device.id },
      );
      if (deleteError) {
        void alertError(deleteError.message, { title: "Could not delete device" });
        return;
      }
    } catch (error) {
      void alertError(error, { title: "Could not delete device" });
      return;
    }

    toast("Device deleted.");
    await refresh();
  }

  async function savePin(staffId: string, existingId?: string) {
    if (!canWriteDevices) {
      void alertError("You do not have permission to assign attendance PINs.", {
        title: "Could not save PIN",
      });
      return;
    }
    const input = pinInputRefs.current[staffId];
    input?.setCustomValidity("");
    const pin = normalizeDevicePin(pinDrafts[staffId] ?? "");
    if (!pin) {
      input?.setCustomValidity("Enter a device PIN.");
      input?.reportValidity();
      return;
    }

    const employeeName = new Map(
      employees.map((employee) => [employee.staff_id, employee.full_name]),
    );
    const duplicate = findDevicePinClash(
      pin,
      staffId,
      pinRows.map((row) => ({
        ...row,
        full_name: employeeName.get(row.staff_id) ?? null,
      })),
    );
    if (duplicate) {
      input?.setCustomValidity(devicePinClashMessage(pin, duplicate));
      input?.reportValidity();
      return;
    }

    let scopedTenantId: string;
    try {
      scopedTenantId = assertTenantIdForMutation(tenantId);
    } catch (error) {
      void alertError(error, { title: "Could not save PIN" });
      return;
    }

    if (existingId) {
      const { error: updateError } = await tenantScopedUpdate(
        supabase,
        "employee_biometric_ids",
        scopedTenantId,
        { device_pin: pin },
        { id: existingId },
      );
      if (updateError) {
        if (isPostgresUniqueViolation(updateError)) {
          input?.setCustomValidity(devicePinClashMessage(pin, { staff_id: "another employee" }));
          input?.reportValidity();
          return;
        }
        void alertError(updateError.message, { title: "Could not save PIN" });
        return;
      }
    } else {
      const { error: insertError } = await supabase
        .from("employee_biometric_ids")
        .insert({ tenant_id: scopedTenantId, staff_id: staffId, device_pin: pin });
      if (insertError) {
        if (isPostgresUniqueViolation(insertError)) {
          input?.setCustomValidity(
            devicePinClashMessage(pin, { staff_id: "another employee" }),
          );
          input?.reportValidity();
          return;
        }
        void alertError(insertError.message, { title: "Could not save PIN" });
        return;
      }
    }

    setEditingPinStaffId(null);
    setPinDrafts((current) => {
      const next = { ...current };
      delete next[staffId];
      return next;
    });
    toast("PIN saved");
    await refresh();
  }

  async function autoAssignPins() {
    if (!canWriteDevices) {
      void alertError("You do not have permission to assign attendance PINs.", {
        title: "Could not assign PINs",
      });
      return;
    }
    let scopedTenantId: string;
    try {
      scopedTenantId = assertTenantIdForMutation(tenantId);
    } catch (error) {
      void alertError(error, { title: "Could not assign PINs" });
      return;
    }

    const known = pinRows.map((row) => ({ ...row }));
    const clashes: string[] = [];
    const skipped: string[] = [];
    let created = 0;
    for (const employee of employees) {
      if (known.some((row) => row.staff_id === employee.staff_id)) {
        continue;
      }
      const pin = pinFromStaffId(employee.staff_id);
      if (!pin) {
        skipped.push(`${employee.staff_id} has no digits`);
        continue;
      }
      const clash = findDevicePinClash(pin, employee.staff_id, known);
      if (clash) {
        clashes.push(devicePinClashMessage(pin, {
          staff_id: clash.staff_id,
          full_name: employees.find((row) => row.staff_id === clash.staff_id)?.full_name,
        }));
        continue;
      }
      const { error: insertError } = await supabase
        .from("employee_biometric_ids")
        .insert({
          tenant_id: scopedTenantId,
          staff_id: employee.staff_id,
          device_pin: pin,
        });
      if (insertError) {
        clashes.push(`${employee.staff_id}: ${insertError.message}`);
        continue;
      }
      known.push({
        id: "",
        tenant_id: scopedTenantId,
        staff_id: employee.staff_id,
        device_pin: pin,
      });
      created += 1;
    }

    toast(
      created === 1 ? "1 PIN created" : `${created} PINs created`,
    );
    if (clashes.length > 0 || skipped.length > 0) {
      void alertError([...clashes, ...skipped].join("\n"), {
        title: "Some PINs were not assigned",
      });
    }
    await refresh();
  }

  async function removePin(rowId: string) {
    const confirmed = await confirm({
      title: "Remove PIN",
      message: "Remove this employee PIN mapping from attendance devices?",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!confirmed) {
      return;
    }

    try {
      const scopedTenantId = assertTenantIdForMutation(tenantId);
      const { error: deleteError } = await tenantScopedDelete(
        supabase,
        "employee_biometric_ids",
        scopedTenantId,
        { id: rowId },
      );
      if (deleteError) {
        void alertError(deleteError.message, { title: "Could not remove PIN" });
        return;
      }
    } catch (error) {
      void alertError(error, { title: "Could not remove PIN" });
      return;
    }

    toast("PIN removed");
    await refresh();
  }

  async function reprocessUnprocessedPunches() {
    if (!canReprocessPunches) {
      void alertError(
        "Only HR, a director, or a super admin can reprocess attendance punches.",
        { title: "Could not reprocess punches" },
      );
      return;
    }
    const response = await fetch("/api/attendance/review/reprocess", {
      method: "POST",
    });
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) {
      void alertError(body?.error ?? "Could not reprocess punches.", {
        title: "Could not reprocess punches",
      });
      return;
    }
    toast("Punches reprocessed");
    await refresh();
  }

  const portalHost = portalPublicHost();
  const serverHost = portalHost.host;
  const deviceFiltersActive = anyRegisterColumnFiltersActive(
    nameFilter,
    brandFilter,
    serialFilter,
    macFilter,
    staffGroupFilter,
    siteFilter,
    buFilter,
    statusFilter,
    connectionFilter,
    firmwareFilter,
  );
  const pinFiltersActive =
    pinStaffGroup !== "all" ||
    anyRegisterColumnFiltersActive(staffFilter, employeeNameFilter, pinFilter);
  const selectedStaffGroup = staffGroups.find(
    (group) => group.key === form.staff_group,
  );
  const locationSites = sites.filter((site) =>
    selectedStaffGroup?.projectCodes.includes(site.project?.project_code ?? ""),
  );

  return (
    <div className="space-y-8">
      {loading ? (
        <p className="text-sm text-slate-600">Loading attendance devices…</p>
      ) : null}

      <CollapsibleDeviceSection
        storageKey="unclaimed-devices"
        title="Unclaimed devices"
        summary={
          unclaimed.length === 0
            ? "None waiting"
            : `${unclaimed.length} waiting to be registered`
        }
        defaultOpen={unclaimed.length > 0}
        tone="warning"
      >
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Serial</th>
                <th className={scrollableTableThClassName}>Last seen</th>
                <th className={scrollableTableThClassName}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {unclaimed.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-sm text-slate-500">
                    No unclaimed devices
                  </td>
                </tr>
              ) : (
                unclaimed.map((entry) => (
                  <tr key={entry.serial_number} className="border-b border-slate-100">
                    <td className="px-4 py-3 font-mono">{entry.serial_number}</td>
                    <td className="px-4 py-3">
                      {new Date(entry.last_seen_at).toLocaleString()}
                    </td>
                    <td className={scrollableTableActionsTdClassName}>
                      {canWriteDevices ? (
                        <DashboardButton
                          type="button"
                          variant="secondary"
                          onClick={() => openAddDevice(entry.serial_number)}
                        >
                          Register
                        </DashboardButton>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </ScrollableTable>
      </CollapsibleDeviceSection>

      <CollapsibleDeviceSection
        storageKey="devices-list"
        title="Attendance devices"
        summary={`${devices.length} registered`}
        defaultOpen
        meta={
          <span className="text-xs font-normal text-slate-500">
            {updatedAt ? `Updated ${formatUpdatedClock(updatedAt)}` : null}
            {deviceRefreshFailed || reviewRefreshFailed ? (
              <span className="text-amber-700">
                {updatedAt ? " " : null}
                Couldn&apos;t refresh — retrying
              </span>
            ) : null}
          </span>
        }
      >
        {canWriteDevices ? (
          <div className="mb-4">
            <DashboardButton type="button" onClick={() => openAddDevice()}>
              Add device
            </DashboardButton>
          </div>
        ) : null}

        <div className="mt-4">
          <FilteredListCount
            filteredCount={filteredDevices.length}
            totalCount={devices.length}
            itemSingular="device"
            hasActiveFilters={deviceFiltersActive}
          />
        </div>

        <div className="mt-4">
          <ScrollableTable>
            <table className={scrollableTableClassName}>
              <thead className={scrollableTableHeadClassName}>
                <tr>
                  <th className={scrollableTableHeadingClassName("Name")}>
                    <RegisterColumnFilterHeader
                      label="Name"
                      options={collectDistinctColumnValues(
                        devices.map((device) => device.device_name),
                      )}
                      applied={nameFilter}
                      onApply={setNameFilter}
                      sort={registerColumnSortConfig(
                        "name",
                        "text",
                        deviceSort,
                        setDeviceSort,
                      )}
                    />
                  </th>
                  <th className={scrollableTableHeadingClassName("Serial")}>
                    <RegisterColumnFilterHeader
                      label="Serial"
                      options={collectDistinctColumnValues(
                        devices.map((device) => device.serial_number),
                      )}
                      applied={serialFilter}
                      onApply={setSerialFilter}
                      sort={registerColumnSortConfig(
                        "serial",
                        "text",
                        deviceSort,
                        setDeviceSort,
                      )}
                    />
                  </th>
                  <th
                    className={`${scrollableTableHeadingClassName("Brand")} ${scrollableTableNoTruncateCellClassName}`}
                  >
                    <RegisterColumnFilterHeader
                      label="Brand"
                      options={collectDistinctColumnValues(
                        devices.map((device) =>
                          deviceBrandLabel(
                            normalizeDeviceBrand(device.brand, device.protocol),
                          ),
                        ),
                      )}
                      applied={brandFilter}
                      onApply={setBrandFilter}
                      sort={registerColumnSortConfig(
                        "brand",
                        "text",
                        deviceSort,
                        setDeviceSort,
                      )}
                    />
                  </th>
                  <th
                    className={`${scrollableTableHeadingClassName("MAC address")} ${scrollableTableNoTruncateCellClassName}`}
                  >
                    <RegisterColumnFilterHeader
                      label="MAC address"
                      options={collectDistinctColumnValues(
                        devices.map((device) => device.mac_address),
                      )}
                      applied={macFilter}
                      onApply={setMacFilter}
                      sort={registerColumnSortConfig(
                        "mac",
                        "text",
                        deviceSort,
                        setDeviceSort,
                      )}
                    />
                  </th>
                  <th className={scrollableTableHeadingClassName("Staff group")}>
                    <RegisterColumnFilterHeader
                      label="Staff group"
                      options={collectDistinctColumnValues(
                        devices.map((device) =>
                          deviceStaffGroupLabel(device, groupedProjects),
                        ),
                      )}
                      applied={staffGroupFilter}
                      onApply={setStaffGroupFilter}
                      sort={registerColumnSortConfig(
                        "staff_group",
                        "text",
                        deviceSort,
                        setDeviceSort,
                      )}
                    />
                  </th>
                  <th className={scrollableTableHeadingClassName("Location")}>
                    <RegisterColumnFilterHeader
                      label="Location"
                      options={collectDistinctColumnValues(
                        devices.map((device) =>
                          device.site_code
                            ? (siteNameByCode.get(device.site_code) ??
                              device.site_code)
                            : "",
                        ),
                      )}
                      applied={siteFilter}
                      onApply={setSiteFilter}
                      sort={registerColumnSortConfig(
                        "site",
                        "text",
                        deviceSort,
                        setDeviceSort,
                      )}
                    />
                  </th>
                  <th className={scrollableTableHeadingClassName("Business Unit")}>
                    <RegisterColumnFilterHeader
                      label="Business unit"
                      options={collectDistinctColumnValues(
                        devices.map((device) =>
                          device.business_unit_id
                            ? (buNameById.get(device.business_unit_id) ?? "")
                            : "",
                        ),
                      )}
                      applied={buFilter}
                      onApply={setBuFilter}
                      sort={registerColumnSortConfig(
                        "business_unit",
                        "text",
                        deviceSort,
                        setDeviceSort,
                      )}
                    />
                  </th>
                  <th className={scrollableTableHeadingClassName("Status")}>
                    <RegisterColumnFilterHeader
                      label="Status"
                      options={collectDistinctColumnValues(
                        devices.map((device) => statusLabel(device.status)),
                      )}
                      applied={statusFilter}
                      onApply={setStatusFilter}
                      sort={registerColumnSortConfig(
                        "status",
                        "text",
                        deviceSort,
                        setDeviceSort,
                      )}
                    />
                  </th>
                  <th className={scrollableTableHeadingClassName("Status")}>
                    <RegisterColumnFilterHeader
                      label="Connection"
                      options={["Online", "Offline"]}
                      applied={connectionFilter}
                      onApply={setConnectionFilter}
                      sort={registerColumnSortConfig(
                        "connection",
                        "text",
                        deviceSort,
                        setDeviceSort,
                      )}
                    />
                  </th>
                  <th className={scrollableTableHeadingClassName("Date")}>
                    <RegisterColumnFilterHeader
                      label="Last seen"
                      options={[]}
                      applied={null}
                      onApply={() => {}}
                      sort={registerColumnSortConfig(
                        "last_seen",
                        "date",
                        deviceSort,
                        setDeviceSort,
                      )}
                    />
                  </th>
                  <th className={scrollableTableHeadingClassName("Firmware")}>
                    <RegisterColumnFilterHeader
                      label="Firmware"
                      options={collectDistinctColumnValues(
                        devices.map((device) => device.firmware_info),
                      )}
                      applied={firmwareFilter}
                      onApply={setFirmwareFilter}
                      sort={registerColumnSortConfig(
                        "firmware",
                        "text",
                        deviceSort,
                        setDeviceSort,
                      )}
                    />
                  </th>
                  <th className={scrollableTableThClassName}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredDevices.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="px-4 py-6 text-center text-sm text-slate-500">
                      No attendance devices
                    </td>
                  </tr>
                ) : null}
                {filteredDevices.map((device) => (
                  <tr key={device.id} className="border-b border-slate-100">
                    <td className="px-4 py-3">
                      {device.device_name?.trim() || "—"}
                    </td>
                    <td className="px-4 py-3 font-mono">
                      {device.serial_number?.trim() || "—"}
                    </td>
                    <td
                      className={`px-4 py-3 ${scrollableTableNoTruncateCellClassName}`}
                    >
                      {deviceBrandLabel(
                        normalizeDeviceBrand(device.brand, device.protocol),
                      )}
                    </td>
                    <td
                      className={`px-4 py-3 font-mono text-sm ${scrollableTableNoTruncateCellClassName}`}
                    >
                      {device.mac_address?.trim() || "—"}
                    </td>
                    <td className="px-4 py-3">
                      {deviceStaffGroupLabel(device, groupedProjects) || "—"}
                    </td>
                    <td className="px-4 py-3">
                      {device.site_code
                        ? (siteNameByCode.get(device.site_code) ??
                          device.site_code)
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {device.business_unit_id
                        ? (buNameById.get(device.business_unit_id) ?? "—")
                        : "—"}
                    </td>
                    <td className="px-4 py-3">{statusLabel(device.status)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          isDeviceOnline(device.last_seen_at, offlineAlertMinutes)
                            ? "bg-green-100 text-green-900"
                            : "bg-amber-100 text-amber-950"
                        }`}
                      >
                        {isDeviceOnline(device.last_seen_at, offlineAlertMinutes)
                          ? "Online"
                          : "Offline"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {device.last_seen_at
                        ? new Date(device.last_seen_at).toLocaleString()
                        : "—"}
                    </td>
                    <td className="px-4 py-3">{device.firmware_info || "—"}</td>
                    <td className={scrollableTableActionsTdClassName}>
                      <div className="flex flex-wrap gap-2">
                        {showScannerSimulator && !isHikvisionDevice(device) ? (
                          <button
                            type="button"
                            onClick={() => setSimulatorDevice(device)}
                            className="text-[#0f2744] underline"
                          >
                            Simulate…
                          </button>
                        ) : null}
                        {canWriteDevices && isHikvisionDevice(device) ? (
                          <button
                            type="button"
                            onClick={() => void regenerateHikvisionToken(device)}
                            className="text-[#0f2744] underline"
                          >
                            Regenerate link
                          </button>
                        ) : null}
                        {canWriteDevices ? (
                          <button
                            type="button"
                            onClick={() => openEditDevice(device)}
                            className="text-[#0f2744] underline"
                          >
                            Edit
                          </button>
                        ) : null}
                        {canWriteDevices && device.status !== "disabled" ? (
                          <button
                            type="button"
                            onClick={() => void disableDevice(device)}
                            className="text-red-700 underline"
                          >
                            Disable
                          </button>
                        ) : null}
                        {canDeleteDevices && !punchDeviceIds.has(device.id) ? (
                          <button
                            type="button"
                            onClick={() => void deleteDevice(device)}
                            className="text-red-700 underline"
                          >
                            Delete
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollableTable>
        </div>
      </CollapsibleDeviceSection>

      <CollapsibleDeviceSection
        storageKey="device-setup"
        title="Setup"
        summary="ADMS cloud server (ZKTeco / eSSL / Anviz)"
        defaultOpen={false}
      >
      <div className="grid gap-4 lg:grid-cols-2">
        {devices.filter((device) => !isHikvisionDevice(device)).length === 0 ? (
          <AdmsSetupCard brand="zkteco" serverHost={serverHost} />
        ) : (
          devices
            .filter((device) => !isHikvisionDevice(device))
            .map((device) => {
              const brand = normalizeDeviceBrand(device.brand, device.protocol);
              return (
                <AdmsSetupCard
                  key={device.id}
                  brand={isAdmsBrand(brand) ? brand : "zkteco"}
                  serialNumber={device.serial_number}
                  serverHost={serverHost}
                />
              );
            })
        )}
      </div>
      <p className="mt-4 text-sm text-slate-600">
        Hikvision terminals use HTTP Listening. After you add a Hikvision device, copy
        the one-time URL from the setup card (or use Regenerate link on the device row).
      </p>
      </CollapsibleDeviceSection>

      {hikvisionSetup ? (
        <HikvisionOneTimeSetupCard
          setup={hikvisionSetup}
          host={serverHost}
          onCopy={(label, value) => {
            void navigator.clipboard.writeText(value).then(
              () => toast(`${label} copied`),
              () =>
                void alertError("Could not copy to the clipboard.", {
                  title: "Copy failed",
                }),
            );
          }}
          onDismiss={() => setHikvisionSetup(null)}
        />
      ) : null}

      {formOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form
            ref={formRef}
            onSubmit={(event) => void saveDevice(event)}
            className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg"
          >
            <h3 className="text-lg font-semibold text-[#0f2744]">
              {editingId ? "Edit device" : "Add device"}
            </h3>
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Name
                </label>
                <input
                  className={inputClassName}
                  value={form.device_name}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      device_name: event.target.value,
                    }))
                  }
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Brand
                </label>
                <select
                  className={inputClassName}
                  value={form.brand}
                  required
                  disabled={Boolean(editingId)}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      brand: event.target.value,
                    }))
                  }
                >
                  <option value="zkteco">ZKTeco</option>
                  <option value="essl">eSSL</option>
                  <option value="anviz">Anviz</option>
                  <option value="hikvision">Hikvision</option>
                </select>
                {!editingId && form.serial_number.trim() ? (
                  <p className="mt-1 text-xs text-slate-500">
                    Claiming an unclaimed serial — pick the brand if it is not ZKTeco.
                  </p>
                ) : null}
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  {form.brand === "hikvision"
                    ? "Device serial (optional, for your reference)"
                    : "Serial number"}
                </label>
                <input
                  ref={serialInputRef}
                  className={inputClassName}
                  value={form.serial_number}
                  onChange={(event) => {
                    serialInputRef.current?.setCustomValidity("");
                    setForm((current) => ({
                      ...current,
                      serial_number: event.target.value,
                    }));
                  }}
                  required={form.brand !== "hikvision"}
                  disabled={Boolean(editingId) && form.brand !== "hikvision"}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Staff group
                </label>
                <select
                  className={inputClassName}
                  value={form.staff_group}
                  required
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      staff_group: event.target.value,
                      site_code:
                        event.target.value === COMPANY_WIDE_STAFF_GROUP
                          ? ""
                          : current.site_code,
                    }))
                  }
                >
                  <option value="">Select a staff group</option>
                  {form.staff_group &&
                  form.staff_group !== COMPANY_WIDE_STAFF_GROUP &&
                  !selectableStaffGroups.some(
                    (group) => group.key === form.staff_group,
                  ) ? (
                    <option value={form.staff_group}>
                      {staffGroups.find((group) => group.key === form.staff_group)
                        ?.label ?? form.staff_group}
                    </option>
                  ) : null}
                  {selectableStaffGroups.map((group) => (
                    <option key={group.key} value={group.key}>
                      {group.label}
                    </option>
                  ))}
                  <option value={COMPANY_WIDE_STAFF_GROUP}>
                    {COMPANY_WIDE_STAFF_LABEL}
                  </option>
                </select>
              </div>
              {form.staff_group &&
              form.staff_group !== COMPANY_WIDE_STAFF_GROUP ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Location (optional)
                  </label>
                  <select
                    className={inputClassName}
                    value={form.site_code}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        site_code: event.target.value,
                      }))
                    }
                  >
                    <option value="">No location</option>
                    {locationSites.map((site) => (
                      <option key={site.site_code} value={site.site_code}>
                        {site.site_name} ({site.site_code})
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Business unit
                </label>
                <select
                  className={inputClassName}
                  value={form.business_unit_id}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      business_unit_id: event.target.value,
                    }))
                  }
                >
                  <option value="">Select a business unit</option>
                  {businessUnits.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Status
                </label>
                <select
                  className={inputClassName}
                  value={form.status}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      status: event.target.value,
                    }))
                  }
                >
                  <option value="active">Active</option>
                  <option value="disabled">Disabled</option>
                </select>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <DashboardButton
                type="button"
                variant="secondary"
                onClick={() => setFormOpen(false)}
              >
                Cancel
              </DashboardButton>
              <DashboardButton type="submit">Save</DashboardButton>
            </div>
          </form>
        </div>
      ) : null}

      <CollapsibleDeviceSection
        storageKey="pin-mapping"
        title="Employee PIN mapping"
        summary={`${employees.filter((employee) => pinByStaffId.has(employee.staff_id)).length} of ${employees.length} assigned`}
        defaultOpen={false}
      >
        <p className="text-sm text-slate-600">
          PINs are the numeric part of the staff ID, without leading zeros. They must
          be unique in this workspace.
        </p>
        {canWriteDevices ? (
          <div className="mt-3">
            <DashboardButton type="button" onClick={() => void autoAssignPins()}>
              Auto-assign PINs from staff IDs
            </DashboardButton>
          </div>
        ) : null}
        <label className="mt-4 block max-w-md text-sm">
          <span className="mb-1 block font-medium text-slate-700">Staff group</span>
          <select
            className={inputClassName}
            value={pinStaffGroup}
            onChange={(event) => setPinStaffGroup(event.target.value)}
          >
            <option value="all">All</option>
            {selectableStaffGroups
              .filter((group) => !group.isOffice)
              .map((group) => (
                <option key={group.key} value={group.key}>
                  {group.label}
                </option>
              ))}
            <option value={DAVORS_OWN_STAFF_GROUP}>{DAVORS_OWN_STAFF_LABEL}</option>
          </select>
        </label>
        <div className="mt-4">
          <FilteredListCount
            filteredCount={filteredEmployees.length}
            totalCount={employees.length}
            itemSingular="employee"
            hasActiveFilters={pinFiltersActive}
          />
        </div>
        <div className="mt-4">
          <ScrollableTable>
            <table className={scrollableTableClassName}>
              <thead className={scrollableTableHeadClassName}>
                <tr>
                  <th className={scrollableTableHeadingClassName("Staff ID")}>
                    <RegisterColumnFilterHeader
                      label="Staff ID"
                      options={collectDistinctColumnValues(
                        employees.map((employee) => employee.staff_id),
                      )}
                      applied={staffFilter}
                      onApply={setStaffFilter}
                      sort={registerColumnSortConfig(
                        "staff_id",
                        "text",
                        pinSort,
                        setPinSort,
                      )}
                    />
                  </th>
                  <th className={scrollableTableHeadingClassName("Name")}>
                    <RegisterColumnFilterHeader
                      label="Name"
                      options={collectDistinctColumnValues(
                        employees.map((employee) => employee.full_name),
                      )}
                      applied={employeeNameFilter}
                      onApply={setEmployeeNameFilter}
                      sort={registerColumnSortConfig(
                        "name",
                        "text",
                        pinSort,
                        setPinSort,
                      )}
                    />
                  </th>
                  <th className={scrollableTableHeadingClassName("PIN")}>
                    <RegisterColumnFilterHeader
                      label="Device PIN"
                      options={collectDistinctColumnValues(
                        employees.map((employee) => {
                          const existing = pinByStaffId.get(employee.staff_id);
                          return existing
                            ? normalizeDevicePin(existing.device_pin)
                            : "Not assigned";
                        }),
                      )}
                      applied={pinFilter}
                      onApply={setPinFilter}
                      sort={registerColumnSortConfig(
                        "pin",
                        "text",
                        pinSort,
                        setPinSort,
                      )}
                    />
                  </th>
                  <th className={scrollableTableThClassName}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredEmployees.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-4 py-6 text-center text-sm text-slate-500"
                    >
                      No employees in this staff group.
                    </td>
                  </tr>
                ) : (
                  filteredEmployees.map((employee) => {
                    const existing = pinByStaffId.get(employee.staff_id);
                    const editing = editingPinStaffId === employee.staff_id;
                    const storedPin = existing
                      ? normalizeDevicePin(existing.device_pin)
                      : "";
                    return (
                      <tr key={employee.employee_id} className="border-b border-slate-100">
                        <td className="px-4 py-3">{employee.staff_id}</td>
                        <td className="px-4 py-3">{employee.full_name}</td>
                        <td className="px-4 py-3">
                          {editing ? (
                            <input
                              ref={(node) => {
                                pinInputRefs.current[employee.staff_id] = node;
                              }}
                              className={inputClassName}
                              value={pinDrafts[employee.staff_id] ?? ""}
                              onChange={(event) => {
                                pinInputRefs.current[employee.staff_id]?.setCustomValidity(
                                  "",
                                );
                                setPinDrafts((current) => ({
                                  ...current,
                                  [employee.staff_id]: event.target.value,
                                }));
                              }}
                            />
                          ) : storedPin ? (
                            storedPin
                          ) : (
                            <span className="text-slate-500">Not assigned</span>
                          )}
                        </td>
                        <td className={scrollableTableActionsTdClassName}>
                          {canWriteDevices ? (
                            <div className="flex gap-2">
                              {editing ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void savePin(employee.staff_id, existing?.id)
                                    }
                                    className="text-[#0f2744] underline"
                                  >
                                    Save
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditingPinStaffId(null)}
                                    className="text-slate-600 underline"
                                  >
                                    Cancel
                                  </button>
                                </>
                              ) : existing ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setPinDrafts((current) => ({
                                        ...current,
                                        [employee.staff_id]: storedPin,
                                      }));
                                      setEditingPinStaffId(employee.staff_id);
                                    }}
                                    className="text-[#0f2744] underline"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void removePin(existing.id)}
                                    className="text-red-700 underline"
                                  >
                                    Remove
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setPinDrafts((current) => ({
                                      ...current,
                                      [employee.staff_id]:
                                        pinFromStaffId(employee.staff_id) ?? "",
                                    }));
                                    setEditingPinStaffId(employee.staff_id);
                                  }}
                                  className="text-[#0f2744] underline"
                                >
                                  Assign
                                </button>
                              )}
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </ScrollableTable>
        </div>
      </CollapsibleDeviceSection>

      {canReprocessPunches ? (
        <div>
          <DashboardButton
            type="button"
            variant="secondary"
            onClick={() => void reprocessUnprocessedPunches()}
          >
            Reprocess unprocessed punches
          </DashboardButton>
        </div>
      ) : null}

      <AttendanceReviewPanel
        tenantId={tenantId}
        canWriteDevices={canWriteDevices}
        canSetClockOut={canSetClockOut}
        canReprocessPunches={canReprocessPunches}
        refreshToken={reviewRefreshToken}
        onSilentResult={(ok) => setReviewRefreshFailed(!ok)}
      />
      <OutageAttendancePanel canWrite={canWriteDevices} />
      <CollapsibleDeviceSection
        storageKey="device-settings"
        title="Device settings"
        summary="Scanner timing, labels, and offline alerts"
        defaultOpen={false}
      >
        <DeviceSettingsForm
          tenantId={tenantId}
          section="attendance"
          canSave={canWriteDevices}
          embedded
        />
      </CollapsibleDeviceSection>
      <CollapsibleDeviceSection
        storageKey="recent-punches"
        title="Recent punches"
        summary={
          recentPunches.length === 0
            ? "No punches yet"
            : `${recentPunches.length} most recent`
        }
        defaultOpen={false}
      >
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>When</th>
                <th className={scrollableTableThClassName}>Staff ID</th>
                <th className={scrollableTableThClassName}>PIN</th>
              </tr>
            </thead>
            <tbody>
              {recentPunches.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-sm text-slate-500">
                    No punches yet
                  </td>
                </tr>
              ) : (
                recentPunches.map((punch) => (
                  <tr key={punch.id} className="border-b border-slate-100">
                    <td className="px-4 py-3">
                      {new Date(punch.punch_time).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">{punch.staff_id ?? "—"}</td>
                    <td className="px-4 py-3">{punch.device_pin}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </ScrollableTable>
      </CollapsibleDeviceSection>
      {showScannerSimulator &&
      simulatorDevice &&
      simulatorDevice.serial_number ? (
        <ScannerSimulatorPanel
          deviceId={simulatorDevice.id}
          deviceLabel={simulatorDevice.device_name?.trim() || "Attendance device"}
          serialNumber={simulatorDevice.serial_number}
          onClose={() => setSimulatorDevice(null)}
        />
      ) : null}
    </div>
  );
}
