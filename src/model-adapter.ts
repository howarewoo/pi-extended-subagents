import { ModelRuntime, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore, type Provider } from "@earendil-works/pi-ai";
import { join } from "node:path";

/** Resolve auth only through the parent's public registry; never copy credentials to child storage. */
export async function parentModelRuntime(ctx: Pick<ExtensionContext, "model" | "modelRegistry" | "scopedModels">, agentDir: string, onRequest: () => void = () => {}): Promise<ModelRuntime> {
  const { model, modelRegistry: registry } = ctx;
  if (!model) throw new Error("Delegation requires a selected parent model");
  if (model.api === "pi-virtual") throw new Error("Selected virtual model cannot be faithfully routed through the public child adapter");
  if (ctx.scopedModels.length && !ctx.scopedModels.some(entry => entry.model.provider === model.provider && entry.model.id === model.id)) throw new Error("Selected model is outside the parent's scoped models");
  if (!registry.getProvider(model.provider) || !registry.find(model.provider, model.id)) throw new Error("Selected model has no public provider adapter (virtual-only models are not supported)");
  if (!registry.hasConfiguredAuth(model)) throw new Error(`No configured parent authentication for ${model.provider}`);
  const auth = await registry.getApiKeyAndHeaders(model);
  if (!auth.ok) throw new Error(auth.error);
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null,
    modelsStorePath: join(agentDir, "models-cache.json"), refreshOnCreate: false, allowModelNetwork: false });
  // Child runtime performs no independent auth discovery. Each request is forwarded to the
  // parent registry, which owns configured providers, OAuth refresh and request-time auth.
  const provider: Provider = {
    id: model.provider, name: `Parent selected ${model.provider}`,
    auth: { apiKey: { name: "Parent registry", async resolve() { return { auth: {}, source: "parent registry delegation" }; } } },
    getModels: () => [model],
    stream: (_model, context, options) => { onRequest(); return registry.stream(model, context, options); },
    streamSimple: (_model, context, options) => { onRequest(); return registry.streamSimple(model, context, options); },
  };
  runtime.registerNativeProvider(provider);
  return runtime;
}
