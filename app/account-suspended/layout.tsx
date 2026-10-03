import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Account suspended",
};

export default function AccountSuspendedLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
