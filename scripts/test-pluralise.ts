/**
 * Unit checks for shared count pluralisation.
 * Usage: npx tsx scripts/test-pluralise.ts
 */
import {
  formatCountNoun,
  pluraliseWord,
} from "../utils/pluralise";
import { formatFilteredListCountLabel } from "../app/dashboard/filtered-list-count";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function eq(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

eq(pluraliseWord("category"), "categories", "category plural");
eq(pluraliseWord("entry"), "entries", "entry plural");
eq(pluraliseWord("company"), "companies", "company plural");
eq(pluraliseWord("product"), "products", "regular s plural");
eq(pluraliseWord("batch"), "batches", "ch ending");
eq(pluraliseWord("purchase order"), "purchase orders", "multi-word plural");
eq(formatCountNoun(1, "category"), "1 category", "singular count");
eq(formatCountNoun(9, "category"), "9 categories", "plural count");
eq(
  formatFilteredListCountLabel({
    filteredCount: 9,
    totalCount: 9,
    itemSingular: "category",
  }),
  "9 categories",
  "filtered list category chip",
);
eq(
  formatFilteredListCountLabel({
    filteredCount: 1,
    totalCount: 12,
    itemSingular: "entry",
    hasActiveFilters: true,
  }),
  "1 of 12 entries",
  "filtered list entry chip",
);

console.log("PASS pluralise");
