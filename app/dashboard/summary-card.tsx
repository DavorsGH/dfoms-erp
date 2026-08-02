import Link from "next/link";

export type SummaryCardTone = "default" | "success" | "danger" | "ytd";

export function SummaryCard({
  title,
  subtitle,
  value,
  breakdown,
  href,
  tone = "default",
}: {
  title: string;
  subtitle?: string;
  value: string;
  breakdown?: Array<{ label: string; value: string }>;
  href: string;
  tone?: SummaryCardTone;
}) {
  const toneClasses =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50"
      : tone === "danger"
        ? "border-red-200 bg-red-50"
        : tone === "ytd"
          ? "border-[#0f2744]/20 bg-slate-100 ring-1 ring-[#0f2744]/10"
          : "border-slate-200 bg-white";

  return (
    <Link
      href={href}
      className={`rounded-lg border p-5 shadow-sm transition-colors hover:border-[#0f2744] hover:shadow-md ${toneClasses}`}
    >
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {subtitle ? (
        <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
      ) : null}
      {breakdown ? (
        <div className="mt-4 space-y-2 text-sm">
          {breakdown.map((item) => (
            <div
              key={item.label}
              className="flex items-start justify-between gap-3 text-slate-600"
            >
              <span>{item.label}</span>
              <span className="font-medium text-slate-800">{item.value}</span>
            </div>
          ))}
          <div className="flex items-start justify-between gap-3 border-t border-slate-200 pt-2">
            <span className="font-medium text-slate-700">Total</span>
            <span className="text-lg font-semibold text-[#0f2744]">{value}</span>
          </div>
        </div>
      ) : (
        <p className="mt-2 text-2xl font-semibold text-[#0f2744]">{value}</p>
      )}
    </Link>
  );
}
