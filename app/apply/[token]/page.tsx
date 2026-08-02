import Image from "next/image";
import { createAdminClient } from "@/utils/supabase/admin";
import { resolveRentalApplicationLink } from "@/utils/rental-application-links";
import { portalAuthCardClassName } from "@/app/portal/portal-ui";
import ApplyForm from "./apply-form";

type PageProps = {
  params: Promise<{ token: string }>;
};

export default async function PublicApplyPage({ params }: PageProps) {
  const { token } = await params;
  const admin = createAdminClient();
  const resolved = await resolveRentalApplicationLink(admin, token);

  const loadError = resolved.ok ? null : resolved.error;
  const context = resolved.ok ? resolved.context : null;

  return (
    <div className="flex min-h-screen flex-col items-center bg-[#0F2744] px-4 py-10">
      <div className={`${portalAuthCardClassName} max-w-2xl`}>
        <div className="mb-4 flex justify-center">
          <Image
            src="/icons/apple-touch-icon-180x180.png"
            alt="Davors"
            width={56}
            height={56}
          />
        </div>
        <h1 className="mb-1 text-center text-xl font-semibold text-[#0f2744]">
          Rental Application
        </h1>
        <p className="mb-6 text-center text-sm text-slate-600">
          Complete this form to apply for the listed unit. No account required.
        </p>
        <ApplyForm
          token={token}
          propertyName={context?.propertyName ?? "—"}
          unitNumber={context?.unitNumber ?? "—"}
          baseRentGhs={context?.baseRentGhs ?? 0}
          accepting={context?.unitStatus === "vacant"}
          loadError={loadError}
        />
      </div>
    </div>
  );
}
