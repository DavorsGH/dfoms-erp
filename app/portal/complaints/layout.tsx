import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Complaints",
};

export default function PortalComplaintsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
