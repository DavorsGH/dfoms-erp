import { guardSelfServiceAccess } from "@/utils/section-guard";

export default async function SelfServiceLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await guardSelfServiceAccess();
  return <>{children}</>;
}
