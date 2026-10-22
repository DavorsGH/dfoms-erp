import type { Metadata } from "next";
import { guardDirectorsBoardAccess } from "@/utils/section-guard";

export const metadata: Metadata = {
  title: "Directors",
};

export default async function DirectorsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await guardDirectorsBoardAccess();
  return <>{children}</>;
}
