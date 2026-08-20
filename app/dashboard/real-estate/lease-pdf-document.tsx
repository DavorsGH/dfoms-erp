import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import {
  DEFAULT_LEASE_NOTICE_PERIOD_LABEL,
  composePropertyDescriptionLabel,
  computeDepositMonthsRent,
  formatAgreementDateIntro,
} from "./leases-utils";
import RealEstatePdfSignatureBlock, {
  type RealEstatePdfSignatureBlockProps,
} from "./real-estate-pdf-signature-block";

export {
  DEFAULT_LEASE_NOTICE_PERIOD_LABEL,
  DEFAULT_TERMINATION_NOTICE_MONTHS,
  computeLeaseTermMonths,
  formatTerminationNoticeLabel,
  suggestAdvanceRentAmountGhs,
} from "./leases-utils";

/**
 * Default Ghanaian residential tenancy PDF.
 * Used when leases.lease_document_url is empty (custom upload preferred when set).
 *
 * Per-lease columns:
 * - advanceAmountGhs ← leases.advance_rent_amount_ghs
 * - noticePeriodLabel ← leases.termination_notice_months (formatted)
 */
export type LeasePdfDocumentProps = {
  agreementDate: string;
  landlordName: string;
  landlordAddress: string;
  landlordPhone: string;
  lesseeName: string;
  lesseeEmail: string | null;
  lesseePhone: string;
  propertyAddress: string;
  /** Street/locality only; falls back to propertyAddress when omitted. */
  propertyStreetAddress?: string;
  propertyName?: string;
  unitNumber?: string;
  locationLabel: string;
  rentAmountGhs: number;
  termMonths: number;
  startDate: string;
  endDate: string;
  /** From leases.advance_rent_amount_ghs */
  advanceAmountGhs: number;
  depositAmountGhs: number | null;
  /** Display string e.g. "3 months" from leases.termination_notice_months */
  noticePeriodLabel: string;
} & RealEstatePdfSignatureBlockProps;

const JOINT_INSPECTION_SHEET = [
  {
    room: "LIVING ROOM/DINING",
    items: [
      "Wall/Doors",
      "Lights/Power points",
      "Floors/Fl. Tiles",
      "Windows",
      "Ceiling Fans",
    ],
  },
  {
    room: "KITCHEN",
    items: [
      "Wall/Doors",
      "Lights/Power points",
      "Floors/Fl. Tiles",
      "Windows",
      "Ceiling Fan",
    ],
  },
  {
    room: "BATHROOMS",
    items: [
      "Wall/Doors",
      "Lights/Power points",
      "Shower",
      "WC",
      "Wash basin",
      "Mirror",
      "Windows",
      "Floors/Fl. Tiles",
    ],
  },
  {
    room: "BEDROOMS",
    items: [
      "Wall/Doors",
      "Windows",
      "Lights/Power points",
      "Floors/Fl.Tiles",
      "Ceiling Fans",
    ],
  },
  {
    room: "COMPOUND",
    items: ["Water Pump", "Water Tank"],
  },
] as const;

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 48,
    paddingHorizontal: 44,
    fontSize: 10,
    lineHeight: 1.45,
    color: "#111827",
    fontFamily: "Times-Roman",
  },
  title: {
    fontSize: 14,
    fontFamily: "Times-Bold",
    textAlign: "center",
    marginBottom: 14,
    letterSpacing: 0.6,
  },
  para: {
    marginBottom: 8,
    textAlign: "justify",
  },
  clause: {
    marginBottom: 7,
    textAlign: "justify",
  },
  sectionHead: {
    marginTop: 10,
    marginBottom: 8,
    fontFamily: "Times-Bold",
  },
  sheetTitle: {
    fontSize: 12,
    fontFamily: "Times-Bold",
    textAlign: "center",
    marginBottom: 12,
    marginTop: 4,
  },
  sheetRow: {
    marginBottom: 4,
  },
  sheetTableHead: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#111827",
    paddingBottom: 4,
    marginTop: 10,
    marginBottom: 4,
    fontFamily: "Times-Bold",
    fontSize: 9,
  },
  sheetTableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#cbd5e1",
    paddingVertical: 3,
    minHeight: 16,
  },
  sheetColItem: {
    width: "40%",
    paddingRight: 6,
  },
  sheetColLandlord: {
    width: "20%",
    paddingRight: 4,
  },
  sheetColTenant: {
    width: "20%",
    paddingRight: 4,
  },
  sheetColDamage: {
    width: "20%",
  },
  sheetRoom: {
    fontFamily: "Times-Bold",
    marginTop: 8,
    marginBottom: 2,
  },
});

