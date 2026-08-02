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
 * Shell chrome comes from landlord-portal layout (nav limited while pending).
 * RLS already blocks real property data for pending users.
 */
export default function LandlordPortalPendingApprovalView({
  fullName: _fullName,
  approvalStatus,
}: LandlordPortalPendingApprovalViewProps) {
  const isRejected = approvalStatus === "rejected";

  return (
    <section className={portalSectionClassName}>
      <h2 className={portalSectionTitleClassName}>
        {isRejected ? "Account not approved" : "Pending approval"}
      </h2>
      {isRejected ? (
        <p className="mt-4 text-sm text-slate-700">
          Your landlord account was not approved. Contact Davors Facilities
          staff if you believe this is a mistake or need help.
        </p>
      ) : (
        <>
          <p className="mt-4 text-sm text-slate-700">
            Thanks for signing up. Your account is waiting for Davors staff
            review. You can sign in anytime — once approved, your properties,
            leases, and rent tools will appear here.
          </p>
          <p className="mt-3 text-sm text-slate-600">
            No action is needed from you right now. We will enable full portal
            access after approval.
          </p>
        </>
      )}
    </section>
  );
}
