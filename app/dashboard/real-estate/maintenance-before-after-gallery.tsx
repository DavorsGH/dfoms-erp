/**
 * Before/after maintenance photo galleries for portal and staff views.
 */
export default function MaintenanceBeforeAfterGallery({
  submissionPhotoUrls,
  completionPhotoUrls,
  compact = false,
}: {
  submissionPhotoUrls: string[];
  completionPhotoUrls: string[];
  compact?: boolean;
}) {
  const thumbClass = compact ? "h-20 w-20" : "h-24 w-24";

  function renderGallery(label: string, urls: string[], emptyLabel: string) {
    return (
      <div>
        <p className="mb-2 text-sm font-medium text-slate-700">{label}</p>
        {urls.length > 0 ? (
          <div className="flex flex-wrap gap-3">
            {urls.map((url) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="block overflow-hidden rounded-md border border-slate-200"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={label}
                  className={`${thumbClass} object-cover`}
                />
              </a>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">{emptyLabel}</p>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {renderGallery(
        "Before (your submission)",
        submissionPhotoUrls,
        "No submission photos.",
      )}
      {renderGallery(
        "After (completed work)",
        completionPhotoUrls,
        "No completion photos yet.",
      )}
    </div>
  );
}
