"use client";

export function ToastUi({ message }: { message: string }) {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-6 z-[100] flex justify-center px-4"
      role="status"
      aria-live="polite"
    >
      <p className="max-w-lg rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-center text-sm font-medium text-emerald-900 shadow-lg">
        {message}
      </p>
    </div>
  );
}
