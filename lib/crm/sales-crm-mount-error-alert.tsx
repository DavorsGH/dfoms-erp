"use client";

import { useEffect } from "react";
import { useAlert } from "@/components/feedback/feedback-context";
import {
  SALES_CRM_ALERT_TITLE,
  clientFacingSalesCrmError,
} from "@/lib/crm/sales-crm-notifications";

type SalesCrmMountErrorAlertProps = {
  message: string | null;
  fallback?: string;
};

/** Shows a Sales & CRM alert once when `message` is set (e.g. server page load errors). */
export default function SalesCrmMountErrorAlert({
  message,
  fallback = "Could not load.",
}: SalesCrmMountErrorAlertProps) {
  const { alertError } = useAlert();

  useEffect(() => {
    if (message) {
      void alertError(clientFacingSalesCrmError(message, fallback), {
        title: SALES_CRM_ALERT_TITLE,
      });
    }
  }, [message, fallback, alertError]);

  return null;
}
