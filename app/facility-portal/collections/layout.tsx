import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Collections",
};

export default function FacilityPortalCollectionsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
