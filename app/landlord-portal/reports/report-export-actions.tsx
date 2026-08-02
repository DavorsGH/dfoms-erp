"use client";

import { downloadCsv } from "@/app/dashboard/reports/report-ui";
import {
  portalPrimaryButtonClassName,
  portalSecondaryButtonClassName,
} from "../portal-ui";

type ReportExportActionsProps = {
  occupancyRows: Array<Array<string | number>>;
  arrearsRows: Array<Array<string | number>>;
  ytdRows: Array<Array<string | number>>;
};

export default function LandlordPortalReportExportActions({
  occupancyRows,
  arrearsRows,
  ytdRows,
}: ReportExportActionsProps) {
  return (
    <div className="flex flex-wrap gap-2 print:hidden">
      <button
        type="button"
        className={portalPrimaryButtonClassName}
        onClick={() =>
          downloadCsv(
            "landlord-occupancy-report.csv",
            occupancyRows[0]?.map(String) ?? ["Metric", "Value"],
            occupancyRows.slice(1),
          )
        }
      >
        Export occupancy (CSV)
      </button>
      <button
        type="button"
        className={portalPrimaryButtonClassName}
        onClick={() =>
          downloadCsv(
            "landlord-arrears-report.csv",
            arrearsRows[0]?.map(String) ?? ["Bucket", "Outstanding GHS"],
            arrearsRows.slice(1),
          )
        }
      >
        Export arrears (CSV)
      </button>
      <button
        type="button"
        className={portalPrimaryButtonClassName}
        onClick={() =>
          downloadCsv(
            "landlord-ytd-report.csv",
            ytdRows[0]?.map(String) ?? ["Metric", "Value"],
            ytdRows.slice(1),
          )
        }
      >
        Export YTD (CSV)
      </button>
      <button
        type="button"
        className={portalSecondaryButtonClassName}
        onClick={() => window.print()}
      >
        Print / PDF
      </button>
    </div>
  );
}
