export type ProductionBatchEditPreview = {
  can_edit: boolean;
  block_reason: string | null;
  consumed_quantity: number | null;
  sale_count: number | null;
  unit_of_measure: string | null;
};

export function formatProductionBatchEditBlockReason(
  preview: ProductionBatchEditPreview,
): string {
  if (preview.can_edit) {
    return "";
  }

  if (preview.block_reason?.trim()) {
    return preview.block_reason.trim();
  }

  const consumed = Number(preview.consumed_quantity ?? 0);
  const sales = Number(preview.sale_count ?? 0);
  const uom = preview.unit_of_measure?.trim() || "units";

  if (consumed > 0 || sales > 0) {
    const salesPhrase =
      sales === 1 ? "1 sale" : sales > 1 ? `${sales} sales` : "stock use";
    return `This batch can't be edited because product stock has been used since this batch was produced (${salesPhrase}).`;
  }

  return "This batch can't be edited because product stock has been used since this batch was produced.";
}
