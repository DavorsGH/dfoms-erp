import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Real Estate",
};

export default function LandlordPortalRealEstateLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
