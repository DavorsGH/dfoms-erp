import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import { CLIENT_INVOICE_COLORS } from "@/app/dashboard/finance/client-invoices/client-invoice-display-utils";
import type { DutyRosterPdfPayload } from "./duty-roster-document-utils";

const C = CLIENT_INVOICE_COLORS;

const styles = StyleSheet.create({
  page: {
    padding: 36,
    fontSize: 10,
    color: C.textDark,
    fontFamily: "Helvetica",
  },
  header: {
    marginBottom: 18,
    borderBottomWidth: 1,
    borderBottomColor: "#cbd5e1",
    paddingBottom: 12,
    textAlign: "center",
  },
  companyName: {
    fontSize: 14,
    fontWeight: "bold",
    color: C.navy,
    marginBottom: 6,
  },
  logo: {
    width: 56,
    height: 56,
    objectFit: "contain",
    alignSelf: "center",
    marginBottom: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: "bold",
    color: C.navy,
    marginBottom: 8,
  },
  meta: {
    fontSize: 10,
    color: C.textMuted,
    marginBottom: 2,
  },
  table: {
    borderWidth: 1,
    borderColor: "#94a3b8",
    marginBottom: 18,
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#f1f5f9",
    borderBottomWidth: 1,
    borderBottomColor: "#94a3b8",
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#cbd5e1",
  },
  tableRowLast: {
    flexDirection: "row",
    backgroundColor: "#f8fafc",
  },
  cellFacility: {
    width: "18%",
    padding: 6,
    fontSize: 9,
  },
  cellShift: {
    width: "22%",
    padding: 6,
    fontSize: 8,
  },
  cellSupervisor: {
    width: "18%",
    padding: 6,
    fontSize: 8,
  },
  cellNumber: {
    width: "10%",
    padding: 6,
    fontSize: 9,
    textAlign: "right",
  },
  headerText: {
    fontWeight: "bold",
    color: C.navy,
  },
  subHeaderText: {
    fontSize: 7,
    color: C.textMuted,
    marginTop: 2,
  },
  footerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "#cbd5e1",
    paddingTop: 14,
    gap: 12,
  },
  footerCol: {
    width: "32%",
  },
  footerLabel: {
    fontSize: 9,
    color: C.textMuted,
    marginBottom: 8,
  },
  footerValue: {
    fontSize: 10,
    fontWeight: "bold",
    color: C.textDark,
    borderBottomWidth: 1,
    borderBottomColor: "#94a3b8",
    paddingBottom: 4,
    minHeight: 18,
  },
  signatureImage: {
    width: 120,
    height: 42,
    objectFit: "contain",
    marginBottom: 6,
  },
  approvedMeta: {
    fontSize: 9,
    color: C.textDark,
    marginTop: 4,
    fontWeight: "bold",
  },
  titleMeta: {
    fontSize: 9,
    color: C.textMuted,
    marginTop: 2,
  },
});

export default function DutyRosterPdfDocument({
  companyLegalName,
  companyLogoUrl = "",
  clientName,
  effectiveLabel,
  rotationLabel,
  morningTime,
  afternoonTime,
  supervisorTime,
  rows,
  totals,
  preparedBy,
  approvedByName,
  approvedByTitle,
  approvedAt,
  rosterDate,
  signatureImageUrl,
}: DutyRosterPdfPayload) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          {companyLogoUrl ? (
            // eslint-disable-next-line jsx-a11y/alt-text -- PDF Image has no alt prop
            <Image src={companyLogoUrl} style={styles.logo} />
          ) : null}
          <Text style={styles.companyName}>{companyLegalName}</Text>
          <Text style={styles.title}>Duty Roster</Text>
          <Text style={styles.meta}>{clientName}</Text>
          <Text style={styles.meta}>Effective: {effectiveLabel}</Text>
          <Text style={styles.meta}>{rotationLabel}</Text>
        </View>

        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <View style={styles.cellFacility}>
              <Text style={styles.headerText}>Facility</Text>
            </View>
            <View style={styles.cellShift}>
              <Text style={styles.headerText}>Morning Shift</Text>
              <Text style={styles.subHeaderText}>{morningTime}</Text>
            </View>
            <View style={styles.cellShift}>
              <Text style={styles.headerText}>Afternoon Shift</Text>
              <Text style={styles.subHeaderText}>{afternoonTime}</Text>
            </View>
            <View style={styles.cellSupervisor}>
              <Text style={styles.headerText}>Supervisor(s)</Text>
              <Text style={styles.subHeaderText}>{supervisorTime}</Text>
            </View>
            <View style={styles.cellNumber}>
              <Text style={styles.headerText}>Required</Text>
            </View>
            <View style={styles.cellNumber}>
              <Text style={styles.headerText}>Actual</Text>
            </View>
          </View>

          {rows.map((row) => (
            <View key={row.siteCode} style={styles.tableRow}>
              <View style={styles.cellFacility}>
                <Text>{row.facilityName}</Text>
              </View>
              <View style={styles.cellShift}>
                <Text>{row.morningShift}</Text>
              </View>
              <View style={styles.cellShift}>
                <Text>{row.afternoonShift}</Text>
              </View>
              <View style={styles.cellSupervisor}>
                <Text>{row.supervisors}</Text>
              </View>
              <View style={styles.cellNumber}>
                <Text>{row.requiredStaff}</Text>
              </View>
              <View style={styles.cellNumber}>
                <Text>{row.totalStaff}</Text>
              </View>
            </View>
          ))}

          {rows.length > 0 ? (
            <View style={styles.tableRowLast}>
              <View style={styles.cellFacility}>
                <Text style={styles.headerText}>TOTAL</Text>
              </View>
              <View style={styles.cellShift} />
              <View style={styles.cellShift} />
              <View style={styles.cellSupervisor} />
              <View style={styles.cellNumber}>
                <Text style={styles.headerText}>{totals.requiredStaff}</Text>
              </View>
              <View style={styles.cellNumber}>
                <Text style={styles.headerText}>{totals.totalStaff}</Text>
              </View>
            </View>
          ) : null}
        </View>

        <View style={styles.footerRow}>
          <View style={styles.footerCol}>
            <Text style={styles.footerLabel}>Prepared By</Text>
            <Text style={styles.footerValue}>{preparedBy || " "}</Text>
          </View>
          <View style={styles.footerCol}>
            <Text style={styles.footerLabel}>Approved By</Text>
            {signatureImageUrl && approvedByName ? (
              <Image src={signatureImageUrl} style={styles.signatureImage} />
            ) : null}
            <Text style={styles.footerValue}>{approvedByName || " "}</Text>
            {approvedByTitle ? (
              <Text style={styles.titleMeta}>{approvedByTitle}</Text>
            ) : null}
            {approvedAt ? (
              <Text style={styles.approvedMeta}>Approved on {approvedAt}</Text>
            ) : null}
          </View>
          <View style={styles.footerCol}>
            <Text style={styles.footerLabel}>Date</Text>
            <Text style={styles.footerValue}>{rosterDate || " "}</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}
