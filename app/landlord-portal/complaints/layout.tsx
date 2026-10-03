import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Complaints",
};

export default function LandlordPortalComplaintsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
