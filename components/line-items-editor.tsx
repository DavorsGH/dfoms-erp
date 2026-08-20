"use client";

import { useMemo, useState } from "react";
import type { SalesTaxBasis } from "@/app/dashboard/finance/tax-utils";
import {
  computeLineTotalCost,
  formatInvoiceMoney,
  toNumber,
} from "@/utils/client-invoices-types";
import { computeQuotationLineTotalCost } from "@/utils/client-quotations-types";
import {
  isProductPickerLine,
  reindexLineItems,
  type LineItemsEditorBaseLine,
  type LineItemsEditorProductOption,
  type LineItemsEditorSiteOption,
} from "@/utils/line-items-editor-utils";
import { computeLineItemTotals } from "@/utils/line-items-totals";

export type LineItemsEditorItemSource = "none" | "site" | "product";

export type LineItemsEditorProps<T extends LineItemsEditorBaseLine> = {
  lineItems: T[];
  onLineItemsChange: (lines: T[]) => void;
  itemSource: LineItemsEditorItemSource;
  /** Required when itemSource is 'site'. */
  siteOptions?: LineItemsEditorSiteOption[];
  /** Required when itemSource is 'product'. */
  products?: LineItemsEditorProductOption[];
  clientSelected?: boolean;
  vatRate: number;
  whtRate: number;
  taxBasis: SalesTaxBasis;
  disabled?: boolean;
  sectionTitle?: string;
  sectionDescription?: string;
  addLineLabel?: string;
  removeButtonLabel?: "Remove" | "Delete";
  showCurrencyInHeaders?: boolean;
  showInlineTotals?: boolean;
  createManualLine: (sortOrder: number) => T;
  createProductLine?: (sortOrder: number) => T;
  resolveLineDisplayTotal?: (line: T) => number;
};

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

const secondaryButtonClassName =
  "rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

const deleteButtonClassName =
  "rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50";

const compactDeleteButtonClassName =
  "rounded-md border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50";

