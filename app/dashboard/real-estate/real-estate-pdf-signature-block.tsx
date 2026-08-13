import { Image, StyleSheet, Text, View } from "@react-pdf/renderer";

export type RealEstatePdfSignatureBlockProps = {
  authorizedByName?: string | null;
  authorizedByTitle?: string | null;
  signatureImageUrl?: string | null;
};

function shouldShowBlock(props: RealEstatePdfSignatureBlockProps): boolean {
  return Boolean(
    props.authorizedByName?.trim() ||
      props.authorizedByTitle?.trim() ||
      props.signatureImageUrl?.trim(),
  );
}

const C = {
  navy: "#0f2744",
  textMuted: "#64748b",
};

const styles = StyleSheet.create({
  signatureBlock: {
    marginTop: 24,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
  },
  signatureLabel: {
    fontSize: 9,
    fontWeight: "bold",
    color: C.navy,
    marginBottom: 6,
    textTransform: "uppercase",
  },
  signatureName: {
    fontSize: 10,
    color: "#111827",
    marginBottom: 2,
  },
  signatureTitleRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    flexWrap: "wrap",
    marginTop: 4,
  },
  signatureTitle: {
    fontSize: 9,
    color: C.textMuted,
  },
  signatureTitleSpacer: {
    flexGrow: 1,
  },
  signaturePromptGroup: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 6,
  },
  signaturePrompt: {
    fontSize: 9,
    color: C.textMuted,
  },
  signatureLine: {
    width: 120,
    borderBottomWidth: 2,
    borderBottomColor: C.navy,
  },
  signatureImage: {
    width: 140,
    height: 48,
    objectFit: "contain",
    marginBottom: 6,
  },
});

export default function RealEstatePdfSignatureBlock(
  props: RealEstatePdfSignatureBlockProps,
) {
  if (!shouldShowBlock(props)) {
    return null;
  }

  const authorizedByTitle = props.authorizedByTitle?.trim() || "";
  const authorizedByName = props.authorizedByName?.trim() || "";
  const signatureImageUrl = props.signatureImageUrl?.trim() || null;

  return (
    <View style={styles.signatureBlock} wrap={false}>
      <Text style={styles.signatureLabel}>Authorized By:</Text>
      {signatureImageUrl ? (
        <Image src={signatureImageUrl} style={styles.signatureImage} />
      ) : null}
      {authorizedByName ? (
        <Text style={styles.signatureName}>{authorizedByName}</Text>
      ) : null}
      <View style={styles.signatureTitleRow}>
        {authorizedByTitle ? (
          <>
            <Text style={styles.signatureTitle}>{authorizedByTitle},</Text>
            <View style={styles.signatureTitleSpacer} />
          </>
        ) : null}
        {!signatureImageUrl ? (
          <View style={styles.signaturePromptGroup}>
            <Text style={styles.signaturePrompt}>Signature:</Text>
            <View style={styles.signatureLine} />
          </View>
        ) : null}
      </View>
    </View>
  );
}
