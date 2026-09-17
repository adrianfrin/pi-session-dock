import { open, readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { clean, validDirectory, type Session } from "./catalog.ts";

export const THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_THREADS = 10000;
export interface CodexCatalog { sessions: Session[]; warnings: string[] }
function timestamp(value: unknown): number {
  const n = typeof value === "number" ? value : Date.parse(String(value));
  return Number.isFinite(n) ? (n < 1e12 ? n * 1000 : n) : 0;
}
function isSubagent(source: unknown): boolean {
  if (typeof source === "object" && source) return "subagent" in source;
  return typeof source === "string" && /subagent/i.test(source);
}

export async function readCodex(home: string): Promise<CodexCatalog> {
  let entries;
  try { entries = await readdir(home); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { sessions: [], warnings: [] };
    return { sessions: [], warnings: ["Codex home could not be read."] };
  }
  const databases = entries.filter(name => /^state_\d+\.sqlite$/.test(name))
    .sort((a, b) => Number(b.match(/\d+/)![0]) - Number(a.match(/\d+/)![0]));
  let warning = "";
  if (databases.length) {
    try { return await readDatabase(join(home, databases[0])); }
    catch { warning = "Codex index unavailable/incompatible; using bounded rollout headers (titles may be incomplete)."; }
  }
  const result = await readRollouts(home);
  if (warning) result.warnings.unshift(warning);
  return result;
}

export async function readDatabase(path: string): Promise<CodexCatalog> {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 1000;");
    const cols = new Set((db.prepare("PRAGMA table_info(threads)").all() as { name: string }[]).map(c => c.name));
    for (const required of ["id", "cwd", "title", "updated_at"]) {
      if (!cols.has(required)) throw new Error(`Unsupported Codex schema: ${required}`);
    }
    // Only allow hard-coded identifiers. No SQL is constructed from session metadata.
    const optional = ["source", "archived", "rollout_path", "model", "name", "updated_at_ms"];
    const fields = ["id", "cwd", "substr(title, 1, 300) AS title", "updated_at",
      ...optional.filter(c => cols.has(c)),
      ...(cols.has("first_user_message") ? ["substr(first_user_message, 1, 300) AS preview"] : [])];
    const rows = db.prepare(`SELECT ${fields.join(", ")} FROM threads ORDER BY updated_at DESC LIMIT ${MAX_THREADS + 1}`).all();
    const sessions: Session[] = [];
    for (const row of rows.slice(0, MAX_THREADS)) {
      if (typeof row.id !== "string" || !THREAD_ID.test(row.id) || !validDirectory(row.cwd) || isSubagent(row.source)) continue;
      sessions.push({
        provider: "codex", id: row.id, cwd: row.cwd,
        title: clean(row.name) || clean(row.title) || "Untitled Codex session",
        updatedAt: timestamp(row.updated_at_ms ?? row.updated_at),
        file: typeof row.rollout_path === "string" ? row.rollout_path : undefined,
        model: clean(row.model), preview: clean(row.preview),
        archived: Boolean(row.archived), source: clean(row.source),
      });
    }
    return { sessions, warnings: rows.length > MAX_THREADS ? [`Codex index limited to ${MAX_THREADS} newest threads.`] : [] };
  } finally { db.close(); }
}

async function readRollouts(home: string): Promise<CodexCatalog> {
  const sessions: Session[] = [], warnings: string[] = [];
  const titles = new Map<string, string>();
  try {
    const index = join(home, "session_index.jsonl");
    if ((await stat(index)).size <= 8 * 1024 * 1024) {
      for (const line of (await readFile(index, "utf8")).split("\n")) {
        try { const row = JSON.parse(line); if (typeof row.id === "string") titles.set(row.id, clean(row.thread_name)); } catch { /* partial append */ }
      }
    }
  } catch { /* optional index */ }
  let visited = 0, unreadable = 0;
  async function scan(dir: string, archived: boolean, depth = 0): Promise<void> {
    if (depth > 5 || visited >= MAX_THREADS) return;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") unreadable++; return; }
    for (const entry of entries.sort((a, b) => b.name.localeCompare(a.name))) {
      if (visited >= MAX_THREADS) break;
      const file = join(dir, entry.name);
      if (entry.isDirectory()) { await scan(file, archived, depth + 1); continue; }
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      visited++;
      try {
        const handle = await open(file, "r");
        let text: string, modified: number;
        try {
          const buffer = Buffer.alloc(256 * 1024);
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
          text = buffer.subarray(0, bytesRead).toString("utf8");
          modified = (await handle.stat()).mtimeMs;
        } finally { await handle.close(); }
        const first = text.slice(0, text.indexOf("\n") < 0 ? text.length : text.indexOf("\n"));
        const record = JSON.parse(first), meta = record.payload;
        if (record.type !== "session_meta" || !meta || !THREAD_ID.test(meta.id) || !validDirectory(meta.cwd) || isSubagent(meta.source)) continue;
        sessions.push({ provider: "codex", id: meta.id, cwd: meta.cwd,
          title: titles.get(meta.id) || "Codex session " + meta.id.slice(0, 8),
          updatedAt: modified, file: resolve(file), archived, source: clean(meta.source) });
      } catch { unreadable++; }
    }
  }
  await scan(join(home, "sessions"), false);
  await scan(join(home, "archived_sessions"), true);
  if (visited >= MAX_THREADS) warnings.push(`Rollout scan limited to ${MAX_THREADS} files.`);
  if (unreadable) warnings.push(`${unreadable} Codex files/directories could not be read; partial results shown.`);
  return { sessions, warnings };
}
