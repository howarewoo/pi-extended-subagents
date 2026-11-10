import { truncateToWidth, type Component, type KeybindingsManager } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ProofCoordinator } from "./coordinator.ts";

/** Observation only: disposing this view never touches child execution. */
export function createHub(
  coordinator: ProofCoordinator,
  theme: Pick<Theme, "fg">,
  keybindings: Pick<KeybindingsManager, "matches">,
  requestRender: () => void,
  done: () => void,
): Component & { dispose(): void } {
  const unsubscribe = coordinator.subscribe(requestRender);
  return {
    render(width) {
      const child = coordinator.snapshot();
      const safe = (text: string) => text.replace(/[\x00-\x1f\x7f-\x9f]/g, " ");
      return [
        theme.fg("accent", "Agent Hub — controlled proof"),
        `child: ${child.status}${child.disposed ? " (disposed)" : ""}`,
        safe(child.progress || "No streamed text yet"),
        safe(child.error ?? ""),
        theme.fg("dim", "Enter/Escape closes view; child continues. Use /proof-cancel to stop."),
      ].map(line => truncateToWidth(line, Math.max(0, width)));
    },
    handleInput(data) {
      if (keybindings.matches(data, "tui.select.cancel") || keybindings.matches(data, "tui.select.confirm")) done();
    },
    invalidate() {},
    dispose: unsubscribe,
  };
}
