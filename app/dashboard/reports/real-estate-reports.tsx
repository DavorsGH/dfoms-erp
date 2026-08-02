"use client";

import { useMemo, useState } from "react";
import { getStripedRowClassName } from "../finance/register-row-actions";
import { inputClassName } from "../employees/employee-record-utils";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import {
  formatReportPeriodLabel,
  getDefaultReportMonthYear,
} from "./finance-reports-utils";
import {
  FINANCE_REPORT_PRINT_AREA_ID,
  ReportActionBar,
  ReportCompanyHeader,
  ReportMonthYearSelector,
  ReportPrintStyles,
  downloadCsv,
  formatReportCurrency,
  formatReportDate,
} from "./report-ui";
import {
  RE_ARREARS_BUCKET_LABELS,
  buildArrearsAgingReport,
  buildIncomeByPropertyReport,
  buildOccupancyReport,
  buildVacancyRateReport,
  filterLedgerByLandlordProperty,
  filterUnitsByLandlordProperty,
  propertiesForLandlord,
  type ReArrearsBucketKey,
  type ReReportLandlordOption,
  type ReReportLedgerRow,
  type ReReportPropertyOption,
  type ReReportUnitRow,
} from "./real-estate-reports-utils";

/** Staff: Landlord + Property. Portal: Property only (scoped to own tenant). */
export type ReReportFilterMode = "staff" | "portal";

function ReportFetchError({ fetchError }: { fetchError: string | null }) {
  if (!fetchError) return null;
  return (
    <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {fetchError}
    </p>
  );
}

function handleReportPrint() {
  window.print();
}

function ReportPanel({
  title,
  periodLabel,
  children,
}: {
  title: string;
  periodLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div
      id={FINANCE_REPORT_PRINT_AREA_ID}
      className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
    >
      <ReportCompanyHeader title={title} periodLabel={periodLabel} />
      {children}
    </div>
  );
}

function MetricCards({
  items,
}: {
  items: Array<{ label: string; value: string }>;
}) {
  return (
    <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {item.label}
          </p>
          <p className="mt-1 text-lg font-semibold text-[#0f2744]">
            {item.value}
          </p>
        </div>
      ))}
    </div>
  );
}

