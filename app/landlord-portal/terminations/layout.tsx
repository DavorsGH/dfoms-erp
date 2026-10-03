import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terminations",
};

export default function LandlordPortalTerminationsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
