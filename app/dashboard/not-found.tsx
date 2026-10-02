import Link from "next/link";

export default function DashboardNotFound() {
  return (
    <div className="flex min-h-[min(60vh,32rem)] flex-col items-center justify-center px-4 text-center">
      <h1 className="text-2xl font-semibold text-[#0f2744]">
        We couldn&apos;t find that page
      </h1>
      <p className="mt-2 max-w-md text-sm text-slate-600">
        The link may be outdated, or you may not have access to this section.
        Use the sidebar to navigate, or return to your dashboard home.
      </p>
      <Link
        href="/dashboard"
        className="mt-6 rounded-md bg-[#0f2744] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
      >
        Back to Dashboard
      </Link>
    </div>
  );
}
