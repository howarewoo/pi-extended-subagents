// Opt-in offline example fixture only. Never loaded by the package manifest.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fauxProvider, fauxAssistantMessage, fauxToolCall, type FauxResponseFactory } from "@earendil-works/pi-ai";

export function createControlledProvider() {
  const provider = fauxProvider({ provider: "delegation-example", tokensPerSecond: 300, tokenSize: { min: 1, max: 1 } });
  const respond: FauxResponseFactory = context => {
    provider.appendResponses([respond]);
    const user = context.messages.find(message => message.role === "user");
    const text = typeof user?.content === "string" ? user.content : user?.content.filter(block => block.type === "text").map(block => block.text).join("") ?? "";
    if (text.startsWith("delegate example")) return context.messages.at(-1)?.role === "toolResult" ? fauxAssistantMessage("Parent accepted background identity")
      : fauxAssistantMessage(fauxToolCall("delegate_task", { assignment: "Long controlled child ".repeat(200), profile: "general", background: true }), { stopReason: "toolUse" });
    return fauxAssistantMessage("Controlled child output ".repeat(200));
  };
  provider.setResponses([respond]);
  return provider;
}

export default function controlledParent(pi: ExtensionAPI) {
  const provider = createControlledProvider();
  pi.registerProvider(provider.provider);
  pi.on("session_start", async (_event, ctx) => {
    await ctx.modelRegistry.refresh({ allowNetwork: false, providers: [provider.getModel().provider] });
    const model = ctx.modelRegistry.find(provider.getModel().provider, provider.getModel().id);
    if (!model || !await pi.setModel(model)) throw new Error("Controlled example provider unavailable");
  });
}
