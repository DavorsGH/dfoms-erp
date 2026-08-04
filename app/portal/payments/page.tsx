import Link from "next/link";
import { redirect } from "next/navigation";
import { formatRentMoney } from "@/app/dashboard/real-estate/rent-ledger-utils";
import {
  fetchPortalPaymentHistoryForSession,
  getPortalLesseeSession,
} from "@/utils/lessee-portal-auth";
import PortalShell from "../portal-shell";
import {
  portalErrorBannerClassName,
  portalSectionClassName,
  portalSectionTitleClassName,
} from "../portal-ui";

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default async function PortalPaymentsPage() {
  const session = await getPortalLesseeSession();
  if (!session) {
    redirect("/portal/login");
  }

  const { rows, error } = await fetchPortalPaymentHistoryForSession(session);

  return (
    <PortalShell fullName={session.fullName}>
      <div className="space-y-4">
        <div>
          <Link
            href="/portal/dashboard"
            className="text-sm text-[#0f2744] hover:underline"
          >
            ← Dashboard
          </Link>
          <h1 className="mt-2 text-xl font-semibold text-[#0f2744]">
            Payment history
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Download or print receipts for confirmed rent and one-time charge
            payments.
          </p>
        </div>

        {error ? <div className={portalErrorBannerClassName}>{error}</div> : null}

        {rows.length === 0 ? (
          <section className={portalSectionClassName}>
            <p className="text-sm text-slate-600">
              No confirmed payments yet. Receipts appear here after rent or
              one-time charges are paid.
            </p>
          </section>
        ) : (
          <section className={portalSectionClassName}>
            <h2 className={portalSectionTitleClassName}>Confirmed payments</h2>
            <ul className="mt-4 divide-y divide-slate-200">
              {rows.map((row) => (
                <li
                  key={row.entryId}
                  className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0"
                >
                  <div>
                    <p className="text-sm font-medium text-[#0f2744]">
                      {row.chargeTypeLabel}
                    </p>
                    <p className="mt-1 text-xs text-slate-600">
                      {formatDate(row.paymentDate)} · {row.paymentMethodLabel}
                    </p>
                    <p className="mt-1 font-mono text-xs text-slate-500">
                      Ref: {row.receiptReference}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <p className="text-sm font-semibold text-slate-900">
                      {formatRentMoney(row.amountPaidGhs)}
                    </p>
                    <Link
                      href={`/portal/payments/${row.entryId}`}
                      className="text-sm font-medium text-[#0f2744] hover:underline"
                    >
                      View receipt
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </PortalShell>
  );
}
