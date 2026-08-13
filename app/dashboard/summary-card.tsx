import Link from "next/link";

export type SummaryCardTone = "default" | "success" | "danger" | "ytd";

/** Keeps GHS amounts on one line; peer values scale via clamp below. */
const breakdownValueBase =
  "shrink-0 whitespace-nowrap text-right tabular-nums";

const defaultValueClassName =
  "mt-2 text-2xl font-semibold tabular-nums text-[#0f2744]";

export function SummaryCard({
  title,
  subtitle,
  value,
  breakdown,
  showTotal = true,
  href,
  tone = "default",
  valueClassName,
}: {
  title: string;
  subtitle?: string;
  value: string;
  breakdown?: Array<{ label: string; value: string }>;
  /** When false with a breakdown, omit the Total row (e.g. non-additive peers). */
  showTotal?: boolean;
  href: string;
  tone?: SummaryCardTone;
  /** Overrides default navy value styling (e.g. text-red-700 for negative amounts). */
  valueClassName?: string;
}) {
  const resolvedValueClassName = valueClassName ?? defaultValueClassName;
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
        <div className="@container mt-4 space-y-2 text-sm">
          {breakdown.map((item) => (
            <div
              key={item.label}
              className="flex items-baseline justify-between gap-2 text-slate-600"
            >
              <span className="min-w-0 shrink">{item.label}</span>
              <span
                className={
                  showTotal
                    ? `${breakdownValueBase} font-medium text-slate-800`
                    : `${breakdownValueBase} font-semibold text-[#0f2744] text-[clamp(0.8125rem,5cqi,1.125rem)]`
                }
              >
                {item.value}
              </span>
            </div>
          ))}
          {showTotal ? (
            <div className="flex items-baseline justify-between gap-2 border-t border-slate-200 pt-2">
              <span className="min-w-0 shrink font-medium text-slate-700">
                Total
              </span>
              <span
                className={`${breakdownValueBase} text-lg font-semibold text-[#0f2744]`}
              >
                {value}
              </span>
            </div>
          ) : null}
        </div>
      ) : (
        <p className={resolvedValueClassName}>{value}</p>
      )}
    </Link>
  );
}
