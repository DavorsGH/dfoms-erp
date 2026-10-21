/** generate_next_code entity for projects.project_code (migration 394). */
export const PROJECT_CODE_ENTITY_TYPE = "PRJ";

/** Minimum width. Values of 100 and above stay PRJ100 — they are not truncated. */
export const PROJECT_CODE_PADDING = 2;

/** PRJ plus at least two digits: PRJ13, PRJ01, PRJ100. Never DF-PRJ-0001. */
const AUTO_PROJECT_CODE = /^PRJ\d{2,}$/;

export function isAutoProjectCode(code: string): boolean {
  return AUTO_PROJECT_CODE.test(code.trim());
}

export function projectCodeShapeError(code: string): string | null {
  const trimmed = code.trim();
  if (isAutoProjectCode(trimmed)) {
    return null;
  }

  return `Project code "${trimmed || "(empty)"}" is not a PRJ code. Expected PRJ plus at least two digits, such as PRJ13.`;
}
