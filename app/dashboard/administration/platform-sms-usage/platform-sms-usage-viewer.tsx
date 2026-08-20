"use client";

import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "@/app/dashboard/scrollable-table";
import { getStripedRowClassName } from "@/app/dashboard/finance/register-row-actions";
import type { PlatformSmsUsageReport } from "@/utils/platform-sms-usage-types";

type PlatformSmsUsageViewerProps = {
  report: PlatformSmsUsageReport;
  fetchError: string | null;
};

function formatNumber(value: number): string {
  return value.toLocaleString("en-GH");
}

function formatGeneratedAt(value: string): string {
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function SummaryCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold text-[#0f2744]">{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export default function PlatformSmsUsageViewer({
  report,
  fetchError,
}: PlatformSmsUsageViewerProps) {
  if (fetchError) {
    return (
      <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {fetchError}
      </p>
    );
  }

  const { totals, hubtelBalance, hubtelReportedSends, transactionalLog } = report;
  const hubtelMismatch =
    hubtelReportedSends.available && hubtelReportedSends.discrepancy !== 0;

  return (
    <div className="space-y-8">
      <p className="text-sm text-slate-600">
        Platform-wide SMS draw on Davors&apos; shared Hubtel sender. Generated{" "}
        {formatGeneratedAt(report.generatedAt)}.
      </p>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="Total SMS sent (all tenants)"
          value={formatNumber(totals.totalSends)}
          hint="From sms_credit_transactions send debits"
        />
        <SummaryCard
          label="Free allowance sends"
          value={formatNumber(totals.allowanceSends)}
          hint="Pure Hubtel cost — no tenant revenue"
        />
        <SummaryCard
          label="Paid-credit sends"
          value={formatNumber(totals.paidSends)}
          hint="Debited from purchased SMS credits"
        />
        <SummaryCard
          label="Hubtel account balance"
          value={
            hubtelBalance.available && hubtelBalance.balance !== null
              ? `${hubtelBalance.currency ?? "GHS"} ${hubtelBalance.balance.toLocaleString("en-GH", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}`
              : "Unavailable"
          }
          hint={
            hubtelBalance.available
              ? hubtelBalance.endpoint ?? undefined
              : [
                  hubtelBalance.configuredClientIdLabel
                    ? `Client ID: ${hubtelBalance.configuredClientIdLabel}`
                    : null,
                  hubtelBalance.error ??
                    "Check Hubtel dashboard (Developers → Programmable API Keys → SMS API Keys).",
                ]
                  .filter(Boolean)
                  .join(" · ")
          }
        />
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-lg font-semibold text-[#0f2744]">
          Usage by period
        </h3>
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Period</th>
                <th className={scrollableTableThClassName}>Total sends</th>
                <th className={scrollableTableThClassName}>Allowance sends</th>
                <th className={scrollableTableThClassName}>Paid-credit sends</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {report.periodBreakdown.map((row, index) => (
                <tr key={row.period} className={getStripedRowClassName(index)}>
                  <td className="px-4 py-3 font-medium text-[#0f2744]">
                    {row.label}
                  </td>
                  <td className="px-4 py-3">{formatNumber(row.totalSends)}</td>
                  <td className="px-4 py-3">{formatNumber(row.allowanceSends)}</td>
                  <td className="px-4 py-3">{formatNumber(row.paidSends)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollableTable>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-lg font-semibold text-[#0f2744]">
          Per-tenant breakdown
        </h3>
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Tenant</th>
                <th className={scrollableTableThClassName}>Code</th>
                <th className={scrollableTableThClassName}>Total sends</th>
                <th className={scrollableTableThClassName}>Allowance sends</th>
                <th className={scrollableTableThClassName}>Paid sends</th>
                <th className={scrollableTableThClassName}>Allowance granted</th>
                <th className={scrollableTableThClassName}>Credits purchased</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {report.perTenant.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-8 text-center text-sm text-slate-500"
                  >
                    No SMS send activity recorded yet.
                  </td>
                </tr>
              ) : (
                report.perTenant.map((row, index) => (
                  <tr key={row.tenantId} className={getStripedRowClassName(index)}>
                    <td className="px-4 py-3 font-medium text-[#0f2744]">
                      {row.tenantName}
                    </td>
                    <td className="px-4 py-3">{row.tenantCode ?? "—"}</td>
                    <td className="px-4 py-3">{formatNumber(row.totalSends)}</td>
                    <td className="px-4 py-3">
                      {formatNumber(row.allowanceSends)}
                    </td>
                    <td className="px-4 py-3">{formatNumber(row.paidSends)}</td>
                    <td className="px-4 py-3">
                      {formatNumber(row.allowanceCreditsGranted)}
                    </td>
                    <td className="px-4 py-3">
                      {formatNumber(row.paidCreditsPurchased)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </ScrollableTable>
      </section>

      <section
        className={`rounded-lg border p-6 shadow-sm ${
          hubtelMismatch
            ? "border-amber-300 bg-amber-50"
            : "border-slate-200 bg-white"
        }`}
      >
        <h3 className="mb-3 text-lg font-semibold text-[#0f2744]">
          Hubtel reconciliation
        </h3>
        <dl className="grid gap-3 text-sm text-slate-700 sm:grid-cols-2">
          <div>
            <dt className="font-medium text-slate-900">Configured Client ID</dt>
            <dd>
              {hubtelReportedSends.configuredClientIdLabel ??
                hubtelBalance.configuredClientIdLabel ??
                "—"}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-slate-900">Internal ledger sends</dt>
            <dd>{formatNumber(hubtelReportedSends.ledgerSendCount)}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-900">Hubtel-reported sends</dt>
            <dd>
              {hubtelReportedSends.available &&
              hubtelReportedSends.outboundSendCount !== null
                ? formatNumber(hubtelReportedSends.outboundSendCount)
                : "API unavailable"}
            </dd>
          </div>
          {hubtelReportedSends.available ? (
            <div>
              <dt className="font-medium text-slate-900">
                Discrepancy (Hubtel − ledger)
              </dt>
              <dd
                className={
                  hubtelMismatch ? "font-semibold text-amber-800" : undefined
                }
              >
                {formatNumber(hubtelReportedSends.discrepancy)}
                {hubtelMismatch ? " — investigate drift" : ""}
              </dd>
            </div>
          ) : null}
          {hubtelReportedSends.error ? (
            <div className="sm:col-span-2">
              <dt className="font-medium text-slate-900">Hubtel API note</dt>
              <dd>{hubtelReportedSends.error}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section className="rounded-lg border border-slate-200 bg-slate-50 p-6">
        <h3 className="mb-3 text-lg font-semibold text-[#0f2744]">
          Ledger cross-check
        </h3>
        <dl className="grid gap-3 text-sm text-slate-700 sm:grid-cols-2">
          <div>
            <dt className="font-medium text-slate-900">Transactional SMS log</dt>
            <dd>
              {transactionalLog.available
                ? `${formatNumber(transactionalLog.totalLogged)} logged sends`
                : "Not deployed"}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-slate-900">Ledger send count</dt>
            <dd>{formatNumber(transactionalLog.ledgerSendCount)}</dd>
          </div>
          {transactionalLog.available ? (
            <div>
              <dt className="font-medium text-slate-900">Discrepancy (log − ledger)</dt>
              <dd>{formatNumber(transactionalLog.discrepancy)}</dd>
            </div>
          ) : null}
          {transactionalLog.note ? (
            <div className="sm:col-span-2">
              <dt className="font-medium text-slate-900">Note</dt>
              <dd>{transactionalLog.note}</dd>
            </div>
          ) : null}
        </dl>
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-slate-600">
          {report.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
