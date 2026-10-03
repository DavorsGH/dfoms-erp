import type { Metadata } from "next";
import { guardSelfServiceAccess } from "@/utils/section-guard";

export const metadata: Metadata = {
  title: "Self-Service",
};

export default async function SelfServiceLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await guardSelfServiceAccess();
  return <>{children}</>;
}
