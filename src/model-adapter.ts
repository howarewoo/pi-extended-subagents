import { ModelRuntime, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  InMemoryCredentialStore,
  type Provider,
  type Model,
  type Api,
} from "@earendil-works/pi-ai";
import { join } from "node:path";

/** Resolve auth only through the parent's public registry; never copy credentials to child storage. */
export async function parentModelRuntime(
  ctx: Pick<ExtensionContext, "model" | "modelRegistry" | "scopedModels">,
  agentDir: string,
  onRequest: () => void = () => {},
  additionalModels: Model<Api>[] = [],
): Promise<ModelRuntime> {
  const { model, modelRegistry: registry } = ctx;
  if (!model) throw new Error("Delegation requires a selected parent model");
  if (model.api === "pi-virtual")
    throw new Error(
      "Selected virtual model cannot be faithfully routed through the public child adapter",
    );
  if (
    ctx.scopedModels.length &&
    !ctx.scopedModels.some(
      (entry) => entry.model.provider === model.provider && entry.model.id === model.id,
    )
  )
    throw new Error("Selected model is outside the parent's scoped models");
  if (!registry.getProvider(model.provider) || !registry.find(model.provider, model.id))
    throw new Error(
      "Selected model has no public provider adapter (virtual-only models are not supported)",
    );
  if (!registry.hasConfiguredAuth(model))
    throw new Error(`No configured parent authentication for ${model.provider}`);
  const auth = await registry.getApiKeyAndHeaders(model);
  if (!auth.ok) throw new Error(auth.error);
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    modelsStorePath: join(agentDir, "models-cache.json"),
    refreshOnCreate: false,
    allowModelNetwork: false,
  });
  // Child runtime performs no independent auth discovery. Each request is forwarded to the
  // parent registry, which owns configured providers, OAuth refresh and request-time auth.
  const models = [model, ...additionalModels];
  for (const providerId of new Set(models.map((item) => item.provider))) {
    const provider: Provider = {
      id: providerId,
      name: `Parent selected ${providerId}`,
      auth: {
        apiKey: {
          name: "Parent registry",
          async resolve() {
            return { auth: {}, source: "parent registry delegation" };
          },
        },
      },
      getModels: () => models.filter((item) => item.provider === providerId),
      stream: (selected, context, options) => {
        onRequest();
        return registry.stream(registry.find(selected.provider, selected.id)!, context, options);
      },
      streamSimple: (selected, context, options) => {
        onRequest();
        return registry.streamSimple(
          registry.find(selected.provider, selected.id)!,
          context,
          options,
        );
      },
    };
    runtime.registerNativeProvider(provider);
  }
  return runtime;
}
