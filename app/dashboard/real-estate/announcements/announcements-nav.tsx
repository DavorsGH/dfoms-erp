"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

type AnnouncementsNavProps = {
  landlordId: string | null;
};

export default function AnnouncementsNav({ landlordId }: AnnouncementsNavProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const landlord =
    landlordId ?? searchParams.get("landlord")?.trim() ?? null;
  const qs = landlord
    ? `?landlord=${encodeURIComponent(landlord)}`
    : "";

  const tabs = [
    {
      label: "Templates",
      href: `/dashboard/real-estate/announcements/templates${qs}`,
      match: "/dashboard/real-estate/announcements/templates",
    },
    {
      label: "Campaigns",
      href: `/dashboard/real-estate/announcements/campaigns${qs}`,
      match: "/dashboard/real-estate/announcements/campaigns",
    },
  ] as const;

  return (
    <div className="mb-6 flex flex-wrap gap-2 border-b border-slate-200 pb-px">
      {tabs.map((item) => {
        const active =
          pathname === item.match || pathname.startsWith(`${item.match}/`);

        return (
          <Link
            key={item.match}
            href={item.href}
            className={`rounded-t-md px-4 py-2 text-sm font-medium transition-colors ${
              active
                ? "border border-b-white border-slate-200 bg-white text-[#0f2744]"
                : "text-slate-600 hover:text-[#0f2744]"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
