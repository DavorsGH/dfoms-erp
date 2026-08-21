import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { PortalKind } from "@/lib/middleware-auth-context";
import {
  resolveMiddlewarePersona,
  type MiddlewareAccountRow,
} from "@/lib/middleware-persona";

export type HandbookPersona = "staff" | "landlord" | "tenant";

export type HandbookChunkMatch = {
  id: string;
  section_title: string;
  content: string;
  similarity: number;
};

const VOYAGE_MODEL = "voyage-3";
const EMBEDDING_DIMENSIONS = 1024;
const DEFAULT_MATCH_COUNT = 5;

export function portalToHandbookPersona(portal: PortalKind): HandbookPersona {
  if (portal === "lessee") {
    return "tenant";
  }
  if (portal === "landlord") {
    return "landlord";
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