function useLandlordPropertyFilters(
  landlords: ReReportLandlordOption[],
  properties: ReReportPropertyOption[],
  filterMode: ReReportFilterMode,
) {
  const [landlordId, setLandlordId] = useState("");
  const [propertyId, setPropertyId] = useState("");

  const effectiveLandlordId =
    filterMode === "portal" ? (landlords[0]?.tenantId ?? "") : landlordId;

  const propertyOptions = useMemo(
    () => propertiesForLandlord(properties, effectiveLandlordId),
    [effectiveLandlordId, properties],
  );

  function onLandlordChange(nextLandlordId: string) {
    setLandlordId(nextLandlordId);
    if (
      propertyId &&
      !propertiesForLandlord(properties, nextLandlordId).some(
        (property) => property.propertyId === propertyId,
      )
    ) {
      setPropertyId("");
    }
  }

  const filterControls = (
    <>
      {filterMode === "staff" ? (
        <div className="min-w-[200px]">
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Landlord
          </label>
          <select
            value={landlordId}
            onChange={(event) => onLandlordChange(event.target.value)}
            className={inputClassName}
          >
            <option value="">All landlords</option>
            {landlords.map((landlord) => (
              <option key={landlord.tenantId} value={landlord.tenantId}>
                {landlord.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="min-w-[200px]">
        <label className="mb-1 block text-sm font-medium text-slate-700">
          Property
        </label>
        <select
          value={propertyId}
          onChange={(event) => setPropertyId(event.target.value)}
          className={inputClassName}
        >
          <option value="">All properties</option>
          {propertyOptions.map((property) => (
            <option key={property.propertyId} value={property.propertyId}>
              {property.name}
            </option>
          ))}
        </select>
      </div>
    </>
  );

  const periodLabelParts =
    filterMode === "portal"
      ? [
          propertyId
            ? (properties.find((row) => row.propertyId === propertyId)?.name ??
              "Selected property")
            : "All properties",
        ]
      : [
          landlordId
            ? (landlords.find((row) => row.tenantId === landlordId)?.name ??
              "Selected landlord")
            : "All landlords",
          propertyId
            ? (properties.find((row) => row.propertyId === propertyId)?.name ??
              "Selected property")
            : "All properties",
        ];

  return {
    landlordId: filterMode === "portal" ? "" : landlordId,
    propertyId,
    filterControls,
    filterPeriodLabel: periodLabelParts.join(" · "),
    showLandlordColumn: filterMode === "staff",
  };
}

type VacancyOccupancyReportProps = {
  landlords: ReReportLandlordOption[];
  properties: ReReportPropertyOption[];
  units: ReReportUnitRow[];
  fetchError: string | null;
  filterMode?: ReReportFilterMode;
};

export function VacancyRateReport({
  landlords,
  properties,
  units,
  fetchError,
  filterMode = "staff",
}: VacancyOccupancyReportProps) {
  const {
    landlordId,
    propertyId,
    filterControls,
    filterPeriodLabel,
    showLandlordColumn,
  } = useLandlordPropertyFilters(landlords, properties, filterMode);

  const report = useMemo(() => {
    const filtered = filterUnitsByLandlordProperty(
      units,
      landlordId,
      propertyId,
    );
    return buildVacancyRateReport(filtered);
  }, [landlordId, propertyId, units]);

  function exportCsv() {
    downloadCsv(
      "vacancy-rate-report.csv",
      showLandlordColumn
        ? ["Landlord", "Property", "Unit", "Status"]
        : ["Property", "Unit", "Status"],
      report.detailRows.map((row) =>
        showLandlordColumn
          ? [row.landlordName, row.propertyName, row.unitNumber, row.statusLabel]
          : [row.propertyName, row.unitNumber, row.statusLabel],
      ),
    );
  }

  const colSpan = showLandlordColumn ? 4 : 3;

  return (
    <div className="space-y-6">
      <ReportPrintStyles />
      <ReportActionBar
        onPrint={handleReportPrint}
        onExportCsv={exportCsv}
        exportDisabled={report.detailRows.length === 0}
      >
        {filterControls}
      </ReportActionBar>
      <ReportFetchError fetchError={fetchError} />
      <ReportPanel title="Vacancy Rate" periodLabel={filterPeriodLabel}>
        <MetricCards
          items={[
            { label: "Vacancy rate", value: `${report.vacancyRatePct}%` },
            { label: "Occupied", value: String(report.occupied) },
            { label: "Vacant", value: String(report.vacant) },
            {
              label: "Under maintenance",
              value: String(report.underMaintenance),
            },
          ]}
        />
        <p className="mb-4 text-sm text-slate-600">
          Vacancy rate = vacant ÷ total units. Under maintenance is counted
          separately and is not treated as vacant.
        </p>
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                {showLandlordColumn ? (
                  <th className={scrollableTableThClassName}>Landlord</th>
                ) : null}
                <th className={scrollableTableThClassName}>Property</th>
                <th className={scrollableTableThClassName}>Unit</th>
                <th className={scrollableTableThClassName}>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {report.detailRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={colSpan}
                    className="px-4 py-8 text-center text-slate-500"
                  >
                    No units match the selected filters.
                  </td>
                </tr>
              ) : (
                report.detailRows.map((row, index) => (
                  <tr
                    key={row.unitId}
                    className={getStripedRowClassName(index)}
                  >
                    {showLandlordColumn ? (
                      <td className="px-4 py-3">{row.landlordName}</td>
                    ) : null}
                    <td className="px-4 py-3">{row.propertyName}</td>
                    <td className="px-4 py-3">{row.unitNumber}</td>
                    <td className="px-4 py-3">{row.statusLabel}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </ScrollableTable>
      </ReportPanel>
    </div>
  );
}

export function OccupancyReport({
  landlords,
  properties,
  units,
  fetchError,
  filterMode = "staff",
}: VacancyOccupancyReportProps) {
  const {
    landlordId,
    propertyId,
    filterControls,
    filterPeriodLabel,
    showLandlordColumn,
  } = useLandlordPropertyFilters(landlords, properties, filterMode);

  const report = useMemo(() => {
    const filtered = filterUnitsByLandlordProperty(
      units,
      landlordId,
      propertyId,
    );
    return buildOccupancyReport(filtered);
  }, [landlordId, propertyId, units]);

  function exportCsv() {
    downloadCsv(
      "occupancy-report.csv",
      showLandlordColumn
        ? [
            "Landlord",
            "Property",
            "Occupancy %",
            "Occupied",
            "Vacant",
            "Under Maintenance",
            "Total Units",
          ]
        : [
            "Property",
            "Occupancy %",
            "Occupied",
            "Vacant",
            "Under Maintenance",
            "Total Units",
          ],
      report.rows.map((row) =>
        showLandlordColumn
          ? [
              row.landlordName,
              row.propertyName,
              row.occupancyRatePct,
              row.occupied,
              row.vacant,
              row.underMaintenance,
              row.total,
            ]
          : [
              row.propertyName,
              row.occupancyRatePct,
              row.occupied,
              row.vacant,
              row.underMaintenance,
              row.total,
            ],
      ),
    );
  }

  const colSpan = showLandlordColumn ? 7 : 6;

  return (
    <div className="space-y-6">
      <ReportPrintStyles />
      <ReportActionBar
        onPrint={handleReportPrint}
        onExportCsv={exportCsv}
        exportDisabled={report.rows.length === 0}
      >
        {filterControls}
      </ReportActionBar>
      <ReportFetchError fetchError={fetchError} />
      <ReportPanel title="Occupancy" periodLabel={filterPeriodLabel}>
        <MetricCards
          items={[
            {
              label: "Occupancy rate",
              value: `${report.totals.occupancyRatePct}%`,
            },
            { label: "Occupied", value: String(report.totals.occupied) },
            { label: "Vacant", value: String(report.totals.vacant) },
            {
              label: "Under maintenance",
              value: String(report.totals.underMaintenance),
            },
          ]}
        />
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                {showLandlordColumn ? (
                  <th className={scrollableTableThClassName}>Landlord</th>
                ) : null}
                <th className={scrollableTableThClassName}>Property</th>
                <th className={`${scrollableTableThClassName} text-right`}>
                  Occupancy %
                </th>
                <th className={`${scrollableTableThClassName} text-right`}>
                  Occupied
                </th>
                <th className={`${scrollableTableThClassName} text-right`}>
                  Vacant
                </th>
                <th className={`${scrollableTableThClassName} text-right`}>
                  Under Maintenance
                </th>
                <th className={`${scrollableTableThClassName} text-right`}>
                  Total
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {report.rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={colSpan}
                    className="px-4 py-8 text-center text-slate-500"
                  >
                    No properties match the selected filters.
                  </td>
                </tr>
              ) : (
                report.rows.map((row, index) => (
                  <tr
                    key={row.propertyId}
                    className={getStripedRowClassName(index)}
                  >
                    {showLandlordColumn ? (
                      <td className="px-4 py-3">{row.landlordName}</td>
                    ) : null}
                    <td className="px-4 py-3">{row.propertyName}</td>
                    <td className="px-4 py-3 text-right">
                      {row.occupancyRatePct}%
                    </td>
                    <td className="px-4 py-3 text-right">{row.occupied}</td>
                    <td className="px-4 py-3 text-right">{row.vacant}</td>
                    <td className="px-4 py-3 text-right">
                      {row.underMaintenance}
                    </td>
                    <td className="px-4 py-3 text-right">{row.total}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </ScrollableTable>
      </ReportPanel>
    </div>
  );
}

type ArrearsAgingReportProps = {
  landlords: ReReportLandlordOption[];
  properties: ReReportPropertyOption[];
  ledgerRows: ReReportLedgerRow[];
  fetchError: string | null;
  filterMode?: ReReportFilterMode;
};

export function ArrearsAgingReport({
  landlords,
  properties,
  ledgerRows,
  fetchError,
  filterMode = "staff",
}: ArrearsAgingReportProps) {
  const {
    landlordId,
    propertyId,
    filterControls,
    filterPeriodLabel,
    showLandlordColumn,
  } = useLandlordPropertyFilters(landlords, properties, filterMode);

  const report = useMemo(() => {
    const filtered = filterLedgerByLandlordProperty(
      ledgerRows,
      landlordId,
      propertyId,
    );
    return buildArrearsAgingReport(filtered);
  }, [landlordId, ledgerRows, propertyId]);

  const bucketOrder: ReArrearsBucketKey[] = [
    "current",
    "1-30",
    "31-60",
    "61+",
  ];

  function exportCsv() {
    downloadCsv(
      "arrears-aging-report.csv",
      showLandlordColumn
        ? [
            "Landlord",
            "Property",
            "Unit",
            "Lessee",
            "Lease ID",
            "Period Start",
            "Period End",
            "Amount Due",
            "Amount Paid",
            "Credit",
            "Outstanding",
            "Age Days",
            "Aging Bucket",
          ]
        : [
            "Property",
            "Unit",
            "Lessee",
            "Lease ID",
            "Period Start",
            "Period End",
            "Amount Due",
            "Amount Paid",
            "Credit",
            "Outstanding",
            "Age Days",
            "Aging Bucket",
          ],
      report.detailRows.map((row) =>
        showLandlordColumn
          ? [
              row.landlordName,
              row.propertyName,
              row.unitNumber,
              row.lesseeName,
              row.leaseId,
              row.periodStart,
              row.periodEnd,
              row.amountDueGhs,
              row.amountPaidGhs,
              row.creditGhs,
              row.outstandingGhs,
              row.ageDays,
              row.bucketLabel,
            ]
          : [
              row.propertyName,
              row.unitNumber,
              row.lesseeName,
              row.leaseId,
              row.periodStart,
              row.periodEnd,
              row.amountDueGhs,
              row.amountPaidGhs,
              row.creditGhs,
              row.outstandingGhs,
              row.ageDays,
              row.bucketLabel,
            ],
      ),
    );
  }

  const colSpan = showLandlordColumn ? 8 : 7;

  return (
    <div className="space-y-6">
      <ReportPrintStyles />
      <ReportActionBar
        onPrint={handleReportPrint}
        onExportCsv={exportCsv}
        exportDisabled={report.detailRows.length === 0}
      >
        {filterControls}
      </ReportActionBar>
      <ReportFetchError fetchError={fetchError} />
      <ReportPanel title="Arrears Aging" periodLabel={filterPeriodLabel}>
        <MetricCards
          items={[
            ...bucketOrder.map((bucket) => ({
              label: RE_ARREARS_BUCKET_LABELS[bucket],
              value: formatReportCurrency(report.buckets[bucket]),
            })),
            {
              label: "Total outstanding",
              value: formatReportCurrency(report.totalOutstandingGhs),
            },
          ]}
        />
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                {showLandlordColumn ? (
                  <th className={scrollableTableThClassName}>Landlord</th>
                ) : null}
                <th className={scrollableTableThClassName}>Property</th>
                <th className={scrollableTableThClassName}>Unit</th>
                <th className={scrollableTableThClassName}>Lessee</th>
                <th className={scrollableTableThClassName}>Period</th>
                <th className={`${scrollableTableThClassName} text-right`}>
                  Outstanding
                </th>
                <th className={`${scrollableTableThClassName} text-right`}>
                  Age (days)
                </th>
                <th className={scrollableTableThClassName}>Bucket</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {report.detailRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={colSpan}
                    className="px-4 py-8 text-center text-slate-500"
                  >
                    No outstanding rent matches the selected filters.
                  </td>
                </tr>
              ) : (
                report.detailRows.map((row, index) => (
                  <tr
                    key={row.entryId}
                    className={getStripedRowClassName(index)}
                  >
                    {showLandlordColumn ? (
                      <td className="px-4 py-3">{row.landlordName}</td>
                    ) : null}
                    <td className="px-4 py-3">{row.propertyName}</td>
                    <td className="px-4 py-3">{row.unitNumber}</td>
                    <td className="px-4 py-3">{row.lesseeName}</td>
                    <td className="px-4 py-3">
                      {formatReportDate(row.periodStart)} –{" "}
                      {formatReportDate(row.periodEnd)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {formatReportCurrency(row.outstandingGhs)}
                    </td>
                    <td className="px-4 py-3 text-right">{row.ageDays}</td>
                    <td className="px-4 py-3">{row.bucketLabel}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </ScrollableTable>
      </ReportPanel>
    </div>
  );
}

type IncomeByPropertyReportProps = {
  landlords: ReReportLandlordOption[];
  properties: ReReportPropertyOption[];
  ledgerRows: ReReportLedgerRow[];
  availableYears: number[];
  fetchError: string | null;
  filterMode?: ReReportFilterMode;
};

export function IncomeByPropertyReport({
  landlords,
  properties,
  ledgerRows,
  availableYears,
  fetchError,
  filterMode = "staff",
}: IncomeByPropertyReportProps) {
  const defaults = getDefaultReportMonthYear();
  const [year, setYear] = useState(
    availableYears.includes(defaults.year)
      ? defaults.year
      : (availableYears[0] ?? defaults.year),
  );
  const [month, setMonth] = useState(defaults.month);
  const { landlordId, propertyId, filterControls, showLandlordColumn } =
    useLandlordPropertyFilters(landlords, properties, filterMode);

  const report = useMemo(() => {
    const filtered = filterLedgerByLandlordProperty(
      ledgerRows,
      landlordId,
      propertyId,
    );
    return buildIncomeByPropertyReport(filtered, year, month);
  }, [landlordId, ledgerRows, month, propertyId, year]);

  const periodLabel =
    filterMode === "portal"
      ? formatReportPeriodLabel(year, month)
      : `${formatReportPeriodLabel(year, month)} · ${
          landlordId
            ? (landlords.find((row) => row.tenantId === landlordId)?.name ??
              "Selected landlord")
            : "All landlords"
        }`;

  function exportCsv() {
    downloadCsv(
      `income-by-property-${year}-${String(month).padStart(2, "0")}.csv`,
      showLandlordColumn
        ? [
            "Landlord",
            "Property",
            "Due",
            "Collected",
            "Outstanding",
            "Collection %",
          ]
        : ["Property", "Due", "Collected", "Outstanding", "Collection %"],
      report.rows.map((row) =>
        showLandlordColumn
          ? [
              row.landlordName,
              row.propertyName,
              row.dueGhs,
              row.collectedGhs,
              row.outstandingGhs,
              row.collectionPct,
            ]
          : [
              row.propertyName,
              row.dueGhs,
              row.collectedGhs,
              row.outstandingGhs,
              row.collectionPct,
            ],
      ),
    );
  }

  const colSpan = showLandlordColumn ? 6 : 5;

  return (
    <div className="space-y-6">
      <ReportPrintStyles />
      <ReportActionBar
        onPrint={handleReportPrint}
        onExportCsv={exportCsv}
        exportDisabled={report.rows.length === 0}
      >
        {filterControls}
        <ReportMonthYearSelector
          year={year}
          month={month}
          availableYears={availableYears}
          onYearChange={setYear}
          onMonthChange={setMonth}
        />
      </ReportActionBar>
      <ReportFetchError fetchError={fetchError} />
      <ReportPanel title="Income by Property" periodLabel={periodLabel}>
        <MetricCards
          items={[
            {
              label: "Due",
              value: formatReportCurrency(report.totals.dueGhs),
            },
            {
              label: "Collected",
              value: formatReportCurrency(report.totals.collectedGhs),
            },
            {
              label: "Outstanding",
              value: formatReportCurrency(report.totals.outstandingGhs),
            },
            {
              label: "Collection %",
              value: `${report.totals.collectionPct}%`,
            },
          ]}
        />
        <p className="mb-4 text-sm text-slate-600">
          Due uses rent ledger periods starting in the selected month.
          Collected uses payments with a payment date in that month.
          Outstanding uses due − paid − credit on due rows.
        </p>
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                {showLandlordColumn ? (
                  <th className={scrollableTableThClassName}>Landlord</th>
                ) : null}
                <th className={scrollableTableThClassName}>Property</th>
                <th className={`${scrollableTableThClassName} text-right`}>
                  Due
                </th>
                <th className={`${scrollableTableThClassName} text-right`}>
                  Collected
                </th>
                <th className={`${scrollableTableThClassName} text-right`}>
                  Outstanding
                </th>
                <th className={`${scrollableTableThClassName} text-right`}>
                  Collection %
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {report.rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={colSpan}
                    className="px-4 py-8 text-center text-slate-500"
                  >
                    No rent activity for this period and filters.
                  </td>
                </tr>
              ) : (
                report.rows.map((row, index) => (
                  <tr
                    key={row.propertyId}
                    className={getStripedRowClassName(index)}
                  >
                    {showLandlordColumn ? (
                      <td className="px-4 py-3">{row.landlordName}</td>
                    ) : null}
                    <td className="px-4 py-3">{row.propertyName}</td>
                    <td className="px-4 py-3 text-right">
                      {formatReportCurrency(row.dueGhs)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {formatReportCurrency(row.collectedGhs)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {formatReportCurrency(row.outstandingGhs)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {row.collectionPct}%
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </ScrollableTable>
      </ReportPanel>
    </div>
  );
}
