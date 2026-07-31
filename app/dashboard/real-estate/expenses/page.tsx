import { createAdminClient } from "@/utils/supabase/admin";
import { fetchLandlordListRows } from "@/utils/landlord-management";
import {
  fetchExpensePropertyOptionsForLandlord,
  fetchExpensesForProperty,
} from "@/utils/expense-management";
import { filterDavorsManagedLandlords } from "../landlords-utils";
import RealEstateShell from "../real-estate-shell";
import Expenses from "../expenses";

type ExpensesPageProps = {
  searchParams: Promise<{ landlord?: string; property?: string }>;
};

export default async function ExpensesPage({
  searchParams,
}: ExpensesPageProps) {
  const { landlord: landlordParam, property: propertyParam } =
    await searchParams;
  const requestedLandlordId = landlordParam?.trim() || null;
  const requestedPropertyId = propertyParam?.trim() || null;

  const admin = createAdminClient();
  const { rows: allLandlords, fetchError: landlordsError } =
    await fetchLandlordListRows(admin);
  const landlords = filterDavorsManagedLandlords(allLandlords);
  const selectedLandlordId =
    requestedLandlordId &&
    landlords.some((row) => row.tenantId === requestedLandlordId)
      ? requestedLandlordId
      : null;

  let properties = [] as Awaited<
    ReturnType<typeof fetchExpensePropertyOptionsForLandlord>
  >["properties"];
  let expenseRows = [] as Awaited<
    ReturnType<typeof fetchExpensesForProperty>
  >["rows"];
  let expensesError: string | null = null;

  let selectedPropertyId: string | null = null;

  if (selectedLandlordId) {
    const propertiesResult = await fetchExpensePropertyOptionsForLandlord(
      admin,
      selectedLandlordId,
    );
    properties = propertiesResult.properties;
    expensesError = propertiesResult.fetchError;

    selectedPropertyId =
      requestedPropertyId &&
      properties.some((row) => row.propertyId === requestedPropertyId)
        ? requestedPropertyId
        : null;

    if (selectedPropertyId && !expensesError) {
      const expensesResult = await fetchExpensesForProperty(
        admin,
        selectedLandlordId,
        selectedPropertyId,
      );
      expenseRows = expensesResult.rows;
      expensesError = expensesResult.fetchError;
    }
  }

  return (
    <RealEstateShell sectionTitle="Expenses">
      <Expenses
        landlords={landlords}
        selectedLandlordId={selectedLandlordId}
        properties={properties}
        selectedPropertyId={selectedPropertyId}
        initialRows={expenseRows}
        landlordsError={landlordsError}
        expensesError={expensesError}
      />
    </RealEstateShell>
  );
}
