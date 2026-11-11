import { compile, type Validator } from "@earendil-works/pi-schema";
import { Type } from "typebox";
import { link, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/** Deliberately finite JSON Schema subset: no references, regexes or executable extensions. */
export function resultValidator(schema: unknown): Validator {
  if (JSON.stringify(schema)?.length > 16384) throw new Error("Result schema exceeds 16384 characters");
  let nodes = 0;
  function visit(value: unknown, depth: number): void {
    if (++nodes > 256 || depth > 16) throw new Error("Result schema complexity limit");
    if (typeof value === "boolean") return;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Result schema must be an object or boolean");
    const node = value as Record<string, unknown>;
    for (const [key, item] of Object.entries(node)) {
      if (key === "properties") {
        if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Schema properties must be an object");
        for (const child of Object.values(item)) visit(child, depth + 1);
      } else if (key === "items" || key === "additionalProperties") visit(item, depth + 1);
      else if (key === "type") {
        if (!["object", "array", "string", "number", "integer", "boolean", "null"].includes(item as string)) throw new Error("Unsupported result schema type");
      } else if (["title", "description"].includes(key)) {
        if (typeof item !== "string") throw new Error(`Schema ${key} must be text`);
      } else if (key === "required") {
        if (!Array.isArray(item) || !item.every(v => typeof v === "string") || new Set(item).size !== item.length) throw new Error("Schema required must contain distinct strings");
      } else if (key === "enum") {
        if (!Array.isArray(item) || !item.length) throw new Error("Schema enum must be nonempty");
      } else if (key === "const") { /* JSON literal; never interpreted as a schema */ }
      else if (["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "minItems", "maxItems", "minProperties", "maxProperties"].includes(key)) {
        if (typeof item !== "number" || !Number.isFinite(item) || (key === "multipleOf" && item <= 0) || ((key.startsWith("min") && key !== "minimum" || key.startsWith("max") && key !== "maximum") && (!Number.isSafeInteger(item) || item < 0))) throw new Error(`Invalid schema bound: ${key}`);
      } else throw new Error(`Unsupported result schema keyword: ${key}`);
    }
  }
  visit(schema, 0);
  return compile(schema as object | boolean);
}

export const submissionParameters = Type.Object({ value: Type.Unknown() }, { additionalProperties: false });
export type StructuredOutcome = { validation: "awaiting" | "invalid" | "submitted"; attempts: number; errors: string[]; value?: unknown; finalized: boolean };

/** Atomic, exclusive publication; callers supply only fixed names inside a newly owned task directory. */
export async function saveOutcomeArtifact(directory: string, name: "result.txt" | "structured.json", content: string): Promise<string> {
  if (name !== "result.txt" && name !== "structured.json") throw new Error("Unsupported outcome artifact filename");
  const target = join(directory, name);
  const temporary = join(directory, `.outcome-${randomUUID()}`);
  await writeFile(temporary, content, { flag: "wx", mode: 0o600 });
  try { await link(temporary, target); }
  finally { await unlink(temporary); }
  return target;
}

export function clippedText(text: string, maximum = 2048): string {
  return text.length > maximum ? text.slice(0, maximum) + "\n[Preview truncated; full output in artifact/transcript]" : text;
}
