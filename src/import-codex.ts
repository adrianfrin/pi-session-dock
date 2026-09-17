import { open, writeFile } from "node:fs/promises";
import { SessionManager, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { Session } from "./catalog.ts";
import { clean } from "./catalog.ts";
import { createPiSession, removeCancelledSession } from "./storage.ts";

const MAX_BYTES = 32 * 1024 * 1024;
export interface ImportedTurn { role: "user" | "assistant"; text: string; timestamp: number }
export interface Transcript { turns: ImportedTurn[]; warnings: string[] }

// Only conversation text crosses runtimes. Never replay Codex tools or import its instructions/auth.
export function parseCodexTranscript(text: string, session: Pick<Session, "id" | "cwd">): Transcript {
  const lines = text.split("\n");
  const records: any[] = [];
  let partial = false;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    try { records.push(JSON.parse(lines[i])); }
    catch {
      if (i === lines.length - 1 && !text.endsWith("\n")) { partial = true; continue; }
      throw new Error("Malformed Codex history; import stopped without changing the source.");
    }
  }
  const meta = records[0];
  if (meta?.type !== "session_meta" || meta.payload?.id !== session.id || meta.payload?.cwd !== session.cwd) {
    throw new Error("Codex history does not match the selected session/project.");
  }
  if (records.some(r => r?.type === "event_msg" && r.payload?.type === "thread_rolled_back")) {
    throw new Error("This Codex history contains rollbacks. Use native Codex recovery instead.");
  }
  const turns: ImportedTurn[] = [];
  let omitted = false;
  for (const r of records) {
    const p = r?.payload;
    if (r?.type !== "response_item") continue;
    if (p?.type !== "message" || !["user", "assistant"].includes(p.role)) { omitted = true; continue; }
    if (!Array.isArray(p.content)) { omitted = true; continue; }
    const chunks: string[] = [];
    for (const c of p.content) {
      if (["input_text", "output_text", "text"].includes(c?.type) && typeof c.text === "string") chunks.push(c.text);
      else omitted = true;
    }
    const text = chunks.join("\n");
    if (text.trim()) turns.push({ role: p.role, text, timestamp: Date.parse(r.timestamp) || 0 });
  }
  if (!turns.length) throw new Error("No supported conversation text in this Codex history. Use native Codex recovery.");
  const warnings = ["Text-only fork: tools, images, reasoning, approvals and Codex execution state are not restored."];
  if (omitted) warnings.push("Unsupported records/content were omitted.");
  if (partial) warnings.push("An incomplete trailing record was skipped; stop the source conversation before importing for a stable snapshot.");
  if (records.some(r => r?.type === "compacted")) warnings.push("Codex compaction checkpoints were not imported; available conversation text is retained instead.");
  return { turns, warnings };
}

export async function readCodexTranscript(session: Session): Promise<Transcript> {
  if (!session.file) throw new Error("No local Codex history path. Native Codex recovery is still available.");
  const handle = await open(session.file, "r");
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > MAX_BYTES) throw new Error("Codex history must be a regular file no larger than 32 MiB.");
    // Snapshot the original size, with a hard bound even if the live file grows.
    const buffer = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    return parseCodexTranscript(buffer.subarray(0, offset).toString("utf8"), session);
  } finally { await handle.close(); }
}

export async function createImportedSession(session: Session, transcript: Transcript, modelId: string, thinkingLevel: Parameters<SessionManager["appendThinkingLevelChange"]>[0]) {
  const manager = SessionManager.inMemory(session.cwd);
  manager.appendSessionInfo("[Codex → Pi] " + clean(session.title));
  manager.appendCustomMessageEntry("session-dock-import", `Historical text imported from Codex ${session.id}. This is a separate Pi fork, not a live Codex session.\n${transcript.warnings.join("\n")}`, true, { sourceId: session.id, sourceFile: session.file });
  for (const turn of transcript.turns) {
    if (turn.role === "user") manager.appendMessage({ role: "user", content: turn.text, timestamp: turn.timestamp });
    else manager.appendMessage({ role: "assistant", content: [{ type: "text", text: turn.text }], timestamp: turn.timestamp,
      api: "openai-codex-responses", provider: "codex-history", model: "imported-text", stopReason: "stop",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
  }
  // Explicitly persist the Pi provider; imported assistant metadata must not select the runtime.
  manager.appendModelChange("openai-codex", modelId);
  manager.appendThinkingLevelChange(thinkingLevel);
  const created = await createPiSession(session.cwd);
  const content = created.header + manager.getEntries().map(e => JSON.stringify(e)).join("\n") + "\n";
  try { await writeFile(created.file, content, { mode: 0o600 }); }
  catch (error) { await removeCancelledSession(created); throw error; }
  return { file: created.file, header: content };
}

export async function continueCodexInPi(ctx: ExtensionCommandContext, session: Session): Promise<void> {
  const available = ctx.modelRegistry.getAvailable().filter(m => m.provider === "openai-codex");
  let model = available.find(m => m.id === ctx.model?.id && ctx.model?.provider === "openai-codex");
  if (!model) {
    if (!available.length) throw new Error("Log in to ChatGPT Plus/Pro (Codex) with Pi /login first.");
    const selected = await ctx.ui.select("Continue with Pi's OpenAI account · model", available.map(m => m.id));
    if (!selected) return;
    model = available.find(m => m.id === selected)!;
  }
  const transcript = await readCodexTranscript(session);
  if (!await ctx.ui.confirm("在 Pi 中继续 · Create an independent fork", `${transcript.turns.length} text messages → openai-codex/${model.id} using Pi authentication.\nOriginal Codex history/account stays unchanged. No prompt is sent automatically.\n${transcript.warnings.join("\n")}\nLarge histories may require /compact before continuing.`)) return;
  const created = await createImportedSession(session, transcript, model.id, ctx.thinkingLevel ?? "off");
  let switched = false;
  try {
    const result = await ctx.switchSession(created.file, { withSession: async fresh => {
      switched = true;
      fresh.ui.notify("Session Dock · Codex text imported into Pi. Continue with Pi's openai-codex account; original history unchanged.", "info");
    } });
    if (result.cancelled) await removeCancelledSession(created);
  } catch (error) { if (!switched) await removeCancelledSession(created); throw error; }
}
