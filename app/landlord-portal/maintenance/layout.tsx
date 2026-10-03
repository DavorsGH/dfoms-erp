import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Maintenance",
};

export default function LandlordPortalMaintenanceLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
