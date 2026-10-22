const IRREGULAR_PLURALS: Record<string, string> = {
  category: "categories",
  company: "companies",
  entry: "entries",
};

function pluraliseToken(token: string): string {
  const trimmed = token.trim();
  if (!trimmed) {
    return trimmed;
  }

  const lower = trimmed.toLowerCase();
  const irregular = IRREGULAR_PLURALS[lower];
  if (irregular) {
    if (trimmed === lower) {
      return irregular;
    }
    if (trimmed === trimmed.toUpperCase()) {
      return irregular.toUpperCase();
    }
    if (trimmed[0] === trimmed[0]?.toUpperCase()) {
      return irregular[0]!.toUpperCase() + irregular.slice(1);
    }
    return irregular;
  }

  if (/[^aeiou]y$/i.test(trimmed)) {
    return `${trimmed.slice(0, -1)}ies`;
  }

  if (/(?:s|x|z|ch|sh)$/i.test(trimmed)) {
    return `${trimmed}es`;
  }

  return `${trimmed}s`;
}

/** Plural form of a singular label (handles multi-word phrases on the last word). */
export function pluraliseWord(singular: string, explicitPlural?: string): string {
  const trimmed = singular.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (explicitPlural?.trim()) {
    return explicitPlural.trim();
  }

  const phraseKey = trimmed.toLowerCase();
  if (IRREGULAR_PLURALS[phraseKey]) {
    return pluraliseToken(trimmed);
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) {
    return pluraliseToken(trimmed);
  }

  const last = parts[parts.length - 1] ?? "";
  return [...parts.slice(0, -1), pluraliseToken(last)].join(" ");
}

/** Singular or plural noun for a count (e.g. `1 category`, `9 categories`). */
export function formatCountNoun(
  count: number,
  singular: string,
  explicitPlural?: string,
): string {
  const noun = count === 1 ? singular.trim() : pluraliseWord(singular, explicitPlural);
  return `${count} ${noun}`;
}
