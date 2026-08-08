import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentFinancialYear } from "@/app/dashboard/finance/finance-year-utils";
import { logSystemEvent } from "@/lib/system-event-log";
import type { SystemEventStatus } from "@/utils/system-event-log-types";
import { sendResendEmail } from "@/utils/resend-email";
import { BS_INTEGRITY_EVENT_NAME } from "@/utils/balance-sheet-integrity-constants";
import {
  auditTenantBalanceSheetIntegrity,
  type BalanceSheetIntegrityRunResult,
  type TenantBalanceSheetIntegrityResult,
} from "@/utils/balance-sheet-integrity";

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function buildTenantLogMessage(result: TenantBalanceSheetIntegrityResult): string {
  if (result.fetchError) {
    return `FY${result.fiscalYear}: fetch failed — ${result.fetchError}`;
  }

  if (result.imbalances.length === 0) {
    const through =
      result.monthsChecked.length > 0
        ? MONTH_LABELS[result.monthsChecked.at(-1)!]
        : "none";
    return `FY${result.fiscalYear}: balanced through ${through}`;
  }

  const monthSummary = result.imbalances
    .map((row) => `${row.monthLabel}=${row.diff.toFixed(2)}`)
    .join(", ");
  return `FY${result.fiscalYear}: out of balance — ${monthSummary}`;
}

async function sendBalanceSheetIntegrityAlertEmail(
  failures: TenantBalanceSheetIntegrityResult[],
  run: BalanceSheetIntegrityRunResult,
): Promise<void> {
  const alertEmail = (process.env.BS_INTEGRITY_ALERT_EMAIL ?? "").trim();
  if (!alertEmail || failures.length === 0) {
    return;
  }

  const rows = failures
    .map((tenant) => {
      const monthSummary = tenant.fetchError
        ? `Fetch error: ${tenant.fetchError}`
        : tenant.imbalances
            .map((row) => `${row.monthLabel}: GHS ${row.diff.toFixed(2)}`)
            .join("; ");
      return `<tr><td style="padding:8px;border:1px solid #e2e8f0;">${tenant.tenantName}</td><td style="padding:8px;border:1px solid #e2e8f0;">${monthSummary}</td></tr>`;
    })
    .join("");

  const html = `
    <p>The nightly Balance Sheet integrity check found <strong>${failures.length}</strong> tenant(s) out of balance.</p>
    <p>Fiscal year ${run.fiscalYear} · Run ${run.runId} · ${run.referenceDate}</p>
    <table style="border-collapse:collapse;width:100%;max-width:720px;">
      <thead>
        <tr>
          <th style="padding:8px;border:1px solid #e2e8f0;text-align:left;">Tenant</th>
          <th style="padding:8px;border:1px solid #e2e8f0;text-align:left;">Details</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p>Review in Administration → System Event Log (filter: balance-sheet-integrity).</p>
    <p><em>Read-only diagnostic — no financial data was modified.</em></p>
  `;

  const text = failures
    .map((tenant) => {
      const detail = tenant.fetchError
        ? tenant.fetchError
        : tenant.imbalances
            .map((row) => `${row.monthLabel}: ${row.diff.toFixed(2)}`)
            .join("; ");
      return `${tenant.tenantName}: ${detail}`;
    })
    .join("\n");

  const result = await sendResendEmail({
    to: alertEmail,
    subject: `[DFOMS] Balance Sheet integrity: ${failures.length} tenant(s) out of balance`,
    html,
    text: `Balance Sheet integrity failures (FY${run.fiscalYear}):\n\n${text}`,
  });

  if (!result.ok) {
    console.error(
      "[balance-sheet-integrity] alert email failed:",
      result.error,
    );
  }
}

export async function runBalanceSheetIntegrityWithLogging(
  admin: SupabaseClient,
  options: {
    fiscalYear?: number;
    referenceDate?: Date;
    sendAlertEmail?: boolean;
  } = {},
): Promise<BalanceSheetIntegrityRunResult> {
  const startedAt = Date.now();
  const referenceDate = options.referenceDate ?? new Date();
  const fiscalYear = options.fiscalYear ?? getCurrentFinancialYear();
  const runId = crypto.randomUUID();
  const referenceDateIso = referenceDate.toISOString().slice(0, 10);

  const { data: tenants, error } = await admin
    .from("tenants")
    .select("id, name")
    .order("name");

  if (error) {
    throw new Error(`Failed to load tenants: ${error.message}`);
  }

  const tenantResults: TenantBalanceSheetIntegrityResult[] = [];
  for (const tenant of tenants ?? []) {
    const result = await auditTenantBalanceSheetIntegrity(
      admin,
      tenant,
      fiscalYear,
      referenceDate,
    );
    tenantResults.push(result);

    await logSystemEvent({
      eventType: "cron",
      eventName: BS_INTEGRITY_EVENT_NAME,
      status: result.status,
      message: buildTenantLogMessage(result),
      metadata: {
        kind: "tenant",
        runId,
        referenceDate: referenceDateIso,
        tenantId: result.tenantId,
        tenantName: result.tenantName,
        fiscalYear: result.fiscalYear,
        monthsChecked: result.monthsChecked,
        imbalances: result.imbalances,
        maxAbsDiff: result.maxAbsDiff,
        durationMs: result.durationMs,
        fetchError: result.fetchError,
      },
    });
  }

  const balanced = tenantResults.filter(
    (row) => row.status === "success" && !row.fetchError,
  ).length;
  const warnings = tenantResults.filter((row) => row.status === "warning").length;
  const failures = tenantResults.filter(
    (row) => row.status === "failure",
  ).length;
  const fetchErrors = tenantResults.filter((row) => row.fetchError).length;

  const run: BalanceSheetIntegrityRunResult = {
    runId,
    referenceDate: referenceDateIso,
    fiscalYear,
    tenantsChecked: tenantResults.length,
    balanced,
    warnings,
    failures,
    fetchErrors,
    tenantResults,
    durationMs: Date.now() - startedAt,
  };

  const summaryStatus: SystemEventStatus =
    failures > 0 ? "failure" : warnings > 0 ? "warning" : "success";

  await logSystemEvent({
    eventType: "cron",
    eventName: BS_INTEGRITY_EVENT_NAME,
    status: summaryStatus,
    message: `Checked ${run.tenantsChecked} tenant(s): ${balanced} balanced, ${warnings} warning(s), ${failures} failure(s)`,
    metadata: {
      kind: "run-summary",
      runId,
      referenceDate: referenceDateIso,
      fiscalYear,
      tenantsChecked: run.tenantsChecked,
      balanced,
      warnings,
      failures,
      fetchErrors,
      durationMs: run.durationMs,
    },
  });

  const shouldSendEmail =
    options.sendAlertEmail !== false &&
    failures > 0 &&
    Boolean((process.env.BS_INTEGRITY_ALERT_EMAIL ?? "").trim());

  if (shouldSendEmail) {
    await sendBalanceSheetIntegrityAlertEmail(
      tenantResults.filter((row) => row.status === "failure"),
      run,
    );
  }

  return run;
}
