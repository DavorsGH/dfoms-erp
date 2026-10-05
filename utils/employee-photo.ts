export const EMPLOYEE_PHOTOS_BUCKET = "employee-photos";

export const EMPLOYEE_PHOTO_UPLOAD_USER_MESSAGE =
  "Couldn't upload the photo. Please try again.";

const ACCEPTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

export function isAcceptedEmployeePhotoFile(file: File): boolean {
  return ACCEPTED_IMAGE_TYPES.has(file.type.toLowerCase());
}

export function isEmployeePhotoStorageReference(reference: string): boolean {
  const trimmed = reference.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.includes(`/storage/v1/object/`) && trimmed.includes(EMPLOYEE_PHOTOS_BUCKET)) {
    return true;
  }
  if (/^[0-9a-f-]{36}\//i.test(trimmed)) {
    return true;
  }
  if (/\.(jpe?g|png|webp)$/i.test(trimmed) && !trimmed.startsWith("http")) {
    return true;
  }
  return false;
}

export function employeePhotoSignedUrlEndpoint(employeeId: string): string {
  const params = new URLSearchParams({ employee_id: employeeId });
  return `/api/storage/employee-photos/signed-url?${params.toString()}`;
}

export async function uploadEmployeePhoto(
  employeeId: string,
  file: File,
): Promise<{ storagePath: string } | { error: string }> {
  if (!isAcceptedEmployeePhotoFile(file)) {
    return {
      error: "Please upload a JPEG, PNG, or WebP image.",
    };
  }

  const formData = new FormData();
  formData.append("employee_id", employeeId);
  formData.append("file", file);

  try {
    const response = await fetch("/api/employees/upload-photo", {
      method: "POST",
      body: formData,
    });
    const payload = (await response.json()) as {
      error?: string;
      storagePath?: string;
      photo_url?: string;
    };
    if (!response.ok) {
      return { error: EMPLOYEE_PHOTO_UPLOAD_USER_MESSAGE };
    }
    const storagePath =
      payload.storagePath?.trim() || payload.photo_url?.trim() || "";
    if (!storagePath) {
      return { error: EMPLOYEE_PHOTO_UPLOAD_USER_MESSAGE };
    }
    return { storagePath };
  } catch {
    return { error: EMPLOYEE_PHOTO_UPLOAD_USER_MESSAGE };
  }
}

export function getInitialsFromName(fullName: string | null | undefined): string {
  const parts = fullName?.trim().split(/\s+/).filter(Boolean) ?? [];

  if (parts.length === 0) {
    return "";
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
}
