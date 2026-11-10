import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ProofCoordinator } from "./coordinator.ts";
import { createHub } from "./hub.ts";

export default function extendedSubagentsProof(pi: ExtensionAPI) {
  let coordinator: ProofCoordinator | undefined;
  pi.on("session_shutdown", async () => { await coordinator?.shutdown(); });

  pi.registerCommand("proof-start", {
    description: "Start one isolated controlled-provider child (no paid model)",
    handler: async (args, ctx) => {
      if (coordinator) throw new Error("One proof child per parent runtime; start a new parent session to repeat");
      if (!args.trim()) throw new Error("Usage: /proof-start <text>");
      coordinator = new ProofCoordinator(join(ctx.sessionManager.getSessionDir(), "extended-subagents-proof", ctx.sessionManager.getSessionId()));
      await coordinator.start(args);
      if (ctx.hasUI) ctx.ui.notify("Controlled child started. /proof-hub observes; /proof-cancel aborts.", "info");
    },
  });
  pi.registerCommand("proof-steer", {
    description: "Queue text after the controlled child's current turn",
    handler: async (args, ctx) => {
      if (!coordinator) throw new Error("Start a proof child first");
      const outcome = await coordinator.steer(args);
      if (ctx.hasUI) ctx.ui.notify(`Steering ${outcome}`, "info");
    },
  });
  pi.registerCommand("proof-cancel", {
    description: "Abort the controlled child, retaining its transcript",
    handler: async () => { await coordinator?.cancel(); },
  });
  pi.registerCommand("proof-result", {
    description: "Show controlled child status and captured final text",
    handler: async (_args, ctx) => {
      if (!coordinator) throw new Error("Start a proof child first");
      const state = coordinator.snapshot();
      pi.sendMessage({ customType: "extended-subagents-proof", content: JSON.stringify(state, null, 2), display: true });
    },
  });
  pi.registerCommand("proof-hub", {
    description: "Observe the controlled child in a minimal live overlay (TUI only)",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        if (ctx.hasUI) ctx.ui.notify("proof-hub requires TUI mode, not RPC", "warning");
        return;
      }
      if (!coordinator) throw new Error("Start a proof child first");
      const observed = coordinator;
      await ctx.ui.custom<void>((tui, theme, keys, done) => createHub(observed, theme, keys, () => tui.requestRender(), () => done()), {
        overlay: true, overlayOptions: { width: "80%", maxHeight: 8, anchor: "center" },
      });
      // Pi's custom() completion restores the prior editor focus; no execution ownership here.
    },
  });
}
