export type FacilityManagerCapabilityFlags = {
  can_manage_maintenance: boolean;
  can_manage_complaints: boolean;
  can_manage_inspections: boolean;
  can_log_services: boolean;
  can_collect_rent: boolean;
  can_collect_charges: boolean;
};

export const DEFAULT_FACILITY_MANAGER_CAPABILITIES: FacilityManagerCapabilityFlags =
  {
    can_manage_maintenance: true,
    can_manage_complaints: true,
    can_manage_inspections: true,
    can_log_services: true,
    can_collect_rent: false,
    can_collect_charges: false,
  };

export const DAVORS_MANAGED_FM_COLLECTION_CAPABILITY_ERROR =
  "Rent and charge collection cannot be enabled for facility managers on Davors-managed landlord accounts. Davors staff record payments on your behalf.";

/** Block collect-rent/charges for davors_managed landlords (no landlord confirm path). */
export function rejectDavorsManagedFacilityManagerCollectionCapabilities(args: {
  landlordType: string | null;
  canCollectRent: boolean;
  canCollectCharges: boolean;
}): string | null {
  if (args.landlordType !== "davors_managed") {
    return null;
  }
  if (args.canCollectRent || args.canCollectCharges) {
    return DAVORS_MANAGED_FM_COLLECTION_CAPABILITY_ERROR;
  }
  return null;
}
