"use client";

export type DialogDetailRow = {
  label: string;
  value: string | number;
};

export function DialogDetailList({ rows }: { rows: DialogDetailRow[] }) {
  if (rows.length === 0) {
    return null;
  }

  return (
    <dl className="mt-4 space-y-2 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm">
      {rows.map((row) => (
        <div key={row.label} className="flex justify-between gap-4">
          <dt className="text-slate-600">{row.label}</dt>
          <dd className="font-medium text-slate-900">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
