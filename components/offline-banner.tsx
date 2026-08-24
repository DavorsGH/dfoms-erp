"use client";

type OfflineBannerProps = {
  show: boolean;
  /** Override default copy (session persistence vs cache-only dashboard). */
  message?: string;
};

export default function OfflineBanner({ show, message }: OfflineBannerProps) {
  if (!show) {
    return null;
  }

  return (
    <div
      role="status"
      className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      {message ??
        "Offline — data may be outdated. You can view cached summaries, but write actions are blocked until you reconnect."}
    </div>
  );
}
