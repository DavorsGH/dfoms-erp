// @ts-nocheck
import { readFileSync } from "node:fs";

const files = [
  "scripts/_phase2-prod-quotation-DF-CQUO-0002.pdf",
  "scripts/_phase2-prod-invoice-DF-INV-0001.pdf",
  "scripts/_phase2-prod-receipt-DF-RCPT-0002.pdf",
];

async function main() {
  const pdfModule = await import("pdf-parse");
  const pdf = pdfModule.default ?? pdfModule;

  for (const file of files) {
    const buffer = readFileSync(file);
    const data = await pdf(buffer);
    const pages = data.text.split("\f");
    const text = data.text.replace(/\s+/g, " ").trim();

    console.log(`\n${file} (${data.numpages} pages)`);
    console.log("  validity mentions:", (text.match(/valid until/gi) ?? []).length);
    console.log(
      "  payment footer mentions:",
      (text.match(/Payment is due within 30 days/gi) ?? []).length,
    );
    console.log("  CEO mentions:", (text.match(/\bCEO\b/g) ?? []).length);
    console.log(
      "  Chief Executive Officer mentions:",
      (text.match(/Chief Executive Officer/gi) ?? []).length,
    );

    pages.forEach((page, index) => {
      const snippet = page.replace(/\s+/g, " ").trim();
      console.log(`  page ${index + 1} tail:`, snippet.slice(Math.max(0, snippet.length - 280)));
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
