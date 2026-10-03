import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Finance",
};

export default function LandlordPortalFinanceLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
