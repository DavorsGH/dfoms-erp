import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Services",
};

export default function FacilityPortalServicesLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