function formatMoneyGhC(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) {
    return "—";
  }
  return Number(value).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatLongDate(value: string): string {
  const normalized = value.includes("T") ? value : `${value}T00:00:00`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return value || "—";
  }
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function display(value: string | null | undefined, fallback = "—"): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

function formatLeaseTermLabel(termMonths: number): string {
  if (!Number.isFinite(termMonths) || termMonths < 1) {
    return "—";
  }
  const whole = Math.trunc(termMonths);
  return whole === 1 ? "1 month" : `${whole} months`;
}

function formatDepositMonthsLabel(
  depositAmountGhs: number | null,
  rentAmountGhs: number,
): string {
  const months = computeDepositMonthsRent(depositAmountGhs, rentAmountGhs);
  if (months == null) {
    return "—";
  }
  return months === 1 ? "1" : String(months);
}

function JointInspectionTableHead() {
  return (
    <View style={styles.sheetTableHead}>
      <Text style={styles.sheetColItem}>ROOM AND ITEM</Text>
      <Text style={styles.sheetColLandlord}>LANDLORD</Text>
      <Text style={styles.sheetColTenant}>TENANT</Text>
      <Text style={styles.sheetColDamage}>DAMAGE-DEFECTS</Text>
    </View>
  );
}

function JointInspectionItemRow({ item }: { item: string }) {
  return (
    <View style={styles.sheetTableRow}>
      <Text style={styles.sheetColItem}>{item}</Text>
      <Text style={styles.sheetColLandlord}> </Text>
      <Text style={styles.sheetColTenant}> </Text>
      <Text style={styles.sheetColDamage}> </Text>
    </View>
  );
}

