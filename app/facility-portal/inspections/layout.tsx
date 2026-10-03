import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Inspections",
};

export default function FacilityPortalInspectionsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
