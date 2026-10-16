export type ClientInvoiceFormValidityControls = {
  clientSelect: HTMLSelectElement | null;
  billToName: HTMLInputElement | null;
  invoiceDate: HTMLInputElement | null;
  lineItemsGate: HTMLInputElement | null;
};

export type ClientInvoiceFormValidityInput = {
  client_id: string;
  bill_to_name: string;
  invoice_date: string;
  line_items: { description: string }[];
};

function setNativeFieldValidity(
  control: HTMLInputElement | HTMLSelectElement | null,
  message: string | null,
): void {
  control?.setCustomValidity(message ?? "");
}

export function clearClientInvoiceLineDescriptionValidity(
  formElement: HTMLFormElement,
): void {
  formElement
    .querySelectorAll<HTMLInputElement>("input[data-line-item-description]")
    .forEach((input) => {
      input.setCustomValidity("");
    });
}

export function syncClientInvoiceFormCustomValidity(
  controls: ClientInvoiceFormValidityControls,
  form: ClientInvoiceFormValidityInput,
  formElement: HTMLFormElement | null,
  options: { preview: boolean },
): void {
  const actionWord = options.preview ? "previewing" : "saving";

  setNativeFieldValidity(controls.clientSelect, null);
  setNativeFieldValidity(controls.billToName, null);
  setNativeFieldValidity(controls.invoiceDate, null);
  setNativeFieldValidity(controls.lineItemsGate, null);
  if (formElement) {
    clearClientInvoiceLineDescriptionValidity(formElement);
  }

  if (!form.client_id.trim()) {
    setNativeFieldValidity(
      controls.clientSelect,
      `Select a customer before ${actionWord}.`,
    );
  }

  if (!form.bill_to_name.trim()) {
    setNativeFieldValidity(
      controls.billToName,
      `Bill-to name is required before ${actionWord}.`,
    );
  }

  if (!form.invoice_date) {
    setNativeFieldValidity(
      controls.invoiceDate,
      `Invoice date is required before ${actionWord}.`,
    );
  }

  if (form.line_items.length === 0) {
    setNativeFieldValidity(
      controls.lineItemsGate,
      `Add at least one line item before ${actionWord}.`,
    );
  } else if (formElement) {
    const descriptionInputs = formElement.querySelectorAll<HTMLInputElement>(
      "input[data-line-item-description]",
    );
    descriptionInputs.forEach((input) => {
      if (!input.value.trim()) {
        setNativeFieldValidity(
          input,
          `Each line item needs a description before ${actionWord}.`,
        );
      }
    });
  }
}

export function reportClientInvoiceFormValidity(
  formElement: HTMLFormElement,
): boolean {
  if (!formElement.reportValidity()) {
    return false;
  }

  const invalidDescription = formElement.querySelector<HTMLInputElement>(
    "input[data-line-item-description]:invalid",
  );
  if (invalidDescription) {
    invalidDescription.focus();
    invalidDescription.reportValidity();
    return false;
  }

  return true;
}