export default function LineItemsEditor<T extends LineItemsEditorBaseLine>({
  lineItems,
  onLineItemsChange,
  itemSource,
  siteOptions = [],
  products = [],
  clientSelected = false,
  vatRate,
  whtRate,
  taxBasis,
  disabled = false,
  sectionTitle = "Line Items",
  sectionDescription,
  addLineLabel,
  removeButtonLabel = "Delete",
  showCurrencyInHeaders = false,
  showInlineTotals = false,
  createManualLine,
  createProductLine,
  resolveLineDisplayTotal,
}: LineItemsEditorProps<T>) {
  const [sitePicker, setSitePicker] = useState("");

  const resolveTotal =
    resolveLineDisplayTotal ??
    ((line: T) =>
      itemSource === "product"
        ? computeQuotationLineTotalCost(line, "product")
        : computeLineTotalCost(line));

  const totals = useMemo(
    () =>
      computeLineItemTotals(
        lineItems,
        vatRate,
        whtRate,
        taxBasis,
        itemSource === "product"
          ? (line) => computeQuotationLineTotalCost(line, "product")
          : computeLineTotalCost,
      ),
    [lineItems, vatRate, whtRate, taxBasis, itemSource],
  );

  const serviceCostHeader = showCurrencyInHeaders
    ? "Service Cost (GHS)"
    : "Service Cost";
  const materialCostHeader = showCurrencyInHeaders
    ? "Material Cost (GHS)"
    : "Material Cost";

  function updateLineItem(key: string, patch: Partial<T>) {
    onLineItemsChange(
      lineItems.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  }

  function updateProductLine(key: string, patch: Partial<T>) {
    onLineItemsChange(
      lineItems.map((line) => {
        if (line.key !== key) {
          return line;
        }

        const nextLine = { ...line, ...patch } as T;

        if (patch.product_id !== undefined) {
          const product = products.find((entry) => entry.id === patch.product_id);
          if (product) {
            nextLine.description = `${product.product_code} — ${product.product_name}`;
            if (!nextLine.unit_price) {
              nextLine.unit_price = toNumber(product.standard_selling_price);
            }
          } else if (!patch.product_id) {
            nextLine.description = "";
          }
        }

        return nextLine;
      }),
    );
  }

  function moveLineItem(key: string, direction: -1 | 1) {
    const index = lineItems.findIndex((line) => line.key === key);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= lineItems.length) {
      return;
    }

    const next = [...lineItems];
    const [item] = next.splice(index, 1);
    next.splice(targetIndex, 0, item);
    onLineItemsChange(reindexLineItems(next));
  }

  function removeLineItem(key: string) {
    onLineItemsChange(reindexLineItems(lineItems.filter((line) => line.key !== key)));
  }

  function addManualLine() {
    onLineItemsChange(reindexLineItems([...lineItems, createManualLine(lineItems.length)]));
  }

  function addProductLine() {
    if (!createProductLine) {
      return;
    }

    onLineItemsChange(
      reindexLineItems([...lineItems, createProductLine(lineItems.length)]),
    );
  }

  function addSiteLine(siteCode: string) {
    const site = siteOptions.find((entry) => entry.site_code === siteCode);
    if (!site) {
      return;
    }

    onLineItemsChange(
      reindexLineItems([
        ...lineItems,
        {
          ...createManualLine(lineItems.length),
          site_id: site.site_code,
          description: site.site_name,
        },
      ]),
    );
    setSitePicker("");
  }

  const manualAddLabel =
    addLineLabel ?? (itemSource === "none" ? "Add Line" : "Add Manual Line");

  const sitePickerPlaceholder = !clientSelected
    ? "Select customer first"
    : siteOptions.length === 0
      ? itemSource === "site"
        ? "Add site line…"
        : "No sites for this customer"
      : "Add site line…";

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h3 className="text-sm font-medium text-slate-700">{sectionTitle}</h3>
          {sectionDescription ? (
            <p className="mt-1 text-xs text-slate-500">{sectionDescription}</p>
          ) : null}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          {itemSource === "site" ? (
            <select
              value={sitePicker}
              disabled={disabled || !clientSelected || siteOptions.length === 0}
              onChange={(event) => {
                const value = event.target.value;
                if (value) {
                  addSiteLine(value);
                }
              }}
              className={inputClassName}
            >
              <option value="">{sitePickerPlaceholder}</option>
              {siteOptions.map((site) => (
                <option key={site.site_code} value={site.site_code}>
                  {site.site_name}
                </option>
              ))}
            </select>
          ) : null}
          {itemSource === "product" && createProductLine ? (
            <button
              type="button"
              disabled={disabled}
              onClick={addProductLine}
              className={secondaryButtonClassName}
            >
              Add Product Line
            </button>
          ) : null}
          <button
            type="button"
            disabled={disabled}
            onClick={addManualLine}
            className={secondaryButtonClassName}
          >
            {manualAddLabel}
          </button>
        </div>
      </div>

      {lineItems.length === 0 ? (
        <p className="text-sm text-slate-500">No line items yet.</p>
      ) : itemSource === "product" ? (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-3 py-2">Line</th>
                <th className="px-3 py-2">Product / Description</th>
                <th className="px-3 py-2">Quantity</th>
                <th className="px-3 py-2">Unit Price (GHS)</th>
                <th className="px-3 py-2">Discount</th>
                <th className="px-3 py-2">Taxed</th>
                <th className="px-3 py-2">Total</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {lineItems.map((line) => {
                const productPickerLine = isProductPickerLine(line);

                return (
                  <tr key={line.key}>
                    <td className="px-3 py-2 text-slate-600">
                      {productPickerLine ? "Product" : "Manual"}
                    </td>
                    <td className="px-3 py-2">
                      {productPickerLine ? (
                        <select
                          required
                          disabled={disabled}
                          value={line.product_id ?? ""}
                          onChange={(event) =>
                            updateProductLine(line.key, {
                              product_id: event.target.value,
                            } as Partial<T>)
                          }
                          className={inputClassName}
                        >
                          <option value="">Select product</option>
                          {products.map((product) => (
                            <option key={product.id} value={product.id}>
                              {product.product_code} — {product.product_name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          required
                          disabled={disabled}
                          value={line.description}
                          onChange={(event) =>
                            updateLineItem(line.key, {
                              description: event.target.value,
                            } as Partial<T>)
                          }
                          className={inputClassName}
                        />
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {productPickerLine ? (
                        <input
                          type="number"
                          min="0.0001"
                          step="0.0001"
                          disabled={disabled}
                          value={line.quantity ?? 1}
                          onChange={(event) =>
                            updateProductLine(line.key, {
                              quantity: Number(event.target.value) || 0,
                            } as Partial<T>)
                          }
                          className={inputClassName}
                        />
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {productPickerLine ? (
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          disabled={disabled}
                          value={line.unit_price ?? 0}
                          onChange={(event) =>
                            updateProductLine(line.key, {
                              unit_price: Number(event.target.value) || 0,
                            } as Partial<T>)
                          }
                          className={inputClassName}
                        />
                      ) : (
                        <div className="grid gap-2">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            disabled={disabled}
                            placeholder="Service cost"
                            value={line.labour_amount}
                            onChange={(event) =>
                              updateLineItem(line.key, {
                                labour_amount: Number(event.target.value) || 0,
                              } as Partial<T>)
                            }
                            className={inputClassName}
                          />
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            disabled={disabled}
                            placeholder="Material cost"
                            value={line.material_amount}
                            onChange={(event) =>
                              updateLineItem(line.key, {
                                material_amount: Number(event.target.value) || 0,
                              } as Partial<T>)
                            }
                            className={inputClassName}
                          />
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        disabled={disabled}
                        value={line.discount_amount}
                        onChange={(event) =>
                          (productPickerLine ? updateProductLine : updateLineItem)(line.key, {
                            discount_amount: Number(event.target.value) || 0,
                          } as Partial<T>)
                        }
                        className={inputClassName}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        disabled={disabled}
                        checked={line.taxed}
                        onChange={(event) =>
                          (productPickerLine ? updateProductLine : updateLineItem)(line.key, {
                            taxed: event.target.checked,
                          } as Partial<T>)
                        }
                        className="h-4 w-4 rounded border-slate-300 text-[#0f2744]"
                      />
                    </td>
                    <td className="px-3 py-2 font-medium text-[#0f2744]">
                      {formatInvoiceMoney(resolveTotal(line))}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => moveLineItem(line.key, -1)}
                          className={secondaryButtonClassName}
                        >
                          Up
                        </button>
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => moveLineItem(line.key, 1)}
                          className={secondaryButtonClassName}
                        >
                          Down
                        </button>
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => removeLineItem(line.key)}
                          className={deleteButtonClassName}
                        >
                          {removeButtonLabel}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2">{serviceCostHeader}</th>
                <th className="px-3 py-2">{materialCostHeader}</th>
                <th className="px-3 py-2">Discount</th>
                <th className="px-3 py-2">Taxed</th>
                <th className="px-3 py-2">Total</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {lineItems.map((line) => (
                <tr key={line.key}>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      required
                      disabled={disabled}
                      value={line.description}
                      onChange={(event) =>
                        updateLineItem(line.key, {
                          description: event.target.value,
                        } as Partial<T>)
                      }
                      className={inputClassName}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      disabled={disabled}
                      value={line.category_label ?? ""}
                      onChange={(event) =>
                        updateLineItem(line.key, {
                          category_label: event.target.value,
                        } as Partial<T>)
                      }
                      className={inputClassName}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      disabled={disabled}
                      value={line.labour_amount}
                      onChange={(event) =>
                        updateLineItem(line.key, {
                          labour_amount: Number(event.target.value) || 0,
                        } as Partial<T>)
                      }
                      className={inputClassName}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      disabled={disabled}
                      value={line.material_amount}
                      onChange={(event) =>
                        updateLineItem(line.key, {
                          material_amount: Number(event.target.value) || 0,
                        } as Partial<T>)
                      }
                      className={inputClassName}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      disabled={disabled}
                      value={line.discount_amount}
                      onChange={(event) =>
                        updateLineItem(line.key, {
                          discount_amount: Number(event.target.value) || 0,
                        } as Partial<T>)
                      }
                      className={inputClassName}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      disabled={disabled}
                      checked={line.taxed ?? true}
                      onChange={(event) =>
                        updateLineItem(line.key, {
                          taxed: event.target.checked,
                        } as Partial<T>)
                      }
                      className="h-4 w-4 rounded border-slate-300 text-[#0f2744]"
                    />
                  </td>
                  <td
                    className={`px-3 py-2 ${removeButtonLabel === "Delete" ? "font-medium text-[#0f2744]" : ""}`}
                  >
                    {formatInvoiceMoney(resolveTotal(line))}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => moveLineItem(line.key, -1)}
                        className={secondaryButtonClassName}
                      >
                        Up
                      </button>
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => moveLineItem(line.key, 1)}
                        className={secondaryButtonClassName}
                      >
                        Down
                      </button>
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => removeLineItem(line.key)}
                        className={
                          removeButtonLabel === "Remove"
                            ? compactDeleteButtonClassName
                            : deleteButtonClassName
                        }
                      >
                        {removeButtonLabel}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showInlineTotals ? (
        <div className="grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm md:grid-cols-2">
          <p>Subtotal: {formatInvoiceMoney(totals.subtotal)}</p>
          <p>Tax Due: {formatInvoiceMoney(totals.tax_due)}</p>
          <p>WHT: {formatInvoiceMoney(totals.wht_amount)}</p>
          <p className="font-semibold text-[#0f2744]">
            Total: {formatInvoiceMoney(totals.total_amount_due)}
          </p>
        </div>
      ) : null}
    </section>
  );
}

export { reindexLineItems } from "@/utils/line-items-editor-utils";
export { computeLineItemTotals } from "@/utils/line-items-totals";
