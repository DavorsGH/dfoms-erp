import Link from "next/link";
import {
  isTierFeatureKey,
  TIER_FEATURE_LABELS,
  TIER_FEATURE_MIN_PLAN,
} from "@/utils/tier-access";

type UpgradeRequiredPageProps = {
  searchParams: Promise<{ feature?: string | string[] }>;
};

export default async function UpgradeRequiredPage({
  searchParams,
}: UpgradeRequiredPageProps) {
  const params = await searchParams;
  const raw = Array.isArray(params.feature) ? params.feature[0] : params.feature;
  const featureKey = (raw ?? "").trim();

  const known = isTierFeatureKey(featureKey);
  const featureLabel = known
    ? TIER_FEATURE_LABELS[featureKey]
    : "This feature";
  const minPlan = known ? TIER_FEATURE_MIN_PLAN[featureKey] : null;

  return (
    <div className="mx-auto max-w-lg py-10">
      <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-[#0f2744]">
          Upgrade required
        </h2>
        <p className="text-sm leading-relaxed text-slate-600">
          {known ? (
            <>
              <span className="font-medium text-slate-800">{featureLabel}</span>{" "}
              is not included on your current plan.
              {minPlan ? (
                <>
                  {" "}
                  Upgrade to{" "}
                  <span className="font-medium text-slate-800">{minPlan}</span>{" "}
                  or higher to unlock it.
                </>
              ) : null}
            </>
          ) : (
            <>
              This area is not included on your current plan. Upgrade your
              subscription to unlock additional modules.
            </>
          )}
        </p>
        <div className="pt-2">
          <Link
            href="/dashboard/administration/billing"
            className="inline-flex rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
          >
            View plans &amp; billing
          </Link>
        </div>
      </div>
    </div>
  );
}
