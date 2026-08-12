import "server-only";

import type { DocumentProps } from "@react-pdf/renderer";
import { renderToBuffer } from "@react-pdf/renderer";
import type { ReactElement } from "react";

/**
 * Server-side PDF generation for existing @react-pdf/renderer document components.
 */
export async function renderPdfBuffer(
  document: ReactElement<DocumentProps>,
): Promise<Buffer> {
  return renderToBuffer(document);
}
