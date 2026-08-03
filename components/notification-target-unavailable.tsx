import Link from "next/link";
import { NOTIFICATION_TARGET_UNAVAILABLE_MESSAGE } from "@/utils/notification-unavailable";

/** Inline banner for list pages when a deep-link highlight/filter target is gone. */
export function NotificationTargetUnavailableBanner({
  className = "",
}: {
  className?: string;
}) {
  return (
    <p
      role="status"
      className={`rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 ${className}`.trim()}
    >
      {NOTIFICATION_TARGET_UNAVAILABLE_MESSAGE}
    </p>
  );
}

/** Friendly empty state for detail pages instead of a raw 404. */
export function NotificationTargetUnavailablePanel({
  backHref,
  backLabel,
}: {
  backHref: string;
  backLabel: string;
}) {
  return (
    <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center">
      <p className="text-sm text-slate-700">
        {NOTIFICATION_TARGET_UNAVAILABLE_MESSAGE}
      </p>
      <Link
        href={backHref}
        className="mt-4 inline-block text-sm font-medium text-[#0f2744] hover:underline"
      >
        ← {backLabel}
      </Link>
    </div>
  );
}
