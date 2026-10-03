import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Trial ended",
};

export default function TrialExpiredLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
