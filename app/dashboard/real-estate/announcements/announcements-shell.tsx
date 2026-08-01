import AnnouncementsNav from "./announcements-nav";

type AnnouncementsShellProps = {
  children: React.ReactNode;
  sectionTitle: string;
  landlordId: string | null;
};

export default function AnnouncementsShell({
  children,
  sectionTitle,
  landlordId,
}: AnnouncementsShellProps) {
  return (
    <div>
      <p className="mb-4 text-sm text-slate-600">
        Landlord-scoped email, SMS, and in-app announcements to tenants
        (lessees). In-app messages appear in the Tenant Portal notification
        bell when the tenant has a portal account.
      </p>
      <AnnouncementsNav landlordId={landlordId} />
      <h3 className="mb-6 text-lg font-semibold text-[#0f2744]">{sectionTitle}</h3>
      {children}
    </div>
  );
}
