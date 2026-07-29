import EmployeeAnnouncementsNav from "./employee-announcements-nav";

type EmployeeAnnouncementsShellProps = {
  children: React.ReactNode;
  sectionTitle: string;
};

export default function EmployeeAnnouncementsShell({
  children,
  sectionTitle,
}: EmployeeAnnouncementsShellProps) {
  return (
    <div>
      <p className="mb-4 text-sm text-slate-600">
        Internal email, SMS, and in-app announcement templates and campaigns.
        Sending and the notification bell will follow in later steps.
      </p>
      <EmployeeAnnouncementsNav />
      <h3 className="mb-6 text-lg font-semibold text-[#0f2744]">{sectionTitle}</h3>
      {children}
    </div>
  );
}
