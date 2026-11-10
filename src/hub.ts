import { colorToOklch, oklchColor, sliceByColumn, truncateToWidth, visibleWidth, type Component, type KeybindingsManager } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ChildSnapshot, ProofCoordinator } from "./coordinator.ts";

function safe(text: string): string {
  return text.replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, " ");
}

function childPresentation(child: ChildSnapshot | undefined) {
  return {
    status: child?.status ?? "not-started",
    activity: safe(child?.error || (child?.status === "running" ? child.progress : child?.result) || child?.progress ||
      (child ? "Waiting for streamed activity" : "Use /proof-start <text> to start a controlled child")),
    color: child?.status === "failed" ? "error" as const
      : child?.status === "completed" ? "success" as const
      : child?.status === "cancelled" ? "warning" as const : "accent" as const,
  };
}

function latestActivity(text: string, width: number): string {
  if (width <= 0) return "";
  const columns = visibleWidth(text);
  return columns <= width ? text : "…" + sliceByColumn(text, Math.max(0, columns - width + 1), width - 1);
}

/** Main-screen discovery and final state do not depend on an open Hub. */
export function createChildWidget(snapshot: () => ChildSnapshot | undefined, theme: Pick<Theme, "fg">): Component {
  return {
    render(width) {
      const child = childPresentation(snapshot());
      const heading = width < 40 ? `${child.status} · subagent` : `Subagent proof · ${child.status}  /proof-hub`;
      return [
        theme.fg(child.color, heading),
        theme.fg("muted", latestActivity(child.activity, width)),
      ].map(line => truncateToWidth(line, Math.max(0, width)));
    },
    invalidate() {},
  };
}

/** Observation only: disposing this view never touches child execution. */
export function createHub(
  coordinator: ProofCoordinator,
  theme: Pick<Theme, "fg" | "style"> & { colors: Pick<Theme["colors"], "customMessageBg"> },
  keybindings: Pick<KeybindingsManager, "matches" | "getKeys">,
  requestRender: () => void,
  done: () => void,
  availableRows: () => number = () => 7,
): Component & { dispose(): void } {
  const unsubscribe = coordinator.subscribe(requestRender);
  return {
    render(width) {
      width = Math.max(0, width);
      const child = childPresentation(coordinator.snapshot());
      const height = Math.max(1, Math.min(7, availableRows()));
      // Keep the theme's panel lightness, but remove its tint even for custom palettes.
      const panelBg = oklchColor(colorToOklch(theme.colors.customMessageBg).l, 0, 0);
      const paint = (text: string) => {
        const clipped = truncateToWidth(text, width);
        // Paint every cell, including padding/borders, so the underlying chat cannot bleed through.
        const padded = clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
        // Pi truncation inserts full resets; reapply the surface after each one.
        return padded.split("\x1b[0m").map(part => theme.style(part, { bg: panelBg })).join("\x1b[0m");
      };
      if (width < 4 || height < 3) return [paint(theme.fg(child.color, child.status))];
      const innerWidth = width - 2;
      const row = (text: string) => {
        const content = truncateToWidth(text, innerWidth - 2);
        return paint(theme.fg("border", "│") + " " + content +
          " ".repeat(Math.max(1, innerWidth - 1 - visibleWidth(content))) + theme.fg("border", "│"));
      };
      const title = truncateToWidth(width >= 34 ? " Agent Hub · controlled proof " : " Agent Hub ", innerWidth);
      const top = paint(theme.fg("border", "╭") + theme.fg("accent", title) +
        theme.fg("border", "─".repeat(Math.max(0, innerWidth - visibleWidth(title))) + "╮"));
      const bottom = paint(theme.fg("border", "╰" + "─".repeat(innerWidth) + "╯"));
      const closeKeys = [...keybindings.getKeys("tui.select.cancel"), ...keybindings.getKeys("tui.select.confirm")].join("/");
      const hint = theme.fg("muted", `${closeKeys}: close${width >= 48 ? " · child continues" : ""}`);
      const status = row(theme.fg(child.color, `child: ${child.status}`));
      const activity = row(latestActivity(child.activity, innerWidth - 2));
      const body = height >= 7 ? [row(""), status, activity, row(""), row(hint)]
        : height >= 5 ? [status, activity, row(hint)]
        : height >= 4 ? [status, row(hint)] : [status];
      return [top, ...body, bottom];
    },
    handleInput(data) {
      if (keybindings.matches(data, "tui.select.cancel") || keybindings.matches(data, "tui.select.confirm")) done();
    },
    invalidate() {},
    dispose: unsubscribe,
  };
}
