"use client";

import Link from "next/link";
import { useQueryTab } from "@/hooks/use-query-tab";
import {
  ModuleNavTabStrip,
  moduleNavActiveTabProps,
} from "@/app/dashboard/module-nav-tab-strip";
import ScannerSetupPanel from "./scanner-setup-panel";
import AttendanceDevicesTab from "./attendance-devices-tab";
import PrintersTab from "./printers-tab";
import DeviceSettingsForm from "./device-settings-form";
import OfflineDeviceAlertProbe from "./offline-device-alert-probe";
import type { FinishedProductRecord } from "../inventory/finished-products-utils";

type DevicesTabId = "scanners" | "attendance" | "printers";

type DevicesHubClientProps = {
  tenantId: string | null;
  initialScannerProducts: FinishedProductRecord[];
  scannerFetchError: string | null;
  hasPosFeature: boolean;
  canWriteDevices: boolean;
  canDeleteDevices: boolean;
  canSetClockOut: boolean;
  canReprocessPunches: boolean;
  showScannerSimulator?: boolean;
};

const TABS: { id: DevicesTabId; label: string; requiresPos: boolean }[] = [
  { id: "scanners", label: "Barcode Scanners", requiresPos: true },
  { id: "attendance", label: "Attendance Devices", requiresPos: false },
  { id: "printers", label: "Printers", requiresPos: true },
];

const tabClassName = (active: boolean, disabled: boolean) =>
  `shrink-0 whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium transition-colors ${
    disabled
      ? "cursor-not-allowed bg-slate-100 text-slate-400"
      : active
        ? "bg-[#0f2744] text-white"
        : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
  }`;

export default function DevicesHubClient({
  tenantId,
  initialScannerProducts,
  scannerFetchError,
  hasPosFeature,
  canWriteDevices,
  canDeleteDevices,
  canSetClockOut,
  canReprocessPunches,
  showScannerSimulator = false,
}: DevicesHubClientProps) {
  function isTabDisabled(tab: (typeof TABS)[number]): boolean {
    return tab.requiresPos && !hasPosFeature;
  }

  const { tab: activeTab, setTab: setActiveTab } = useQueryTab<DevicesTabId>({
    values: ["scanners", "attendance", "printers"],
    defaultTab: hasPosFeature ? "scanners" : "attendance",
    isAllowed: (tab) => {
      const match = TABS.find((item) => item.id === tab);
      return match ? !isTabDisabled(match) : false;
    },
    fromUrl: (value) => {
      if (value === "barcode" || value === "scanners") {
        return "scanners";
      }
      if (value === "attendance" || value === "printers") {
        return value;
      }
      return null;
    },
    toUrl: (tab) => (tab === "scanners" ? "barcode" : tab),
  });

  return (
    <div>
      <OfflineDeviceAlertProbe />
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">
        Scanners & Devices
      </h1>

      <div className="mb-6 border-b border-slate-200 pb-4">
        <ModuleNavTabStrip scrollKey={activeTab}>
          {TABS.map((tab) => {
            const disabled = isTabDisabled(tab);
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                disabled={disabled}
                onClick={() => setActiveTab(tab.id)}
                {...moduleNavActiveTabProps(active && !disabled)}
                className={tabClassName(active, disabled)}
              >
                {tab.label}
              </button>
            );
          })}
        </ModuleNavTabStrip>
      </div>

      {TABS.map((tab) => {
        if (activeTab !== tab.id) {
          return null;
        }
        if (isTabDisabled(tab)) {
          return (
            <p
              key={tab.id}
              className="rounded-md border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-700"
            >
              {tab.label} requires the Business plan or higher.{" "}
              <Link
                href="/dashboard/upgrade-required?feature=pos"
                className="font-medium text-[#0f2744] underline"
              >
                View upgrade options
              </Link>
            </p>
          );
        }
        if (tab.id === "scanners") {
          return (
            <div key={tab.id}>
              <div className="mb-6">
                <DeviceSettingsForm
                  tenantId={tenantId}
                  section="scanner"
                  canSave={canWriteDevices}
                />
              </div>
              <p className="mb-4 text-sm text-slate-600">
                Test keyboard-wedge scanners before using them at POS checkout or in
                Inventory.
              </p>
              <ScannerSetupPanel
                initialProducts={initialScannerProducts}
                fetchError={scannerFetchError}
              />
            </div>
          );
        }
        if (tab.id === "attendance") {
          return (
            <AttendanceDevicesTab
              key={tab.id}
              tenantId={tenantId}
              canWriteDevices={canWriteDevices}
              canDeleteDevices={canDeleteDevices}
              canSetClockOut={canSetClockOut}
              canReprocessPunches={canReprocessPunches}
              showScannerSimulator={showScannerSimulator}
            />
          );
        }
        return (
          <PrintersTab
            key={tab.id}
            tenantId={tenantId}
            canWriteDevices={canWriteDevices}
          />
        );
      })}
    </div>
  );
}
