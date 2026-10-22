/** ZKTeco pushes several tables. Only ATTLOG is an attendance punch upload. */
export function iclockUploadIsAttlog(table: string | null | undefined): boolean {
  return (table ?? "").trim().toUpperCase() === "ATTLOG";
}
