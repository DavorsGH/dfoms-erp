import { redirect } from "next/navigation";

type PageProps = {
  searchParams: Promise<{ landlord?: string }>;
};

export default async function AnnouncementsIndexPage({
  searchParams,
}: PageProps) {
  const { landlord } = await searchParams;
  const qs = landlord?.trim()
    ? `?landlord=${encodeURIComponent(landlord.trim())}`
    : "";
  redirect(`/dashboard/real-estate/announcements/templates${qs}`);
}
