/**
 * Tabler outline icons (MIT), stroke width 2, 20px.
 * https://github.com/tabler/tabler-icons
 */
const SIDEBAR_ICON_PATHS = {
  dashboard: [
    "M5 4h4a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-6a1 1 0 0 1 1 -1",
    "M5 16h4a1 1 0 0 1 1 1v2a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-2a1 1 0 0 1 1 -1",
    "M15 12h4a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-6a1 1 0 0 1 1 -1",
    "M15 4h4a1 1 0 0 1 1 1v2a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-2a1 1 0 0 1 1 -1",
  ],
  finance: [
    "M7 15h-3a1 1 0 0 1 -1 -1v-8a1 1 0 0 1 1 -1h12a1 1 0 0 1 1 1v3",
    "M7 10a1 1 0 0 1 1 -1h12a1 1 0 0 1 1 1v8a1 1 0 0 1 -1 1h-12a1 1 0 0 1 -1 -1l0 -8",
    "M12 14a2 2 0 1 0 4 0a2 2 0 0 0 -4 0",
  ],
  sales: [
    "M5 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0",
    "M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2",
    "M16 3.13a4 4 0 0 1 0 7.75",
    "M21 21v-2a4 4 0 0 0 -3 -3.85",
  ],
  inventory: [
    "M12 3l8 4.5l0 9l-8 4.5l-8 -4.5l0 -9l8 -4.5",
    "M12 12l8 -4.5",
    "M12 12l0 9",
    "M12 12l-8 -4.5",
    "M16 5.25l-8 4.5",
  ],
  operations: [
    "M7 10h3v-3l-3.5 -3.5a6 6 0 0 1 8 8l6 6a2 2 0 0 1 -3 3l-6 -6a6 6 0 0 1 -8 -8l3.5 3.5",
  ],
  hr: [
    "M10 13a2 2 0 1 0 4 0a2 2 0 0 0 -4 0",
    "M8 21v-1a2 2 0 0 1 2 -2h4a2 2 0 0 1 2 2v1",
    "M15 5a2 2 0 1 0 4 0a2 2 0 0 0 -4 0",
    "M17 10h2a2 2 0 0 1 2 2v1",
    "M5 5a2 2 0 1 0 4 0a2 2 0 0 0 -4 0",
    "M3 13v-1a2 2 0 0 1 2 -2h2",
  ],
  "real-estate": [
    "M3 21l18 0",
    "M9 8l1 0",
    "M9 12l1 0",
    "M9 16l1 0",
    "M14 8l1 0",
    "M14 12l1 0",
    "M14 16l1 0",
    "M5 21v-16a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v16",
  ],
  "self-service": [
    "M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0",
    "M9 10a3 3 0 1 0 6 0a3 3 0 1 0 -6 0",
    "M6.168 18.849a4 4 0 0 1 3.832 -2.849h4a4 4 0 0 1 3.834 2.855",
  ],
  reports: [
    "M3 13a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -6",
    "M15 9a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -10",
    "M9 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -14",
    "M4 20h14",
  ],
  directors: [
    "M3 9a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v9a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2l0 -9",
    "M8 7v-2a2 2 0 0 1 2 -2h4a2 2 0 0 1 2 2v2",
    "M12 12l0 .01",
    "M3 13a20 20 0 0 0 18 0",
  ],
  devices: [
    "M18.9 7a8 8 0 0 1 1.1 5v1a6 6 0 0 0 .8 3",
    "M8 11a4 4 0 0 1 8 0v1a10 10 0 0 0 2 6",
    "M12 11v2a14 14 0 0 0 2.5 8",
    "M8 15a18 18 0 0 0 1.8 6",
    "M4.9 19a22 22 0 0 1 -.9 -7v-1a8 8 0 0 1 12 -6.95",
  ],
  administration: [
    "M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065",
    "M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0",
  ],
  pos: [
    "M4 19a2 2 0 1 0 4 0a2 2 0 1 0 -4 0",
    "M15 19a2 2 0 1 0 4 0a2 2 0 1 0 -4 0",
    "M17 17h-11v-14h-2",
    "M6 5l14 1l-1 7h-13",
  ],
  portal: [
    "M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0",
    "M3.6 9h16.8",
    "M3.6 15h16.8",
    "M11.5 3a17 17 0 0 0 0 18",
    "M12.5 3a17 17 0 0 1 0 18",
  ],
  collapse: [
    "M4 6a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2l0 -12",
    "M9 4v16",
    "M15 10l-2 2l2 2",
  ],
  expand: [
    "M4 6a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2l0 -12",
    "M9 4v16",
    "M14 10l2 2l-2 2",
  ],
} as const;

export type SidebarIconName = keyof typeof SIDEBAR_ICON_PATHS;

const HREF_ICONS: Record<string, SidebarIconName> = {
  "/dashboard": "dashboard",
  "/dashboard/finance": "finance",
  "/dashboard/finance/suppliers": "finance",
  "/dashboard/crm": "sales",
  "/dashboard/crm/customers": "sales",
  "/dashboard/inventory": "inventory",
  "/dashboard/operations": "operations",
  "/dashboard/hr-payroll": "hr",
  "/dashboard/real-estate": "real-estate",
  "/dashboard/self-service": "self-service",
  "/dashboard/reports": "reports",
  "/dashboard/directors": "directors",
  "/dashboard/devices": "devices",
  "/dashboard/administration": "administration",
  "/dashboard/pos": "pos",
  "/dashboard/client-portal": "portal",
};

export function sidebarIconName(href: string): SidebarIconName {
  return HREF_ICONS[href] ?? "dashboard";
}

export function SidebarOutlineIcon({
  name,
}: {
  name: SidebarIconName;
}) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width={20}
      height={20}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5 shrink-0"
    >
      {SIDEBAR_ICON_PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
