import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Accept invite",
};

export default function AcceptInviteLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
