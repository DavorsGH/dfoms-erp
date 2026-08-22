import Anthropic from "@anthropic-ai/sdk";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  appendHandbookScreenshotsToReply,
  buildSystemPromptWithRetrieval,
  resolveHandbookPersona,
  retrieveHandbookChunks,
  type HandbookPersona,
} from "@/utils/assistant-handbook-retrieval";
import {
  LANDLORD_ASSISTANT_TOOLS,
  landlordAccountToolsSystemPromptAddition,
} from "@/utils/assistant-landlord-tools";
import {
  getStaffAssistantTools,
  staffAccountToolsSystemPromptAddition,
} from "@/utils/assistant-staff-tools";
import {
  executeAssistantTool,
  TENANT_ASSISTANT_TOOLS,
  tenantAccountToolsSystemPromptAddition,
} from "@/utils/assistant-tools";
import {
  getCurrentAuthUser,
  getCurrentUserAccount,
  isDavorsPlatformRealEstateStaff,
} from "@/utils/dashboard-auth";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import type { AppRole } from "@/app/dashboard/user-account-types";

const MODEL = "claude-sonnet-4-6";
const HANDBOOK_MATCH_COUNT = 5;
const MAX_TOOL_ROUNDS = 5;

const SYSTEM_PROMPT_BASE = `You are the DAVORS-ERP assistant, a helpful AI assistant embedded in the DAVORS-ERP facilities management ERP system. Answer general questions helpfully and conversationally.

Naming disambiguation: "Davors" can refer to two different things:
1. Davors Facilities (full name: Davors Facilities Management Services Ltd) - the actual cleaning and facilities management company. Its services include cleaning, property/facilities management, gardening/landscaping, fumigation/pest control, real estate, and project/construction management.
2. DAVORS-ERP - the software/ERP system you are embedded in, which includes modules such as tenancy management (Real Estate / landlord-tenant) among others.

When a user asks an ambiguous question that only says "Davors" without clarifying which one they mean (for example, "what is Davors" or "tell me about Davors"), either ask them to clarify which one they mean, or give a brief rundown of both - whichever fits the question better. When the question clearly specifies one (for example, "what is DAVORS-ERP" or "what does Davors Facilities do"), answer about that one directly without disambiguation.`;

const STAFF_ACCOUNT_ACCESS =
  "You do not yet have access to any account-specific data - if asked about specific account data (like balances or invoices), explain that this capability is coming soon.";

type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

type ChatRequestBody = {
  message?: string;
  conversationHistory?: ConversationMessage[];
};

function isConversationMessage(value: unknown): value is ConversationMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    (record.role === "user" || record.role === "assistant") &&
    typeof record.content === "string"
  );
}

function buildBaseSystemPrompt(
  persona: HandbookPersona,
  staffRole: AppRole | null,
  showRealEstate = false,
): string {
  const accountAccessLine =
    persona === "tenant"
      ? tenantAccountToolsSystemPromptAddition()
      : persona === "landlord"
        ? landlordAccountToolsSystemPromptAddition()
        : persona === "staff"
          ? staffAccountToolsSystemPromptAddition(staffRole, { showRealEstate })
          : STAFF_ACCOUNT_ACCESS;

  return `${SYSTEM_PROMPT_BASE}\n\n${accountAccessLine}`;
}

