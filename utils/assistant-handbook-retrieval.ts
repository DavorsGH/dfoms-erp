import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { PortalKind } from "@/lib/middleware-auth-context";
import {
  resolveMiddlewarePersona,
  type MiddlewareAccountRow,
} from "@/lib/middleware-persona";
import {
  buildHandbookScreenshotMarkdown,
  createHandbookScreenshotSignedUrl,
} from "@/utils/handbook-screenshots-storage";
import { createAdminClient } from "@/utils/supabase/admin";

export type HandbookPersona =
  | "staff"
  | "landlord"
  | "tenant"
  | "facility_manager";

export type HandbookChunkMatch = {
  id: string;
  section_title: string;
  content: string;
  similarity: number;
};

type HandbookScreenshotRow = {
  id: string;
  section_key: string;
  file_path: string;
  caption: string | null;
  display_order: number;
};

const VOYAGE_MODEL = "voyage-3";
const EMBEDDING_DIMENSIONS = 1024;
const DEFAULT_MATCH_COUNT = 5;

/** e.g. "Section 6 — Finance — 6.2 Expense Register" -> "6.2"; Section 5 only -> "5.1" */
export function extractHandbookSectionKey(sectionTitle: string): string | null {
  const subsection = sectionTitle.match(/\b(\d+\.\d+)\b/);
  if (subsection) {
    return subsection[1] ?? null;
  }

  const sectionHeader = sectionTitle.match(/Section\s+(\d+)\s*[—-]/i);
  if (sectionHeader) {
    return `${sectionHeader[1]}.1`;
  }

  return null;
}

export function collectHandbookSectionKeys(chunks: HandbookChunkMatch[]): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();

  for (const chunk of chunks) {
    const key = extractHandbookSectionKey(chunk.section_title);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    keys.push(key);
  }

  return keys;
}

async function fetchHandbookScreenshotsForSectionKeys(
  supabase: SupabaseClient,
  sectionKeys: string[],
): Promise<HandbookScreenshotRow[]> {
  if (sectionKeys.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("handbook_screenshots")
    .select("id, section_key, file_path, caption, display_order")
    .in("section_key", sectionKeys)
    .order("section_key", { ascending: true })
    .order("display_order", { ascending: true });

  if (error) {
    console.error("[assistant] handbook_screenshots fetch failed:", error.message);
    return [];
  }

  const order = new Map(sectionKeys.map((key, index) => [key, index]));
  return ((data ?? []) as HandbookScreenshotRow[]).sort((a, b) => {
    const left = order.get(a.section_key) ?? Number.MAX_SAFE_INTEGER;
    const right = order.get(b.section_key) ?? Number.MAX_SAFE_INTEGER;
    if (left !== right) {
      return left - right;
    }
    return a.display_order - b.display_order;
  });
}

async function buildHandbookScreenshotAppendix(
  admin: SupabaseClient,
  rows: HandbookScreenshotRow[],
): Promise<string> {
  if (rows.length === 0) {
    return "";
  }

  const blocks: string[] = [];

  for (const row of rows) {
    try {
      const signedUrl = await createHandbookScreenshotSignedUrl(admin, row.file_path);
      if (!signedUrl) {
        console.error(
          "[assistant] handbook screenshot signed URL failed:",
          row.file_path,
        );
        continue;
      }
      blocks.push(buildHandbookScreenshotMarkdown(signedUrl, row.caption));
    } catch (error) {
      console.error(
        "[assistant] handbook screenshot signed URL failed:",
        row.file_path,
        error instanceof Error ? error.message : error,
      );
    }
  }

  return blocks.join("\n\n");
}

/** Appends signed screenshot markdown after the assistant text reply when matched sections have uploads. */
export async function appendHandbookScreenshotsToReply(options: {
  supabase: SupabaseClient;
  handbookChunks: HandbookChunkMatch[];
  textReply: string;
  admin?: SupabaseClient;
}): Promise<string> {
  const sectionKeys = collectHandbookSectionKeys(options.handbookChunks);
  if (sectionKeys.length === 0) {
    return options.textReply;
  }

  const screenshots = await fetchHandbookScreenshotsForSectionKeys(
    options.supabase,
    sectionKeys,
  );
  if (screenshots.length === 0) {
    return options.textReply;
  }

  const admin = options.admin ?? createAdminClient();
  const appendix = await buildHandbookScreenshotAppendix(admin, screenshots);
  if (!appendix.trim()) {
    return options.textReply;
  }

  return `${options.textReply.trim()}\n\n${appendix}`.trim();
}

export function portalToHandbookPersona(portal: PortalKind): HandbookPersona {
  if (portal === "lessee") {
    return "tenant";
  }
  if (portal === "landlord") {
    return "landlord";
  }
  if (portal === "facility_manager") {
    return "facility_manager";
  }
  return "staff";
}

export async function resolveHandbookPersona(options: {
  supabase: SupabaseClient;
  user: User;
  account: MiddlewareAccountRow | null;
}): Promise<HandbookPersona> {
  const resolution = await resolveMiddlewarePersona({
    supabase: options.supabase,
    user: options.user,
    pathname: "/api/assistant/chat",
    accountRow: options.account,
  });

  return portalToHandbookPersona(resolution.portal);
}

export async function embedQuery(text: string, apiKey: string): Promise<number[]> {
  const response = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: [text],
      model: VOYAGE_MODEL,
      input_type: "query",
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Voyage query embedding failed (${response.status}): ${detail}`);
  }

  const payload = (await response.json()) as {
    data?: Array<{ embedding?: number[] }>;
  };

  const embedding = payload.data?.[0]?.embedding ?? [];
  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Unexpected query embedding dimension ${embedding.length}; expected ${EMBEDDING_DIMENSIONS}.`,
    );
  }

  return embedding;
}

export async function retrieveHandbookChunks(options: {
  supabase: SupabaseClient;
  persona: HandbookPersona;
  query: string;
  voyageApiKey: string;
  matchCount?: number;
}): Promise<HandbookChunkMatch[]> {
  try {
    const embedding = await embedQuery(options.query, options.voyageApiKey);
    const { data, error } = await options.supabase.rpc("match_handbook_chunks", {
      query_embedding: embedding,
      match_persona: options.persona,
      match_count: options.matchCount ?? DEFAULT_MATCH_COUNT,
    });

    if (error) {
      throw error;
    }

    return (data ?? []) as HandbookChunkMatch[];
  } catch (error) {
    console.error("[assistant] handbook retrieval failed:", error);
    return [];
  }
}

export function buildSystemPromptWithRetrieval(
  basePrompt: string,
  chunks: HandbookChunkMatch[],
): string {
  if (chunks.length === 0) {
    return basePrompt;
  }

  const excerpts = chunks
    .map((chunk) => `[${chunk.section_title}]\n${chunk.content}`)
    .join("\n\n");

  return `${basePrompt}

Use the following DAVORS-ERP handbook excerpts to answer the user's question if relevant. If the excerpts don't cover what's being asked, say so honestly rather than guessing:

${excerpts}`;
}
