import EmailPromotionsNav from "./email-promotions-nav";

type EmailPromotionsShellProps = {
  children: React.ReactNode;
  sectionTitle: string;
};

export default function EmailPromotionsShell({
  children,
  sectionTitle,
}: EmailPromotionsShellProps) {
  return (
    <div>
      <p className="mb-4 text-sm text-slate-600">
        Email &amp; SMS templates, campaigns, and notification rules for your
        workspace.
      </p>
      <EmailPromotionsNav />
      <h3 className="mb-6 text-lg font-semibold text-[#0f2744]">{sectionTitle}</h3>
      {children}
    </div>
  );
}
