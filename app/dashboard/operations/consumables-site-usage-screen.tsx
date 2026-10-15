"use client";



import { useMemo, useState } from "react";

import { formatGHS } from "../finance/income-register-utils";

import { downloadCsv } from "../reports/report-ui";

import {

  buildSiteUsageRows,

  type ConsumableItemRecord,

  type ConsumableMovementRecord,

  type SiteUsageRow,

} from "./consumables-store-utils";

import type { ConsumableSiteOption } from "./consumables-store-data";

import ScrollableTable, {

  scrollableTableClassName,

  scrollableTableHeadClassName,

  scrollableTableThClassName,

} from "../scrollable-table";

import {

  consumablesInputClassName,

  consumablesPrimaryButtonClassName,

} from "./consumables-store-client";



type Props = {

  initialMovements: ConsumableMovementRecord[];

  initialItems: ConsumableItemRecord[];

  sites: ConsumableSiteOption[];

};



type DisplayRow =

  | { kind: "detail"; row: SiteUsageRow }

  | { kind: "projectSubtotal"; siteName: string; projectLabel: string; value: number }

  | { kind: "siteSubtotal"; siteName: string; value: number };



function monthBounds(yearMonth: string): { from: string; to: string } {

  const [y, m] = yearMonth.split("-").map(Number);

  const from = `${yearMonth}-01`;

  const lastDay = new Date(y!, m!, 0).getDate();

  const to = `${yearMonth}-${String(lastDay).padStart(2, "0")}`;

  return { from, to };

}



function buildDisplayRows(detailRows: SiteUsageRow[]): DisplayRow[] {
  const sorted = [...detailRows].sort((a, b) => {
    const siteCmp = a.siteName.localeCompare(b.siteName);
    if (siteCmp !== 0) return siteCmp;
    const projCmp = a.projectLabel.localeCompare(b.projectLabel);
    if (projCmp !== 0) return projCmp;
    return a.itemName.localeCompare(b.itemName);
  });

  const projectsBySite = new Map<string, Set<string>>();
  for (const row of detailRows) {
    const set = projectsBySite.get(row.siteName) ?? new Set<string>();
    set.add(row.projectLabel);
    projectsBySite.set(row.siteName, set);
  }

  const output: DisplayRow[] = [];
  let currentSite = "";
  let currentProject = "";
  let projectValue = 0;
  let siteValue = 0;

  function flushProject() {
    if (!currentSite || !currentProject) return;
    const projectCount = projectsBySite.get(currentSite)?.size ?? 0;
    if (projectCount > 1) {
      output.push({
        kind: "projectSubtotal",
        siteName: currentSite,
        projectLabel: currentProject,
        value: Math.round(projectValue * 100) / 100,
      });
    }
    projectValue = 0;
    currentProject = "";
  }

  function flushSite() {
    if (!currentSite) return;
    flushProject();
    const projectCount = projectsBySite.get(currentSite)?.size ?? 0;
    const value = Math.round(siteValue * 100) / 100;
    if (projectCount === 1) {
      const onlyProject = [...(projectsBySite.get(currentSite) ?? [])][0] ?? "";
      output.push({
        kind: "projectSubtotal",
        siteName: currentSite,
        projectLabel: onlyProject,
        value,
      });
    } else {
      output.push({
        kind: "siteSubtotal",
        siteName: currentSite,
        value,
      });
    }
    siteValue = 0;
    currentSite = "";
  }

  for (const row of sorted) {
    if (row.siteName !== currentSite) {
      flushSite();
      currentSite = row.siteName;
    }
    if (row.projectLabel !== currentProject) {
      flushProject();
      currentProject = row.projectLabel;
    }
    output.push({ kind: "detail", row });
    projectValue += row.netValue;
    siteValue += row.netValue;
  }
  flushSite();

  return output;
}



