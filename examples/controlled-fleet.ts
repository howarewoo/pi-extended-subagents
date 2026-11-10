// Opt-in offline UI exercise. Run only in a throwaway cwd: the writer creates fleet-output.txt.
// Not loaded by the package manifest; all model responses are controlled, not network requests.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fauxProvider, fauxAssistantMessage, fauxToolCall, type FauxResponseFactory } from "@earendil-works/pi-ai";

export function createFleetProvider(speed = 400) {
  const provider = fauxProvider({ provider: "fleet-controlled", tokensPerSecond: speed, tokenSize: {min: 1, max: 1} });
  const respond: FauxResponseFactory = context => {
    provider.appendResponses([respond]);
    const user = context.messages.find(message => message.role === "user");
    const text = typeof user?.content === "string" ? user.content : user?.content.filter(block => block.type === "text").map(block => block.text).join("") ?? "";
    const last = context.messages.at(-1);
    const latestUser = context.messages.filter(message => message.role === "user").at(-1);
    const latestText = typeof latestUser?.content === "string" ? latestUser.content : latestUser?.content.filter(block => block.type === "text").map(block => block.text).join("") ?? "";
    if (latestText.startsWith("fleet coordinate ")) return last?.role === "toolResult"
      ? fauxAssistantMessage("Native coordination returned; inspect receipts/status, not model acknowledgment")
      : fauxAssistantMessage(fauxToolCall("delegate_coordinate", JSON.parse(latestText.slice(17))), {stopReason: "toolUse"});
    if (text === "fleet example") return context.messages.some(message => message.role === "toolResult" && message.toolName === "delegate_task") ? fauxAssistantMessage("Fleet launched; open /task-hub") : fauxAssistantMessage([
      fauxToolCall("delegate_task", {assignment: "Reader alpha: inspect input.txt", profile: "scout", background: true}),
      fauxToolCall("delegate_task", {assignment: "Reader beta: inspect input.txt", profile: "review", background: true}),
      fauxToolCall("delegate_task", {assignment: "Writer: create fleet-output.txt", profile: "implementation", background: true}),
      fauxToolCall("delegate_task", {assignment: "Failure: controlled error", profile: "general", background: true}),
    ], {stopReason: "toolUse"});
    if (text.startsWith("Failure:")) return fauxAssistantMessage("", {stopReason: "error", errorMessage: "Controlled child failure"});
    if (last?.role !== "toolResult") return fauxAssistantMessage(text.startsWith("Writer:")
      ? fauxToolCall("write", {path: "fleet-output.txt", content: "Controlled writer output\n"})
      : fauxToolCall("read", {path: "input.txt"}), {stopReason: "toolUse"});
    const steered = context.messages.filter(message => message.role === "user").length > 1;
    return fauxAssistantMessage(Array.from({length: steered ? 5 : 600}, (_, index) => `${text.split(":")[0]} ${steered ? "steered" : "stream"} line ${index} 中文\n`).join(""));
  };
  provider.setResponses([respond]);
  return { ...provider, respond };
}

export default function controlledFleet(pi: ExtensionAPI) {
  const provider = createFleetProvider();
  pi.registerProvider(provider.provider);
  pi.on("session_start", async (_event, ctx) => {
    await ctx.modelRegistry.refresh({allowNetwork: false, providers: [provider.getModel().provider]});
    const model = ctx.modelRegistry.find(provider.getModel().provider, provider.getModel().id);
    if (!model || !await pi.setModel(model)) throw new Error("Controlled fleet provider unavailable");
  });
  pi.registerCommand("fleet-theme", {description: "Offline exercise only: set dark/light", handler: async (args, ctx) => {
    if (args === "dark" || args === "light") ctx.ui.setTheme(args);
  } });
}
