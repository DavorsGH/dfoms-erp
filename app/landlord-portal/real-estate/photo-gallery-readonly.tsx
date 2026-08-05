import { TenantLogosMediaImage } from "@/components/tenant-logos-media";

/**
 * Read-only photo gallery mirroring staff PhotoGallery layout
 * (app/dashboard/real-estate/property-detail.tsx) without upload/remove.
 */
export default function LandlordPortalPhotoGalleryReadonly({
  urls,
  tenantId,
  emptyLabel = "No photos yet.",
  alt = "Photo",
}: {
  urls: string[];
  tenantId?: string;
  emptyLabel?: string;
  alt?: string;
}) {
  if (urls.length === 0) {
    return <p className="text-sm text-slate-500">{emptyLabel}</p>;
  }

  return (
    <div className="flex flex-wrap gap-3">
      {urls.map((reference) => (
        <TenantLogosMediaImage
          key={reference}
          reference={reference}
          tenantId={tenantId}
          alt={alt}
          className="h-24 w-24 object-cover"
          linkable
        />
      ))}
    </div>
  );
}
