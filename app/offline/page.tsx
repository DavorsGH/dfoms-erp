import Image from "next/image";
import Link from "next/link";

export const dynamic = "force-static";

/**
 * Minimal offline shell precached by the service worker.
 * Shown when a full navigation fails while offline.
 */
export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#0F2744] px-4">
      <div className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-8 text-center shadow-sm">
        <div className="mb-4 flex justify-center">
          <Image
            src="/icons/apple-touch-icon-180x180.png"
            alt="Davors Facilities"
            width={64}
            height={64}
            className="h-16 w-16"
            priority
          />
        </div>
        <h1 className="mb-2 text-xl font-semibold text-zinc-900">You are offline</h1>
        <p className="mb-6 text-sm text-zinc-600">
          Your session stays active. Reconnect to load live pages. Cached
          dashboard summaries remain available when you already have them open.
        </p>
        <p className="text-sm text-zinc-600">
          <Link
            href="/dashboard"
            className="font-medium text-zinc-900 underline hover:text-zinc-700"
          >
            Try again
          </Link>
        </p>
      </div>
    </div>
  );
}
