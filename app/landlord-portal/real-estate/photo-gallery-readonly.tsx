/**
 * Read-only photo gallery mirroring staff PhotoGallery layout
 * (app/dashboard/real-estate/property-detail.tsx) without upload/remove.
 */
export default function LandlordPortalPhotoGalleryReadonly({
  urls,
  emptyLabel = "No photos yet.",
  alt = "Photo",
}: {
  urls: string[];
  emptyLabel?: string;
  alt?: string;
}) {
  if (urls.length === 0) {
    return <p className="text-sm text-slate-500">{emptyLabel}</p>;
  }

  return (
    <div className="flex flex-wrap gap-3">
      {urls.map((url) => (
        <a
          key={url}
          href={url}
          target="_blank"
          rel="noreferrer"
          className="relative h-24 w-24 overflow-hidden rounded-md border border-slate-200 bg-slate-50"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={alt} className="h-full w-full object-cover" />
        </a>
      ))}
    </div>
  );
}