function extractTextReply(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

async function runAssistantWithTools(options: {
  anthropic: Anthropic;
  systemPrompt: string;
  messages: Anthropic.MessageParam[];
  persona: HandbookPersona;
  staffRole: AppRole | null;
  showRealEstate?: boolean;
}): Promise<string> {
  const tools =
    options.persona === "tenant"
      ? TENANT_ASSISTANT_TOOLS
      : options.persona === "landlord"
        ? LANDLORD_ASSISTANT_TOOLS
        : options.persona === "staff"
          ? getStaffAssistantTools(options.staffRole, {
              showRealEstate: options.showRealEstate === true,
            })
          : undefined;
  let currentMessages = [...options.messages];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    if (process.env.NODE_ENV === "development") {
      console.log("[assistant] resolved persona:", options.persona);
      console.log(
        "[assistant] persona === \"landlord\":",
        options.persona === "landlord",
      );
      console.log(
        "[assistant] claude tools:",
        tools?.map((tool) => tool.name) ?? [],
      );
    }

    const response = await options.anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: options.systemPrompt,
      messages: currentMessages,
      ...(tools ? { tools } : {}),
    });

    if (response.stop_reason !== "tool_use") {
      return extractTextReply(response.content);
    }

    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      if (process.env.NODE_ENV === "development") {
        console.log(
          "[assistant] tool call:",
          options.persona,
          block.name,
          options.persona === "staff" ? options.staffRole : "",
        );
      }

      const result = await executeAssistantTool(
        block.name,
        options.persona,
        block.input,
      );
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(result),
      });
    }

    currentMessages = [
      ...currentMessages,
      { role: "assistant", content: response.content },
      { role: "user", content: toolResults },
    ];
  }

  throw new Error("Assistant exceeded maximum tool-use rounds.");
}

export async function POST(request: Request) {
  let body: ChatRequestBody;

  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const message = body.message?.trim();
  if (!message) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }

  const user = await getCurrentAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Assistant is not configured. Missing ANTHROPIC_API_KEY." },
      { status: 500 },
    );
  }

  const voyageApiKey = process.env.VOYAGE_API_KEY ?? "";
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const account = await getCurrentUserAccount();

  const handbookPersona = await resolveHandbookPersona({
    supabase,
    user,
    account: account
      ? {
          is_active: true,
          tenant_id: account.tenant_id,
          role: account.role,
          employee_id: account.employee_id,
          client_id: account.client_id,
        }
      : null,
  });

  const staffRole = (account?.role ?? null) as AppRole | null;
  const showRealEstate =
    handbookPersona === "staff"
      ? await isDavorsPlatformRealEstateStaff()
      : false;

  const handbookChunks =
    voyageApiKey.length > 0
      ? await retrieveHandbookChunks({
          supabase,
          persona: handbookPersona,
          query: message,
          voyageApiKey,
          matchCount: HANDBOOK_MATCH_COUNT,
        })
      : [];

  if (voyageApiKey.length > 0 && handbookChunks.length === 0) {
    console.error(
      "[assistant] handbook retrieval returned no chunks despite configured Voyage key",
    );
  }

  if (process.env.NODE_ENV === "development") {
    console.log("[assistant] handbook persona:", handbookPersona);
    console.log(
      "[assistant] retrieved handbook sections:",
      handbookChunks.map((chunk) => chunk.section_title),
    );
  }

  const systemPrompt = buildSystemPromptWithRetrieval(
    buildBaseSystemPrompt(handbookPersona, staffRole, showRealEstate),
    handbookChunks,
  );

  const conversationHistory = Array.isArray(body.conversationHistory)
    ? body.conversationHistory.filter(isConversationMessage)
    : [];

  const messages: Anthropic.MessageParam[] = [
    ...conversationHistory.map((entry) => ({
      role: entry.role,
      content: entry.content.trim(),
    })),
    { role: "user" as const, content: message },
  ].filter((entry) => {
    if (typeof entry.content === "string") {
      return entry.content.length > 0;
    }
    return true;
  });

  try {
    const anthropic = new Anthropic({ apiKey });

    const textReply = await runAssistantWithTools({
      anthropic,
      systemPrompt,
      messages,
      persona: handbookPersona,
      staffRole,
      showRealEstate,
    });

    const reply = await appendHandbookScreenshotsToReply({
      supabase,
      handbookChunks,
      textReply,
      admin: createAdminClient(),
    });

    if (!reply) {
      return NextResponse.json(
        { error: "Assistant returned an empty response." },
        { status: 500 },
      );
    }

    return NextResponse.json({ reply });
  } catch (error) {
    const messageText =
      error instanceof Error ? error.message : "Failed to reach the assistant.";

    return NextResponse.json({ error: messageText }, { status: 500 });
  }
}
