import Link from "next/link";
import type { ReactNode } from "react";
import { verifyPaystackTransaction } from "@/utils/paystack";

type BillingCallbackPageProps = {
  searchParams: Promise<{ reference?: string | string[] }>;
};

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0]?.trim() ?? "";
  }
  return value?.trim() ?? "";
}

function formatMoney(amountPesewas: number | null, currency: string | null): string {
  if (amountPesewas == null || !Number.isFinite(amountPesewas)) {
    return "—";
  }

  const major = amountPesewas / 100;
  const code = (currency ?? "GHS").toUpperCase();
  return `${code} ${major.toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default async function BillingCallbackPage({
  searchParams,
}: BillingCallbackPageProps) {
  const params = await searchParams;
  const reference = firstParam(params.reference);

  if (!reference) {
    return (
      <CallbackShell title="Payment incomplete" tone="warning">
        <p className="text-sm text-slate-700">
          No payment reference was returned from Paystack. If you completed a
          payment, wait a moment and check Billing Settings, or contact support
          with the time of the attempt.
        </p>
      </CallbackShell>
    );
  }

  const verified = await verifyPaystackTransaction(reference);

  if (!verified.ok) {
    return (
      <CallbackShell title="Unable to verify payment" tone="error">
        <p className="text-sm text-slate-700">{verified.error}</p>
        <p className="mt-2 text-xs text-slate-500">Reference: {reference}</p>
      </CallbackShell>
    );
  }

  const success = verified.status === "success";

  return (
    <CallbackShell
      title={success ? "Payment successful" : "Payment not completed"}
      tone={success ? "success" : "warning"}
    >
      <dl className="space-y-2 text-sm text-slate-700">
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-medium text-slate-800">Status</dt>
          <dd className="capitalize">{verified.status}</dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-medium text-slate-800">Amount</dt>
          <dd>{formatMoney(verified.amount, verified.currency)}</dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-medium text-slate-800">Reference</dt>
          <dd className="font-mono text-xs">{verified.reference}</dd>
        </div>
        {verified.gatewayResponse ? (
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-medium text-slate-800">Gateway</dt>
            <dd>{verified.gatewayResponse}</dd>
          </div>
        ) : null}
      </dl>

      <p className="mt-4 text-sm text-slate-600">
        {success
          ? "Your payment was received. Subscription status will update shortly once Paystack confirms the charge (webhook). You can return to Billing Settings."
          : "No successful charge was confirmed for this reference. You can try again from Billing Settings."}
      </p>
    </CallbackShell>
  );
}

function CallbackShell({
  title,
  tone,
  children,
}: {
  title: string;
  tone: "success" | "warning" | "error";
  children: ReactNode;
}) {
  // Border/background only — do not set inherited text color on the card.
  // A tone text utility on the section made the title low-contrast (near-white
  // on the tinted background); body copy already sets its own slate colors.
  const toneClass =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50"
      : tone === "error"
        ? "border-red-200 bg-red-50"
        : "border-amber-200 bg-amber-50";

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h2 className="text-xl font-semibold text-[#0f2744]">Payment result</h2>
      <section className={`rounded-lg border p-6 shadow-sm ${toneClass}`}>
        <h3 className="mb-3 text-lg font-semibold text-[#0f2744]">{title}</h3>
        {children}
      </section>
      <Link
        href="/dashboard/administration/billing"
        className="inline-flex rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
      >
        Back to Billing Settings
      </Link>
    </div>
  );
}
