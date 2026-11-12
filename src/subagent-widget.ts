import {
  sliceByColumn,
  truncateToWidth,
  visibleWidth,
  type Component,
} from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ChildSnapshot } from "./coordinator.ts";
import { active, activity, assignmentHeadline, lineText, statuses } from "./task-presentation.ts";

/** Event-driven, bounded current-agent tree; history and full metrics remain in the Hub. */
export function createChildWidget(
  snapshot: () => ChildSnapshot[],
  theme: Pick<Theme, "fg"> & Partial<Pick<Theme, "bold">>,
  availableRows = () => 30,
): Component {
  return {
    render(width) {
      width = Math.max(0, width);
      const children = snapshot();
      if (!children.length) return [];
      const queued = children.filter((child) => child.status === "queued").length;
      const priority = (child: ChildSnapshot) =>
        child.status === "draining" || child.status === "pausing"
          ? 0
          : child.status === "running"
            ? 1
            : child.status === "setup"
              ? 2
              : 3;
      const live = children
        .filter(
          (child) =>
            !child.disposed &&
            (child.status === "setup" ||
              child.status === "running" ||
              child.status === "draining" ||
              child.status === "pausing"),
        )
        .sort((a, b) => priority(a) - priority(b));
      const budget = Math.max(1, Math.min(5, Math.floor(availableRows() / 4)));
      const counts =
        width < 60
          ? `${live.filter(active).length} active · ${children.filter((child) => child.status === "paused").length} paused · ${queued} queued`
          : statuses
              .flatMap((status) => {
                const count = children.filter((child) => child.status === status).length;
                return count ? [`${count} ${status}`] : [];
              })
              .join(" · ");
      const rows = [
        theme.fg("accent", `● Subagents ${children.length}`) + theme.fg("muted", ` · ${counts}`),
      ];
      const room = Math.max(0, budget - 1);
      const activityRows = live.length && room >= (live.length > 1 ? 3 : 2) ? 1 : 0;
      const slots = room - activityRows;
      const overflow = live.length > slots;
      const shown = live.slice(0, Math.max(0, slots - (overflow ? 1 : 0)));
      shown.forEach((child, index) => {
        const last = index === shown.length - 1 && shown.length === live.length;
        const color =
          child.status === "draining" || child.status === "pausing" ? "warning" : "accent";
        const role = lineText(child.profile);
        const indent = "  ".repeat(Math.min(3, Math.max(0, child.depth - 1)));
        const prefix =
          theme.fg("muted", `${indent}${last ? "└─" : "├─"} `) +
          theme.fg(color, "● ") +
          (theme.bold?.(role) ?? role) +
          " ";
        const elapsed = Math.max(
          0,
          Math.floor(((child.endedAt ?? Date.now()) - child.createdAt) / 1000),
        );
        const stats = [
          child.status,
          `${elapsed}s`,
          `${child.toolCalls} tools`,
          ...(child.telemetry.requests === null ? [] : [`${child.telemetry.requests} req`]),
          ...(child.telemetry.tokens ? [`${child.telemetry.tokens.total} tok`] : []),
          ...(child.telemetry.cost === null ? [] : [`$${child.telemetry.cost.toFixed(3)}`]),
        ].join(" · ");
        const metric = truncateToWidth(stats, Math.max(8, Math.floor(width / 2)));
        const headline = assignmentHeadline(child);
        rows.push(
          prefix +
            theme.fg(
              "text",
              truncateToWidth(
                headline,
                Math.max(4, width - visibleWidth(prefix) - visibleWidth(metric) - 3),
              ),
            ) +
            theme.fg("muted", " · " + metric),
        );
        if (!index && activityRows) {
          const prefix = `${indent}${last ? "   " : "│  "} └ `;
          const text = lineText(activity(child));
          const columns = Math.max(0, width - visibleWidth(prefix));
          const length = visibleWidth(text);
          // Progress is an accumulated tail; keep its newest text, not a frozen opening paragraph.
          const preview =
            length > columns
              ? "…" +
                sliceByColumn(text, length - Math.max(0, columns - 1), Math.max(0, columns - 1))
              : text;
          rows.push(theme.fg("muted", prefix + preview));
        }
      });
      if (shown.length < live.length && room)
        rows.push(theme.fg("muted", `└─ ${live.length - shown.length} more · /subagent-hub`));
      return rows.slice(0, budget).map((line) => truncateToWidth(line, width));
    },
    invalidate() {},
  };
}
