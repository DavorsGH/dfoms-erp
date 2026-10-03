import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Repairs",
};

export default function PortalRepairsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
