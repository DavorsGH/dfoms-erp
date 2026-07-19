"use client";

import { formatGHS } from "../finance/income-register-utils";
import { inputClassName } from "../employees/employee-record-utils";
import {
  REPORT_MONTH_OPTIONS,
} from "./finance-reports-utils";
import { useTenantBranding } from "../tenant-branding-context";
import { DEFAULT_COMPANY_LEGAL_NAME } from "@/utils/tenant-branding-types";

export const REPORT_COMPANY_NAME = DEFAULT_COMPANY_LEGAL_NAME;

export const FINANCE_REPORT_PRINT_AREA_ID = "finance-report-print-area";

export function escapeCsvValue(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

export function downloadCsv(
  fileName: string,
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
): void {
  const csv = [
    headers.map(escapeCsvValue).join(","),
    ...rows.map((row) => row.map(escapeCsvValue).join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export function formatReportDate(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }

  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatDaysUntilDue(daysUntilDue: number | null): string {
  if (daysUntilDue === null) {
    return "—";
  }

  if (daysUntilDue > 0) {
    return `${daysUntilDue} day${daysUntilDue === 1 ? "" : "s"} until due`;
  }

  if (daysUntilDue === 0) {
    return "Due today";
  }

  const overdueDays = Math.abs(daysUntilDue);
  return `${overdueDays} day${overdueDays === 1 ? "" : "s"} overdue`;
}

export function ReportPrintStyles() {
  return (
    <style>{`
      @media print {
        body * {
          visibility: hidden;
        }

        #${FINANCE_REPORT_PRINT_AREA_ID},
        #${FINANCE_REPORT_PRINT_AREA_ID} * {
          visibility: visible;
        }

        #${FINANCE_REPORT_PRINT_AREA_ID} {
          position: absolute;
          inset: 0;
          width: 100%;
          padding: 24px;
          background: white;
        }

        .no-print {
          display: none !important;
        }
      }
    `}</style>
  );
}

export function ReportCompanyHeader({
  title,
  periodLabel,
}: {
  title: string;
  periodLabel: string;
}) {
  const { companyLegalName, workspaceLogoUrl } = useTenantBranding();

  return (
    <header className="mb-6 border-b-4 border-[#0f2744] pb-4">
      <div className="flex items-start gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={workspaceLogoUrl}
          alt={`${companyLegalName} logo`}
          className="h-16 w-16 rounded-md object-cover"
        />
        <div>
          <h3 className="text-lg font-bold text-[#0f2744]">
            {companyLegalName}
          </h3>
          <p className="mt-1 text-base font-semibold text-slate-800">{title}</p>
          <p className="mt-1 text-sm text-slate-600">Period: {periodLabel}</p>
        </div>
      </div>
    </header>
  );
}

export function ReportMonthYearSelector({
  year,
  month,
  availableYears,
  onYearChange,
  onMonthChange,
}: {
  year: number;
  month: number;
  availableYears: number[];
  onYearChange: (year: number) => void;
  onMonthChange: (month: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="min-w-[140px]">
        <label className="mb-1 block text-sm font-medium text-slate-700">
          Year
        </label>
        <select
          value={year}
          onChange={(event) => onYearChange(Number(event.target.value))}
          className={inputClassName}
        >
          {availableYears.map((optionYear) => (
            <option key={optionYear} value={optionYear}>
              {optionYear}
            </option>
          ))}
        </select>
      </div>
      <div className="min-w-[160px]">
        <label className="mb-1 block text-sm font-medium text-slate-700">
          Month
        </label>
        <select
          value={month}
          onChange={(event) => onMonthChange(Number(event.target.value))}
          className={inputClassName}
        >
          {REPORT_MONTH_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function ReportActionBar({
  onPrint,
  onExportCsv,
  exportDisabled = false,
  children,
}: {
  onPrint: () => void;
  onExportCsv: () => void;
  exportDisabled?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="no-print flex flex-wrap items-end justify-between gap-4">
      {children}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onExportCsv}
          disabled={exportDisabled}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Export to CSV
        </button>
        <button
          type="button"
          onClick={onPrint}
          className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
        >
          Print
        </button>
      </div>
    </div>
  );
}

export function formatReportCurrency(value: number): string {
  return formatGHS(value);
}