export default function LeasePdfDocument(props: LeasePdfDocumentProps) {
  const agreementDateIntro = formatAgreementDateIntro(props.agreementDate);
  const startDate = formatLongDate(props.startDate);
  const endDate = formatLongDate(props.endDate);
  const landlordName = display(props.landlordName);
  const landlordAddress = display(props.landlordAddress);
  const landlordPhone = display(props.landlordPhone);
  const tenantName = display(props.lesseeName);
  const tenantEmail = display(props.lesseeEmail);
  const tenantPhone = display(props.lesseePhone);
  const propertyDescriptionLabel =
    props.propertyName != null || props.unitNumber != null
      ? composePropertyDescriptionLabel(
          props.propertyName ?? "—",
          props.unitNumber ?? "—",
        )
      : display(props.propertyAddress);
  const propertyStreetAddress = display(
    props.propertyStreetAddress ?? props.propertyAddress,
  );
  const locationLabel = display(props.locationLabel);
  const rent = formatMoneyGhC(props.rentAmountGhs);
  const advance = formatMoneyGhC(props.advanceAmountGhs);
  const deposit = formatMoneyGhC(props.depositAmountGhs);
  const leaseTerm = formatLeaseTermLabel(props.termMonths);
  const depositMonths = formatDepositMonthsLabel(
    props.depositAmountGhs,
    props.rentAmountGhs,
  );
  const notice = display(
    props.noticePeriodLabel,
    DEFAULT_LEASE_NOTICE_PERIOD_LABEL,
  );

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>RESIDENTIAL TENANCY AGREEMENT</Text>

        <Text style={styles.para}>
          Agreement made {agreementDateIntro}, between {landlordName} of{" "}
          {landlordAddress}, Tel no. {landlordPhone} (hereinafter called the
          &quot;LANDLORD&quot;), of the one part, AND {tenantName}, email:{" "}
          {tenantEmail}, Tel no. {tenantPhone} (hereinafter called the
          &quot;TENANT&quot;) of the other part.
        </Text>

        <Text style={styles.para}>
          The expressions &quot;LANDLORD&quot; and &quot;TENANT&quot; shall mean
          and include their legal heirs, successors, assigns and
          representatives.
        </Text>

        <Text style={styles.para}>
          This Agreement imposes duties on, and gives entitlements to, the
          Landlord and the Tenant that are taken to be terms of this agreement.
          The Landlord and the Tenant may agree on other terms of this agreement
          (special terms).
        </Text>

        <Text style={styles.para}>
          Any change or addition to this tenancy agreement must be agreed to in
          writing and initialed by both the Landlord and the Tenant.
        </Text>

        <Text style={styles.para}>
          The Landlord must give the Tenant a copy of this agreement promptly
          and in any event within 21 days of entering into the agreement.
        </Text>

        <Text style={styles.sectionHead}>WHEREAS:</Text>

        <Text style={styles.para}>
          The Landlord is the owner and in possession of the property known as{" "}
          {propertyDescriptionLabel} situated at {propertyStreetAddress} and
          has agreed to let out the said residential unit (in its present
          condition) to the Tenant at a monthly rental of GH¢ {rent}, excluding
          utility bills and estate management fees unless otherwise stated.
        </Text>

        <Text style={styles.sectionHead}>
          NOW THIS RENT AGREEMENT WITNESSETH AS UNDER:
        </Text>

        <Text style={styles.clause}>
          1. That this Lease is granted for a period of {leaseTerm} only,
          commencing from {startDate} and ending {endDate}.
        </Text>
        <Text style={styles.clause}>
          2. At the end of this fixed length of time, the Landlord and Tenant
          may agree to enter into a new tenancy agreement, else the tenancy
          ends and the Tenant must move out of the residential unit on or before
          the last day of the tenancy.
        </Text>
        <Text style={styles.clause}>
          3. That an advance of GH¢ {advance} covering the rental period shall be
          paid to the Landlord on or before the first day of the rental period.
          Additionally, the Tenant shall pay a security deposit of GH¢ {deposit}{" "}
          (covering {depositMonths} months&apos; rent), to be retained for the
          purpose of covering any likely damages after the end of the tenancy.
          The Landlord shall return the security deposit (without interest) where
          there are no damages.
        </Text>
        <Text style={styles.clause}>
          4. That this Agreement may be terminated before the expiry of the
          tenancy period by either party serving {notice} prior written notice of
          such intention.
        </Text>
        <Text style={styles.clause}>
          5. That the property shall be used and occupied by the Tenant
          exclusively as a private single-family residence. Neither the property
          nor any part of it or its yard shall be used at any time during the
          term of this Lease for the purpose of carrying on any business,
          profession, or trade of any kind, or for any purpose other than as a
          private single-family residence.
        </Text>
        <Text style={styles.clause}>
          6. That the Tenant agrees that they have examined the property,
          including the grounds and all buildings and improvements, and that
          they are, at the time of this Lease, in good order, good repair, safe,
          clean, and tenantable condition.
        </Text>
        <Text style={styles.clause}>
          7. Landlord and Tenant agree that the Joint Inspection Sheet attached
          hereto reflects the condition of the property at the commencement of
          the Tenant&apos;s occupancy.
        </Text>
        <Text style={styles.clause}>
          8. That if the property, or any part of it, shall be partially damaged
          by fire or other casualty not due to the Tenant&apos;s negligence or
          willful act, or that of the Tenant&apos;s family, agent, or visitor,
          there shall be an abatement of rent corresponding with the time during
          which, and the extent to which, the property is not tenantable. If the
          Landlord is not able to rebuild or repair, the term of this Lease
          shall end and the rent shall be prorated up to the time of the damage.
        </Text>
        <Text style={styles.clause}>
          9. That the Tenant shall abide by all the bye-laws, rules and
          regulations of the local authorities, including estate management, in
          respect of the demised premises, and shall not carry out any illegal
          activities on the said demised premises.
        </Text>
        <Text style={styles.clause}>
          10. That the Tenant shall pay the utility bills (security, estate
          management, electricity and water bills) as per the consumption of the
          meter during the period of this agreement. The Tenant shall not default
          on any obligation to a utility provider for utility services at the
          property.
        </Text>
        <Text style={styles.clause}>
          11. That the Tenant shall not be entitled to make structural
          alterations to the rented premises, except for the installation of
          temporary decoration, wooden partitions/cabins, air conditioners,
          etc., without the prior consent of the Landlord.
        </Text>
        <Text style={styles.clause}>
          12. That the Tenant can neither make additions or alterations to the
          said premises without the written consent of the owner, nor sublet part
          or the entire premises to any other person(s), firm(s), or
          company(ies).
        </Text>
        <Text style={styles.clause}>
          13. That the Tenant shall not keep or have on or around the property
          any article or thing of a dangerous, inflammable, or explosive
          character that might unreasonably increase the danger of fire on or
          around the property or that might be considered hazardous.
        </Text>
        <Text style={styles.clause}>
          14. That the Tenant shall keep the grounds of the property clean and
          neat, free of weeds and garbage, and shall ensure the compound is
          always kept clean.
        </Text>
        <Text style={styles.clause}>
          15. That the Tenant shall permit the Landlord or their authorized
          agent to enter the said tenanted premises for inspection, general
          checking, or to carry out repair work, at any reasonable time upon
          reasonable notice.
        </Text>
        <Text style={styles.clause}>
          16. That the Tenant shall keep the said premises in a clean and
          hygienic condition and shall not do or cause to be done any act which
          may be a nuisance to other residents.
        </Text>
        <Text style={styles.clause}>
          17. That the Tenant shall carry out all day-to-day minor repairs at
          the Tenant&apos;s own cost.
        </Text>
        <Text style={styles.clause}>
          18. That should the Tenant breach any of the stipulations contained
          herein, the tenancy will be terminated before the tenancy agreement
          ends, and any balance owed will be paid to the Tenant, but only after
          the required notice has been served.
        </Text>
        <Text style={styles.clause}>
          19. That at the expiration of the Lease, the Tenant shall quit and
          surrender the property in as good a condition as it was at the
          commencement of this Lease, reasonable wear and tear exempted.
        </Text>
        <Text style={styles.clause}>
          20. That if at any time during the term of this Lease the Tenant
          abandons the property or any of the Tenant&apos;s personal property
          in or about the property, the Landlord shall have the right, at their
          option, to enter the property by any means without liability to the
          Tenant for damages and may re-let the property for the whole or any
          part of the then-unexpired term, and may receive and collect all rent
          payable by virtue of such re-letting. The Landlord may also hold the
          Tenant liable for any difference between the rent that would have been
          payable under this Lease during the balance of the unexpired term and
          the net rent realized by means of such re-letting, and may dispose of
          any abandoned personal property as the Landlord deems appropriate,
          without liability to the Tenant. The property shall be presumed
          abandoned if the Tenant removes substantially all of their furnishings,
          if the property is unoccupied for a period of one month, or if it
          would otherwise be reasonable for the Landlord to presume abandonment
          under the circumstances.
        </Text>
        <Text style={styles.clause}>
          21. That the Tenant acknowledges that the Landlord does not provide a
          security alarm system or any security for the property or for the
          Tenant, and that any such alarm system or security service, if
          provided, is not represented or warranted to be complete in all
          respects or to protect the Tenant from all harm. The Tenant hereby
          releases the Landlord from any loss, suit, claim, charge, damage, or
          injury resulting from lack of security or failure of security.
        </Text>
        <Text style={styles.clause}>
          22. That if any part or parts of this Lease shall be held
          unenforceable for any reason, the remainder of this Agreement shall
          continue in full force and effect.
        </Text>
        <Text style={styles.clause}>
          23. That this Lease shall constitute the entire agreement between the
          parties. Any prior understanding or representation of any kind
          preceding the date of this Lease is hereby superseded. This Lease may
          be modified only by a written document signed by both the Landlord and
          the Tenant.
        </Text>
        <Text style={styles.clause}>
          24. That any notice required or otherwise given pursuant to this Lease
          shall be in writing; hand delivered, if to the Tenant, at the property,
          and/or by electronic mail; and if to the Landlord, at the address for
          payment of rent or as otherwise advised by the Landlord.
        </Text>
        <Text style={styles.clause}>
          25. That both parties have read over and understood all the contents of
          this agreement and have signed the same without any force or pressure
          from any side.
        </Text>

        <Text style={styles.para}>
          Signed and executed at {locationLabel} on this the date first above
          mentioned, in the presence of the following witnesses.
        </Text>

        <RealEstatePdfSignatureBlock
          authorizedByName={props.authorizedByName}
          authorizedByTitle={props.authorizedByTitle}
          signatureImageUrl={props.signatureImageUrl}
        />
      </Page>

      <Page size="A4" style={styles.page}>
        <Text style={styles.sheetTitle}>JOINT INSPECTION SHEET</Text>

        <Text style={styles.sheetRow}>LANDLORD: {landlordName}</Text>
        <Text style={styles.sheetRow}>TENANT: {tenantName}</Text>
        <Text style={styles.sheetRow}>DATE OF POSSESSION: {startDate}</Text>

        <Text style={[styles.sheetRow, { fontFamily: "Times-Bold", marginTop: 8 }]}>
          CONDITION ACCEPTABLE?
        </Text>

        <JointInspectionTableHead />

        {JOINT_INSPECTION_SHEET.map((section) => (
          <View key={section.room}>
            <Text style={styles.sheetRoom}>{section.room}</Text>
            {section.items.map((item) => (
              <JointInspectionItemRow key={`${section.room}-${item}`} item={item} />
            ))}
          </View>
        ))}
      </Page>
    </Document>
  );
}
