import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "My Home",
};

export default function PortalDashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
