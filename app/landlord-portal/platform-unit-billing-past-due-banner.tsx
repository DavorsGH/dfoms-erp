import Link from "next/link";
import type { PlatformOnlyMonthlyBillingPastDueBanner } from "@/utils/platform-only-unit-monthly-billing";

type Props = {
  banner: PlatformOnlyMonthlyBillingPastDueBanner;
};

export default function PlatformUnitBillingPastDueBanner({ banner }: Props) {
  if (!banner.show) {
    return null;
  }

  return (
    <div
      className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
      role="status"
    >
      <p className="font-medium">Unit billing payment overdue</p>
      <p className="mt-1">{banner.message}</p>
      <p className="mt-2">
        <Link
          href="/landlord-portal/real-estate/units"
          className="font-medium text-amber-950 underline underline-offset-2 hover:text-amber-900"
        >
          Go to Units billing
        </Link>
      </p>
    </div>
  );
}
