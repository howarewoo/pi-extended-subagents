import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
  type KeybindingsManager,
} from "@earendil-works/pi-tui";
import { safe } from "./thread.ts";
import { bundledProfiles, resolveProfile, type Profile } from "./profiles.ts";

export const profileToolPolicy =
  "Profile tools are maximum allowlists, not requirements. Admission intersects callable parent builtins without activating tools. Command context has no callable-tool dispatcher: effective tools are unknown here. Active declarations are not proof of callability. Inspect task snapshot tools for admitted grants.";

/** Resolve through the same trust/config/skill validation boundary used by admission. */
export async function resolvedProfiles(
  cwd: string,
  trusted: boolean,
  operatorDir?: string,
): Promise<Profile[]> {
  return Promise.all(
    bundledProfiles().map(
      async ({ name }) => (await resolveProfile(name, cwd, trusted, operatorDir)).profile,
    ),
  );
}

function details(profile: Profile): string[] {
  const list = (items: readonly string[] | undefined) =>
    items?.length ? items.join(", ") : "none";
  const known = new Set([
    "name",
    "description",
    "prompt",
    "tools",
    "skills",
    "spawn",
    "coordination",
    "models",
    "model",
    "prewalk",
  ]);
  return [
    profile.name,
    "Description",
    profile.description,
    "Prompt",
    profile.prompt,
    `Tools ceiling: ${list(profile.tools)}`,
    "Callable tools: unknown in command context; inspect admitted task tools.",
    `Skills (exact paths): ${list(profile.skills)}`,
    `Spawn ceiling: ${list(profile.spawn)}`,
    `Coordination: ${list(profile.coordination)}`,
    `Model default: ${profile.model ? JSON.stringify(profile.model) : "selected parent model"}`,
    `Models grant: ${profile.models === undefined ? "no explicit override grant" : JSON.stringify(profile.models)}`,
    `Prewalk: ${profile.prewalk ? JSON.stringify(profile.prewalk) : "off"}`,
    ...Object.entries(profile)
      .filter(([key]) => !known.has(key))
      .map(([key, value]) => `${key}: ${JSON.stringify(value)}`),
    "Admission also applies parent/ancestry, model availability, capacity and writer checks. This viewer grants nothing.",
  ];
}

/** Read-only snapshot consumer; no fixed role count or policy defaults in the renderer. */
export function createProfileViewer(
  profiles: readonly Profile[],
  theme: Pick<Theme, "fg" | "style"> & { colors: Pick<Theme["colors"], "customMessageBg"> },
  keys: Pick<KeybindingsManager, "matches" | "getKeys">,
  requestRender: () => void,
  done: () => void,
  availableRows: () => number,
): Component {
  let selected = 0;
  let offset = 0;
  let viewport = 1;
  let maximum = 0;
  const cell = (text: string, width: number) => {
    const clipped = truncateToWidth(text, width);
    return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
  };
  return {
    render(width) {
      width = Math.max(0, width);
      const height = Math.max(1, Math.floor(availableRows()));
      const close = keys.getKeys("tui.select.cancel").join("/") || "Esc";
      if (width < 24 || height < 7)
        return [`Profiles · ${close}: close`, "Resize for details"]
          .slice(0, height)
          .map((line) => truncateToWidth(line, width));
      const inner = width - 4;
      const wide = width >= 88;
      const leftWidth = wide ? Math.min(28, Math.floor(inner / 3)) : inner;
      const rightWidth = wide ? inner - leftWidth - 3 : inner;
      const bodyHeight = height - 4;
      const listHeight = wide ? bodyHeight : Math.min(3, Math.max(1, Math.floor(bodyHeight / 3)));
      viewport = wide ? bodyHeight : Math.max(1, bodyHeight - listHeight - 1);
      const start = Math.max(0, selected - listHeight + 1);
      const roster = profiles
        .slice(start, start + listHeight)
        .map((profile, index) =>
          theme.fg(
            start + index === selected ? "accent" : "text",
            `${start + index === selected ? ">" : " "} ${safe(profile.name).replaceAll("\n", " ")}`,
          ),
        );
      const lines = (
        profiles[selected] ? details(profiles[selected]) : ["No resolved profiles"]
      ).flatMap((text) =>
        safe(text)
          .split("\n")
          .flatMap((line) => wrapTextWithAnsi(line, rightWidth)),
      );
      maximum = Math.max(0, lines.length - viewport);
      offset = Math.min(maximum, offset);
      const detail = lines.slice(offset, offset + viewport);
      const body = wide
        ? Array.from(
            { length: bodyHeight },
            (_, index) =>
              cell(roster[index] ?? "", leftWidth) +
              theme.fg("border", " │ ") +
              cell(detail[index] ?? "", rightWidth),
          )
        : [
            ...roster,
            ...Array(Math.max(0, listHeight - roster.length)).fill(""),
            "─".repeat(inner),
            ...detail,
          ];
      const row = (text: string) =>
        theme.style(`│ ${cell(text, inner)} │`, { bg: theme.colors.customMessageBg });
      return [
        row(theme.fg("accent", "Subagent Profiles · resolved · read-only")),
        ...body.map(row),
        row(
          `${selected + (profiles.length ? 1 : 0)}/${profiles.length} · detail ${offset + 1}–${Math.min(lines.length, offset + viewport)}/${lines.length}`,
        ),
        row("↑↓ select · j/k scroll · PgUp/Dn · Home/End"),
        row(`${close}: close · callable tools unknown here`),
      ].slice(0, height);
    },
    handleInput(data) {
      if (keys.matches(data, "tui.select.cancel")) {
        done();
        return;
      }
      if (keys.matches(data, "tui.select.up") || keys.matches(data, "tui.select.down")) {
        selected = Math.max(
          0,
          Math.min(profiles.length - 1, selected + (keys.matches(data, "tui.select.up") ? -1 : 1)),
        );
        offset = 0;
      } else if (data === "j") offset = Math.min(maximum, offset + 1);
      else if (data === "k") offset = Math.max(0, offset - 1);
      else if (keys.matches(data, "tui.select.pageDown"))
        offset = Math.min(maximum, offset + viewport);
      else if (keys.matches(data, "tui.select.pageUp")) offset = Math.max(0, offset - viewport);
      else if (matchesKey(data, "home")) offset = 0;
      else if (matchesKey(data, "end")) offset = maximum;
      else return;
      requestRender();
    },
    invalidate() {},
  };
}
