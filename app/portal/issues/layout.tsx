import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "My Issues",
};

export default function PortalIssuesLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
