export type LineItemsEditorBaseLine = {
  key: string;
  description: string;
  category_label?: string | null;
  labour_amount: number;
  material_amount: number;
  discount_amount: number;
  taxed: boolean;
  sort_order: number;
  site_id?: string | null;
  product_id?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
};

export type LineItemsEditorSiteOption = {
  site_code: string;
  site_name: string;
};

export type LineItemsEditorProductOption = {
  id: string;
  product_code: string;
  product_name: string;
  standard_selling_price: unknown;
};

export function reindexLineItems<T extends { sort_order: number }>(lines: T[]): T[] {
  return lines.map((line, index) => ({ ...line, sort_order: index }));
}

export function isProductPickerLine(
  line: Pick<LineItemsEditorBaseLine, "product_id">,
): boolean {
  return line.product_id !== null && line.product_id !== undefined;
}
