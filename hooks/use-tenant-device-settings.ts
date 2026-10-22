"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import {
  deviceSettingsWriteRow,
  normalizeTenantDeviceSettings,
  TENANT_DEVICE_SETTINGS_DEFAULTS,
  type TenantDeviceSettings,
} from "@/utils/tenant-device-settings";

let cached: TenantDeviceSettings | null = null;
let loadToken = 0;
const listeners = new Set<(settings: TenantDeviceSettings) => void>();

function publish(next: TenantDeviceSettings) {
  cached = next;
  for (const listener of listeners) {
    listener(next);
  }
}

export async function loadTenantDeviceSettings(): Promise<TenantDeviceSettings> {
  const token = loadToken;
  const supabase = createClient();
  const { data, error } = await supabase
    .from("tenant_device_settings")
    .select(
      "scanner_min_length, scanner_max_gap_ms, receipt_paper, label_size, offline_alert_minutes, working_hours_start, working_hours_end",
    )
    .maybeSingle();

  if (token !== loadToken) {
    return cached ?? TENANT_DEVICE_SETTINGS_DEFAULTS;
  }
  if (error || !data) {
    const defaults = TENANT_DEVICE_SETTINGS_DEFAULTS;
    if (!cached) {
      publish(defaults);
    }
    return cached ?? defaults;
  }

  const next = normalizeTenantDeviceSettings(data);
  publish(next);
  return next;
}

export async function saveTenantDeviceSettings(
  tenantId: string,
  patch: Partial<TenantDeviceSettings>,
): Promise<string | null> {
  const current = cached ?? (await loadTenantDeviceSettings());
  const next = normalizeTenantDeviceSettings({ ...current, ...patch });
  loadToken += 1;
  const supabase = createClient();
  const { data: userData } = await supabase.auth.getUser();
  const { error } = await supabase.from("tenant_device_settings").upsert(
    {
      tenant_id: tenantId,
      ...deviceSettingsWriteRow(next),
      updated_by: userData.user?.id ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id" },
  );
  if (error) {
    return error.message;
  }
  publish(next);
  return null;
}

export function useTenantDeviceSettings(): TenantDeviceSettings {
  const [settings, setSettings] = useState<TenantDeviceSettings>(
    cached ?? TENANT_DEVICE_SETTINGS_DEFAULTS,
  );

  useEffect(() => {
    listeners.add(setSettings);
    void loadTenantDeviceSettings().then(setSettings);
    return () => {
      listeners.delete(setSettings);
    };
  }, []);

  return settings;
}
