import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Account",
};

export default function PortalAccountLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
