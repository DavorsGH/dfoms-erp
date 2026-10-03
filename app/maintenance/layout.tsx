import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Maintenance",
};

export default function MaintenanceLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
