export type RawMaterialDeletePreview = {
  material_name: string;
  purchase_count: number;
  batch_material_count: number;
  incomplete_batches: Array<{
    batch_number: string;
    remaining_material_count: number;
  }>;
};

export type FinishedProductDeletePreview = {
  product_name: string;
  sale_count: number;
  consumption_count: number;
  stock_movement_count: number;
  batch_count: number;
};

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function buildRawMaterialDeleteMessage(
  preview: RawMaterialDeletePreview,
): string {
  const parts: string[] = [];

  if (preview.purchase_count > 0) {
    parts.push(pluralize(preview.purchase_count, "purchase record"));
  }

  if (preview.batch_material_count > 0) {
    parts.push(
      pluralize(preview.batch_material_count, "production batch material line"),
    );
  }

  let message = `Deleting '${preview.material_name}' will also permanently delete`;

  if (parts.length === 0) {
    message += " this raw material";
  } else {
    message += ` ${parts.join(" and ")}`;
  }

  message += ". Linked Cash or Accounts Payable postings from purchases will be reversed.";

  if (preview.incomplete_batches.length > 0) {
    const batchLabels = preview.incomplete_batches
      .map((batch) => batch.batch_number)
      .join(", ");
    message += ` Production batch${preview.incomplete_batches.length === 1 ? "" : "es"} ${batchLabels} will be left without this material and become incomplete.`;
  }

  message += " This cannot be undone. Continue?";
  return message;
}

export function normalizeFinishedProductDeletePreview(
  raw: unknown,
): FinishedProductDeletePreview {
  const preview = (raw ?? {}) as Partial<FinishedProductDeletePreview>;
  return {
    product_name: String(preview.product_name ?? "this product"),
    sale_count: Number(preview.sale_count) || 0,
    consumption_count: Number(preview.consumption_count) || 0,
    stock_movement_count: Number(preview.stock_movement_count) || 0,
    batch_count: Number(preview.batch_count) || 0,
  };
}

export function buildFinishedProductDeleteMessage(
  preview: FinishedProductDeletePreview,
): string {
  const saleCount = preview.sale_count;
  const consumptionCount = preview.consumption_count;
  const batchCount = preview.batch_count;

  if (saleCount === 0 && consumptionCount === 0 && batchCount === 0) {
    return `Deleting '${preview.product_name}' will permanently remove this finished product. This cannot be undone. Continue?`;
  }

  const parts: string[] = [];
  if (saleCount > 0) {
    parts.push(`${saleCount} sale${saleCount === 1 ? "" : "s"}`);
  }
  if (consumptionCount > 0) {
    parts.push(
      `${consumptionCount} internal consumption entr${consumptionCount === 1 ? "y" : "ies"}`,
    );
  }
  if (batchCount > 0) {
    parts.push(`${batchCount} production batch${batchCount === 1 ? "" : "es"}`);
  }

  return `Deleting '${preview.product_name}' will also permanently void/delete ${parts.join(", ")}. This cannot be undone. Continue?`;
}

export function confirmCascadeDelete(message: string): boolean {
  return window.confirm(message);
}
