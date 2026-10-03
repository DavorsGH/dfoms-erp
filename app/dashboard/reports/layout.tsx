import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Reports",
};

export default function ReportsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
