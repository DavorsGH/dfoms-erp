export type InventoryItemBusinessUnitAction =

  | "purchase"

  | "purchase_order"

  | "sale"

  | "stock_adjustment"

  | "internal_use"

  | "production"

  | "return";



const ACTION_PHRASES: Record<InventoryItemBusinessUnitAction, string> = {

  purchase: "record this purchase",

  purchase_order: "add this item to the purchase order",

  sale: "record this sale",

  stock_adjustment: "post this stock adjustment",

  internal_use: "record this internal use",

  production: "record this production batch",

  return: "process this return",

};



export const INVENTORY_ACTION_ALERT_TITLE = "Could not complete action";



/** Normalize null, undefined, and blank strings to null for BU comparisons. */

export function normalizeInventoryBusinessUnitId(

  businessUnitId: string | null | undefined,

): string | null {

  if (businessUnitId == null) {

    return null;

  }

  const trimmed = String(businessUnitId).trim();

  return trimmed.length > 0 ? trimmed : null;

}



/**

 * Guard runs only when the tenant uses business units and both catalog and write

 * BU ids are non-null. Otherwise inventory writes proceed (legacy / single-unit tenants).

 */

export function shouldApplyInventoryItemBusinessUnitGuard(args: {

  tenantUsesBusinessUnits: boolean;

  catalogBusinessUnitId: string | null | undefined;

  writeBusinessUnitId: string | null | undefined;

}): boolean {

  if (!args.tenantUsesBusinessUnits) {

    return false;

  }

  const catalogBu = normalizeInventoryBusinessUnitId(args.catalogBusinessUnitId);

  const writeBu = normalizeInventoryBusinessUnitId(args.writeBusinessUnitId);

  return catalogBu !== null && writeBu !== null;

}



/** @deprecated Prefer shouldApplyInventoryItemBusinessUnitGuard + explicit equality. */

export function inventoryCatalogBusinessUnitIdsMatch(

  catalogBusinessUnitId: string | null | undefined,

  writeBusinessUnitId: string | null | undefined,

): boolean {

  const catalogBu = normalizeInventoryBusinessUnitId(catalogBusinessUnitId);

  const writeBu = normalizeInventoryBusinessUnitId(writeBusinessUnitId);

  if (catalogBu === null || writeBu === null) {

    return true;

  }

  return catalogBu === writeBu;

}



export function resolveInventoryItemBusinessUnitLabel(

  businessUnitId: string | null | undefined,

  units: { id: string; name: string }[],

): string {

  const normalized = normalizeInventoryBusinessUnitId(businessUnitId);

  if (!normalized) {

    return "your workspace default";

  }

  const match = units.find((unit) => unit.id === normalized);

  return match?.name?.trim() || "another business unit";

}



export function finishedProductBusinessUnitMismatchMessage(

  businessUnitName: string,

  action: InventoryItemBusinessUnitAction = "purchase",

): string {

  const phrase = ACTION_PHRASES[action];

  return `This product belongs to ${businessUnitName}. Switch the business unit in the header to ${phrase}.`;

}



export function rawMaterialBusinessUnitMismatchMessage(

  businessUnitName: string,

  action: InventoryItemBusinessUnitAction = "purchase_order",

): string {

  const phrase = ACTION_PHRASES[action];

  return `This raw material belongs to ${businessUnitName}. Switch the business unit in the header to ${phrase}.`;

}



export function evaluateFinishedProductWriteBusinessUnit(args: {

  tenantUsesBusinessUnits: boolean;

  productBusinessUnitId: string | null | undefined;

  writeBusinessUnitId: string | null | undefined;

  businessUnitLabel: string;

  action: InventoryItemBusinessUnitAction;

}):

  | { ok: true }

  | { ok: false; message: string } {

  if (

    !shouldApplyInventoryItemBusinessUnitGuard({

      tenantUsesBusinessUnits: args.tenantUsesBusinessUnits,

      catalogBusinessUnitId: args.productBusinessUnitId,

      writeBusinessUnitId: args.writeBusinessUnitId,

    })

  ) {

    return { ok: true };

  }



  const catalogBu = normalizeInventoryBusinessUnitId(args.productBusinessUnitId);

  const writeBu = normalizeInventoryBusinessUnitId(args.writeBusinessUnitId);



  if (catalogBu === writeBu) {

    return { ok: true };

  }



  return {

    ok: false,

    message: finishedProductBusinessUnitMismatchMessage(

      args.businessUnitLabel,

      args.action,

    ),

  };

}



export function evaluateRawMaterialWriteBusinessUnit(args: {

  tenantUsesBusinessUnits: boolean;

  materialBusinessUnitId: string | null | undefined;

  writeBusinessUnitId: string | null | undefined;

  businessUnitLabel: string;

  action: InventoryItemBusinessUnitAction;

}):

  | { ok: true }

  | { ok: false; message: string } {

  if (

    !shouldApplyInventoryItemBusinessUnitGuard({

      tenantUsesBusinessUnits: args.tenantUsesBusinessUnits,

      catalogBusinessUnitId: args.materialBusinessUnitId,

      writeBusinessUnitId: args.writeBusinessUnitId,

    })

  ) {

    return { ok: true };

  }



  const catalogBu = normalizeInventoryBusinessUnitId(args.materialBusinessUnitId);

  const writeBu = normalizeInventoryBusinessUnitId(args.writeBusinessUnitId);



  if (catalogBu === writeBu) {

    return { ok: true };

  }



  return {

    ok: false,

    message: rawMaterialBusinessUnitMismatchMessage(

      args.businessUnitLabel,

      args.action,

    ),

  };

}


