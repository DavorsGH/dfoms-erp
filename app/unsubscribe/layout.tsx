import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Unsubscribe",
};

export default function UnsubscribeLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