export default function ConsumablesSiteUsageScreen({

  initialMovements,

  initialItems,

  sites,

}: Props) {

  const now = new Date();

  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const [month, setMonth] = useState(defaultMonth);

  const [useCustomRange, setUseCustomRange] = useState(false);

  const [fromDate, setFromDate] = useState(defaultMonth + "-01");

  const [toDate, setToDate] = useState(monthBounds(defaultMonth).to);



  const range = useMemo(() => {

    if (useCustomRange) {

      return { from: fromDate, to: toDate };

    }

    return monthBounds(month);

  }, [useCustomRange, month, fromDate, toDate]);



  const detailRows = useMemo(() => {

    const itemsById = new Map(initialItems.map((i) => [i.id, i]));

    const sitesByCode = new Map(

      sites.map((s) => [

        s.site_code,

        { site_name: s.site_name, project_id: s.project_id },

      ]),

    );

    const projectLabelById = new Map<string, string>();

    for (const site of sites) {

      if (site.project_id) {

        projectLabelById.set(

          site.project_id,

          [site.project_code, site.project_name].filter(Boolean).join(" — ") ||

            site.project_id,

        );

      }

    }

    return buildSiteUsageRows({

      movements: initialMovements,

      itemsById,

      sitesByCode,

      projectLabelById,

      fromDate: range.from,

      toDate: range.to,

    });

  }, [initialMovements, initialItems, sites, range]);



  const displayRows = useMemo(

    () => buildDisplayRows(detailRows),

    [detailRows],

  );



  const grandTotal = useMemo(

    () =>

      Math.round(detailRows.reduce((sum, row) => sum + row.netValue, 0) * 100) /

      100,

    [detailRows],

  );



  function exportCsv() {

    downloadCsv(

      `consumables-site-usage-${range.from}-to-${range.to}.csv`,

      [

        "Site",

        "Contract / project",

        "Item",

        "Net quantity",

        "Unit",

        "Net value (GHS)",

      ],

      detailRows.map((row) => [

        row.siteName,

        row.projectLabel,

        row.itemName,

        row.netQuantity,

        row.unit,

        row.netValue,

      ]),

    );

  }



  function handlePrint() {

    window.print();

  }



  return (

    <div className="space-y-4 print:space-y-2">

      <div className="no-print flex flex-wrap items-end gap-4">

        <label className="block text-sm">

          <span className="mb-1 block font-medium">Month</span>

          <input

            type="month"

            className={consumablesInputClassName}

            value={month}

            disabled={useCustomRange}

            onChange={(e) => {

              setMonth(e.target.value);

              const b = monthBounds(e.target.value);

              setFromDate(b.from);

              setToDate(b.to);

            }}

          />

        </label>

        <label className="flex items-center gap-2 text-sm">

          <input

            type="checkbox"

            checked={useCustomRange}

            onChange={(e) => setUseCustomRange(e.target.checked)}

          />

          Custom date range

        </label>

        {useCustomRange ? (

          <>

            <input

              type="date"

              className={consumablesInputClassName}

              value={fromDate}

              onChange={(e) => setFromDate(e.target.value)}

            />

            <input

              type="date"

              className={consumablesInputClassName}

              value={toDate}

              onChange={(e) => setToDate(e.target.value)}

            />

          </>

        ) : null}

        <button

          type="button"

          className={consumablesPrimaryButtonClassName}

          onClick={exportCsv}

        >

          Export CSV

        </button>

        <button

          type="button"

          className="rounded-md border border-slate-300 px-4 py-2 text-sm"

          onClick={handlePrint}

        >

          Print

        </button>

      </div>

      <ScrollableTable>

        <table className={scrollableTableClassName}>

          <thead className={scrollableTableHeadClassName}>

            <tr>

              <th className={scrollableTableThClassName}>Site</th>

              <th className={scrollableTableThClassName}>Contract / project</th>

              <th className={scrollableTableThClassName}>Item</th>

              <th className={scrollableTableThClassName}>Net qty</th>

              <th className={scrollableTableThClassName}>Net value</th>

            </tr>

          </thead>

          <tbody>

            {displayRows.length === 0 ? (

              <tr>

                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">

                  No site usage in this period.

                </td>

              </tr>

            ) : (

              displayRows.map((entry, index) => {

                if (entry.kind === "detail") {

                  const row = entry.row;

                  return (

                    <tr key={`d-${row.siteCode}-${row.itemId}-${row.projectId}-${index}`}>

                      <td className="px-4 py-3 text-sm">{row.siteName}</td>

                      <td className="px-4 py-3 text-sm">{row.projectLabel}</td>

                      <td className="px-4 py-3 text-sm">{row.itemName}</td>

                      <td className="px-4 py-3 text-sm">

                        {row.netQuantity} {row.unit ?? ""}

                      </td>

                      <td className="px-4 py-3 text-sm">

                        {formatGHS(row.netValue)}

                      </td>

                    </tr>

                  );

                }

                if (entry.kind === "projectSubtotal") {

                  return (

                    <tr

                      key={`p-${entry.siteName}-${entry.projectLabel}-${index}`}

                      className="bg-slate-50 text-sm italic text-slate-700"

                    >

                      <td className="px-4 py-2" colSpan={3}>

                        Subtotal — {entry.siteName} · {entry.projectLabel}

                      </td>

                      <td className="px-4 py-2" />

                      <td className="px-4 py-2 font-medium not-italic">

                        {formatGHS(entry.value)}

                      </td>

                    </tr>

                  );

                }

                return (

                  <tr

                    key={`s-${entry.siteName}-${index}`}

                    className="bg-slate-100 text-sm font-semibold text-[#0f2744]"

                  >

                    <td className="px-4 py-2" colSpan={3}>

                      Subtotal — {entry.siteName}

                    </td>

                    <td className="px-4 py-2" />

                    <td className="px-4 py-2">{formatGHS(entry.value)}</td>

                  </tr>

                );

              })

            )}

            {detailRows.length > 0 ? (

              <tr className="bg-slate-200 font-semibold">

                <td colSpan={4} className="px-4 py-3 text-sm">

                  Grand total

                </td>

                <td className="px-4 py-3 text-sm">{formatGHS(grandTotal)}</td>

              </tr>

            ) : null}

          </tbody>

        </table>

      </ScrollableTable>

    </div>

  );

}

