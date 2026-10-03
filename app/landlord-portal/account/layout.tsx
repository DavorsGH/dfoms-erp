import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "My Account",
};

export default function LandlordPortalAccountLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
