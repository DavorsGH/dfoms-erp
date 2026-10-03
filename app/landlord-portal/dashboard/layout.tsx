import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard",
};

export default function LandlordPortalDashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
