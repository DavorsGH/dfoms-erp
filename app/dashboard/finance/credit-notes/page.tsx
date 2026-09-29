import { redirect } from "next/navigation";
import { CREDIT_NOTES_PAGE_PATH } from "./load-credit-notes-page-data";

export default function FinanceCreditNotesRedirectPage() {
  redirect(CREDIT_NOTES_PAGE_PATH);
}
