import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard",
};

export default function FacilityPortalDashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
