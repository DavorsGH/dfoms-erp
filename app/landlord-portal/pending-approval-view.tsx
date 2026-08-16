import {
  portalSectionClassName,
  portalSectionTitleClassName,
} from "./portal-ui";

type LandlordPortalPendingApprovalViewProps = {
  fullName: string;
  approvalStatus: string | null;
};

/**
 * Shown when a landlord can authenticate but approval_status is not approved.
 * Shell chrome comes from landlord-portal layout (nav limited while inactive).
 * RLS already blocks real property data for non-approved users.
 */
export default function LandlordPortalPendingApprovalView({
  fullName: _fullName,
  approvalStatus,
}: LandlordPortalPendingApprovalViewProps) {
  const isRejected = approvalStatus === "rejected";
  const isSuspended = approvalStatus === "suspended";

  let title = "Account setup incomplete";
  let body = (
    <>
      <p className="mt-4 text-sm text-slate-700">
        Your landlord account does not have full portal access yet. If you
        recently signed up, finish any remaining setup steps from your
        confirmation email.
      </p>
      <p className="mt-3 text-sm text-slate-600">
        Contact Davors Facilities staff if you need help accessing your
        properties and rent tools.
      </p>
    </>
  );

  if (isSuspended) {
    title = "Portal access suspended";
    body = (
      <p className="mt-4 text-sm text-slate-700">
        Your landlord portal access has been suspended. Contact Davors
        Facilities staff if you believe this is a mistake or need help.
      </p>
    );
  } else if (isRejected) {
    title = "Account not approved";
    body = (
      <p className="mt-4 text-sm text-slate-700">
        Your landlord account was not approved. Contact Davors Facilities
        staff if you believe this is a mistake or need help.
      </p>
    );
  }

  return (
    <section className={portalSectionClassName}>
      <h2 className={portalSectionTitleClassName}>{title}</h2>
      {body}
    </section>
  );
}
