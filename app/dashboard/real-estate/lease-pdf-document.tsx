import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { DEFAULT_LEASE_NOTICE_PERIOD_LABEL } from "./leases-utils";

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
};

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
  centered: {
    marginBottom: 8,
    textAlign: "center",
    fontFamily: "Times-Bold",
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
  witnessBlock: {
    marginTop: 12,
    marginBottom: 6,
  },
  signatureLine: {
    marginTop: 10,
    marginBottom: 4,
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
    fontFamily: "Times-Bold",
    marginTop: 10,
    marginBottom: 6,
  },
  sheetRoom: {
    fontFamily: "Times-Bold",
    marginTop: 8,
    marginBottom: 2,
  },
  sheetItems: {
    marginBottom: 2,
    paddingLeft: 8,
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
  const date = new Date(value);
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

export default function LeasePdfDocument(props: LeasePdfDocumentProps) {
  const agreementDate = formatLongDate(props.agreementDate);
  const startDate = formatLongDate(props.startDate);
  const endDate = formatLongDate(props.endDate);
  const landlordName = display(props.landlordName);
  const landlordAddress = display(props.landlordAddress);
  const landlordPhone = display(props.landlordPhone);
  const tenantName = display(props.lesseeName);
  const tenantEmail = display(props.lesseeEmail);
  const tenantPhone = display(props.lesseePhone);
  const propertyAddress = display(props.propertyAddress);
  const locationLabel = display(props.locationLabel);
  const rent = formatMoneyGhC(props.rentAmountGhs);
  const advance = formatMoneyGhC(props.advanceAmountGhs);
  const deposit = formatMoneyGhC(props.depositAmountGhs);
  const termMonths = props.termMonths > 0 ? String(props.termMonths) : "—";
  const notice = display(props.noticePeriodLabel, DEFAULT_LEASE_NOTICE_PERIOD_LABEL);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>RESIDENTIAL TENANCY AGREEMENT</Text>

        <Text style={styles.para}>
          Agreement made this day: {agreementDate}, between {landlordName} of{" "}
          {landlordAddress}, Tel no. {landlordPhone} herein after called the
          &quot;LANDLORD&quot;, of the one part.
        </Text>

        <Text style={styles.centered}>AND</Text>

        <Text style={styles.para}>
          {tenantName}, email: {tenantEmail}, Tel no. {tenantPhone}; herein after
          called the &quot;TENANT&quot; of the other part.
        </Text>

        <Text style={styles.para}>
          That expression &quot;LANDLORD&quot; and &quot;TENANT&quot; shall mean
          and include their legal heirs successors, assigns and representatives.
        </Text>

        <Text style={styles.para}>
          This AGREEMENT imposes duties on, and gives entitlements to, the
          LANDLORD and the TENANT that are taken to be terms of this agreement.
          The Landlord and the Tenant may agree on other terms of this agreement
          (special terms).
        </Text>

        <Text style={styles.para}>
          Any change or addition to this tenancy agreement must be agreed to in
          writing and initialed by both the landlord and the tenant.
        </Text>

        <Text style={styles.para}>
          The Landlord must give the Tenant a copy of this agreement promptly and
          in any event within 21 days of entering into the agreement.
        </Text>

        <Text style={styles.sectionHead}>WHEREAS:-</Text>

        <Text style={styles.para}>
          The Landlord is the owner and in possession of {propertyAddress} and
          has agreed to let out the said unit (in its present condition) to the
          Tenant at a monthly rental of GH¢{rent} excluding utility bills and
          estates management fees.
        </Text>

        <Text style={styles.sectionHead}>
          NOW THIS RENT AGREEMENT WITNESSETH AS UNDER:-
        </Text>

        <Text style={styles.clause}>
          1. That this Lease is granted for a period of {termMonths} months only
          commencing from {startDate} and ending {endDate}.
        </Text>
        <Text style={styles.clause}>
          2. At the end of this fixed length of time the Landlord and Tenant may
          agree to enter into a new tenancy agreement else the tenancy ends and
          the Tenant must move out of the residential unit. The Tenant must move
          out on or before the last day of the tenancy.
        </Text>
        <Text style={styles.clause}>
          3. That an advance of GH¢{advance} covering the rental period shall be
          paid to the Landlord on or before the first day of the rental period.
          Additionally, the Tenant shall pay a security deposit of GH¢{deposit},
          will be retained for purposes of maintaining any likely damages after
          the end of tenancy. However, the Landlord shall return the security
          deposit (without interest) where there are no damages.
        </Text>
        <Text style={styles.clause}>
          4. That this Agreement may be terminated before the expiry of this
          tenancy period by serving {notice} prior notice by either party for
          this intention.
        </Text>
        <Text style={styles.clause}>
          5. That the House shall be used and occupied by Tenant exclusively as a
          private single-family residence. Neither the House nor any part of the
          House or yard shall be used at any time during the term of this Lease
          for the purpose of carrying on any business, profession, or trade of
          any kind, or for any purpose other than as a private single-family
          residence.
        </Text>
        <Text style={styles.clause}>
          6. That the Tenant agrees that he has examined the House, including the
          grounds and all buildings and improvements, and that they are, at the
          time of this Lease, in good order, good repair, safe, clean, and
          tenantable condition.
        </Text>
        <Text style={styles.clause}>
          7. Landlord and Tenant agree that a copy of the &quot;Joint Inspection
          Sheet&quot; attached hereto reflects the condition of the House at the
          commencement of Tenant&apos;s occupancy.
        </Text>
        <Text style={styles.clause}>
          8. That if the House, or any part of the House, shall be partially
          damaged by fire or other casualty not due to Tenant&apos;s negligence
          or willful act, or that of Tenant&apos;s family, agent, or visitor,
          there shall be an abatement of rent corresponding with the time during
          which, and the extent to which, the House is not tenantable. If the
          Landlord is not able to rebuild or repair, the term of this Lease shall
          end and the rent shall be prorated up to the time of the damage.
        </Text>
        <Text style={styles.clause}>
          9. That the Tenant shall abide by all the bye-laws, rules and
          regulation of the local authorities including estate management in
          respect of the demised premises and shall not do any illegal activities
          in the said demised premises.
        </Text>
        <Text style={styles.clause}>
          10. That the Tenant shall pay the utilities bills (security, estate
          management, Electricity &amp; Water bills) as per the consumption of
          the meter during the period of this agreement. Tenant shall not default
          on any obligation to a utility provider for utility services at the
          House.
        </Text>
        <Text style={styles.clause}>
          11. That the Tenant shall not be entitled to make structure in the
          rented premises except the installation of temporary decoration, wooden
          partition/cabin, air conditioners etc. without the prior consent of the
          Landlord.
        </Text>
        <Text style={styles.clause}>
          12. That the Tenant can neither make addition/alteration in the said
          premises without the written consent of the owner, nor the lessee can
          sublet part or entire premises to any person(s)/firm(s)/company(s).
        </Text>
        <Text style={styles.clause}>
          13. That the Tenant shall not keep or have on or around the House any
          article or thing of a dangerous, inflammable, or explosive character
          that might unreasonably increase the danger of fire on or around the
          House or that might be considered hazardous.
        </Text>
        <Text style={styles.clause}>
          14. The Tenant shall keep the ground of the property clean and neat,
          free of weeds and garbage and shall make sure the compound is always
          kept clean.
        </Text>
        <Text style={styles.clause}>
          15. That the Tenant shall permit the Landlord or his authorized agent
          to enter into the said tenanted premises for inspection/general
          checking or to carry out the repair work, at any reasonable time.
        </Text>
        <Text style={styles.clause}>
          16. That the Tenant shall keep the said premises in clean &amp;
          hygienic condition and shall not do or causes to be done any act which
          may be a nuisance to other residents within the estates.
        </Text>
        <Text style={styles.clause}>
          17. That the Tenant shall carry on all day-to-day minor repairs at the
          Tenant&apos;s own cost.
        </Text>
        <Text style={styles.clause}>
          18. That should the Tenant breach any of the stipulation on his part
          contained herein, tenancy agreement, his tenancy will be terminated
          before his tenancy agreement ends and his or her balance will be paid
          to him or her (Tenant), but after serving the required notice.
        </Text>
        <Text style={styles.clause}>
          19. That at the expiration of the Lease, Tenant shall quit and
          surrender the House in as good a condition as it was at the
          commencement of this Lease, reasonable wear and tear exempted.
        </Text>
        <Text style={styles.clause}>
          20. That if at any time during the term of this Lease, Tenant abandons
          the House or any of Tenant&apos;s personal property in or about the
          House, the Landlord shall have the following rights: the Landlord may,
          at their option, enter the House by any means without liability to the
          Tenant for damages and may re-let the House, for the whole or any part
          of the then unexpired term, and may receive and collect all rent
          payable by virtue of such re-letting; Also, at the Landlord&apos;s
          option, the Landlord may hold the Tenant liable for any difference
          between the rent that would have been payable under this Lease during
          the balance of the unexpired term, if this Lease had continued in
          force, and the net rent for such period realized by the Landlord by
          means of such reletting. The Landlord may also dispose of any of the
          Tenant&apos;s abandoned personal property as the Landlord deems
          appropriate, without liability to the Tenant. The Landlord is entitled
          to presume that the Tenant has abandoned the House if the Tenant
          removes substantially all of the Tenant&apos;s furnishings from the
          House, if the House is unoccupied for a period of one month, or if it
          would otherwise be reasonable for the Landlord to presume under the
          circumstances that the Tenant has abandoned the House.
        </Text>
        <Text style={styles.clause}>
          21. That the Tenant acknowledges that the Landlord does not provide a
          security alarm system or any security for the House or for the Tenant
          and that any such alarm system or security service, if provided, is not
          represented or warranted to be complete in all respects or to protect
          the Tenant from all harm. The Tenant hereby releases the Landlord from
          any loss, suit, claim, charge, damage or injury resulting from lack of
          security or failure of security.
        </Text>
        <Text style={styles.clause}>
          22. That if any part or parts of this Lease shall be held unenforceable
          for any reason, the remainder of this Agreement shall continue in full
          force and effect.
        </Text>
        <Text style={styles.clause}>
          23. That this Lease shall constitute the entire agreement between the
          parties. Any prior understanding or representation of any kind
          preceding the date of this Lease is hereby superseded. This Lease may
          be modified only by a written document, signed by both the Landlord and
          the Tenant.
        </Text>
        <Text style={styles.clause}>
          24. That any notice required or otherwise given pursuant to this Lease
          shall be in writing; hand delivered, if to the Tenant, at the House,
          and/or by electronic email and if to the Landlord, at the address for
          payment of rent or as will be advised by the Landlord.
        </Text>
        <Text style={styles.clause}>
          25. That both the parties have read over and understood all the
          contents of this agreement and have signed the same without any force
          or pressure from any side.
        </Text>

        <Text style={styles.para}>
          In WITNESS WHEREOF the Landlord and the Tenant have hereunto subscribed
          their hand at {locationLabel} on this the {agreementDate} year first
          above mentioned in presence of the following witnesses.
        </Text>

        <View style={styles.witnessBlock}>
          <Text style={styles.sectionHead}>Signed And Sealed By:</Text>
          <Text style={styles.signatureLine}>
            LANDLORD: {landlordName} ………..……………………………
          </Text>
          <Text style={styles.signatureLine}>
            IN PRESENCE OF: ………………………………………………………..
          </Text>
          <Text style={styles.sheetRow}>WITNESS FOR LANDLORD</Text>

          <Text style={styles.signatureLine}>
            TENANT: {tenantName} ………..………………………………………….
          </Text>
          <Text style={styles.signatureLine}>
            IN PRESENCE OF: ………………………………………………………..
          </Text>
          <Text style={styles.sheetRow}>WITNESS FOR TENANT</Text>
        </View>
      </Page>

      <Page size="A4" style={styles.page}>
        <Text style={styles.sheetTitle}>JOINT INSPECTION SHEET</Text>

        <Text style={styles.sheetRow}>LANDLORD: {landlordName}</Text>
        <Text style={styles.sheetRow}>TENANT: {tenantName}</Text>
        <Text style={styles.sheetRow}>DATE OF POSSESSION: {startDate}</Text>

        <Text style={styles.sheetTableHead}>
          CONDITION ACCEPTABLE?{"\n"}
          ROOM AND ITEM / LANDLORD / TENANTS / DAMAGE-DEFECTS
        </Text>

        <Text style={styles.sheetRoom}>LIVING ROOM/DINING</Text>
        <Text style={styles.sheetItems}>
          Wall/Doors, Lights/Power points, Floors/Fl. Tiles, Windows, Ceiling
          Fans
        </Text>

        <Text style={styles.sheetRoom}>KITCHEN</Text>
        <Text style={styles.sheetItems}>
          Wall/Doors, Lights/Power points, Floors/Fl. Tiles, Windows, Ceiling Fan
        </Text>

        <Text style={styles.sheetRoom}>BATHROOMS</Text>
        <Text style={styles.sheetItems}>
          Wall/Doors, Lights/Power points, Shower, WC, Wash basin, Mirror,
          Windows, Floors/Fl. Tiles
        </Text>

        <Text style={styles.sheetRoom}>BEDROOMS</Text>
        <Text style={styles.sheetItems}>
          Wall/Doors, Windows, Lights/Power points, Floors/Fl.Tiles, Ceiling Fans
        </Text>

        <Text style={styles.sheetRoom}>COMPOUND</Text>
        <Text style={styles.sheetItems}>Water Pump, Water Tank</Text>

        <Text style={[styles.signatureLine, { marginTop: 24 }]}>
          Signed by Landlord: ……………………… Signed by Tenant: ……………………
        </Text>
      </Page>
    </Document>
  );
}
