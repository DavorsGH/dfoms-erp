import AssistantChatWidget from "@/components/ai-assistant/assistant-chat-widget";

export default function TestAssistantWidgetPage() {
  return (
    <main className="min-h-dvh bg-slate-50">
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <h1 className="text-xl font-semibold text-[#0f2744]">
          AI Assistant Widget — Preview
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Standalone test page for the floating Ask DFOMS chat widget. Use the
          bubble in the bottom-right corner to open the panel, type a message,
          and send — messages appear locally only (no AI backend yet).
        </p>
        <p className="mt-4 rounded-md border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500">
          Route: <code className="text-slate-700">/test-assistant-widget</code>
          . Not integrated into staff, tenant, or landlord portals yet.
        </p>
      </div>

      <AssistantChatWidget />
    </main>
  );
}
