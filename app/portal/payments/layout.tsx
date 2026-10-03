import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Payments",
};

export default function PortalPaymentsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
