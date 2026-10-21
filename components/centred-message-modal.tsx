"use client";

export default function CentredMessageModal({
  title,
  message,
  onClose,
}: {
  title: string;
  message: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="centred-message-title"
    >
      <div className="w-full max-w-md rounded-lg bg-white p-6 text-center shadow-lg">
        <h2
          id="centred-message-title"
          className="text-lg font-semibold text-[#0f2744]"
        >
          {title}
        </h2>
        <p className="mt-3 text-sm text-slate-700">{message}</p>
        <button
          type="button"
          onClick={onClose}
          className="mt-5 rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white"
        >
          OK
        </button>
      </div>
    </div>
  );
}
