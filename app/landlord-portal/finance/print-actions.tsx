"use client";

import { downloadCsv } from "@/app/dashboard/reports/report-ui";
import {
  portalPrimaryButtonClassName,
  portalSecondaryButtonClassName,
} from "../portal-ui";

export function PrintPageButton({ label = "Print / PDF" }: { label?: string }) {
  return (
    <button
      type="button"
      className={portalSecondaryButtonClassName}
      onClick={() => window.print()}
    >
      {label}
    </button>
  );
}

export function ExportCsvButton({
  fileName,
  headers,
  rows,
  label = "Export Excel (CSV)",
}: {
  fileName: string;
  headers: string[];
  rows: Array<Array<string | number | null | undefined>>;
  label?: string;
}) {
  return (
    <button
      type="button"
      className={portalPrimaryButtonClassName}
      onClick={() => downloadCsv(fileName, headers, rows)}
    >
      {label}
    </button>
  );
}
