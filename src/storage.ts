import { mkdir, readFile, rename, stat, writeFile, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { SessionManager, getAgentDir } from "@earendil-works/pi-coding-agent";
import { clean, validDirectory, type Catalog, type Session } from "./catalog.ts";
import { readCodex } from "./codex.ts";

export function configPath(): string { return join(getAgentDir(), "session-dock.json"); }
export async function loadDirectories(path = configPath()): Promise<string[]> {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    if (value.version !== 1 || !Array.isArray(value.directories) || !value.directories.every(validDirectory)) {
      throw new Error("Invalid session-dock.json; expected version 1 and absolute directories.");
    }
    return [...new Set<string>(value.directories)];
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}
export async function addDirectory(input: string, cwd: string, path = configPath()): Promise<string> {
  const expanded = input === "~" ? homedir() : input.startsWith("~/") ? join(homedir(), input.slice(2)) : input;
  const directory = resolve(cwd, expanded);
  await assertDirectory(directory);
  const directories = await loadDirectories(path);
  if (directories.includes(directory)) return directory;
  directories.push(directory);
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify({ version: 1, directories }, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    await rename(temp, path);
  } finally { await unlink(temp).catch(() => {}); }
  return directory;
}
export async function assertDirectory(cwd: string): Promise<void> {
  if (!validDirectory(cwd)) throw new Error("Invalid project directory.");
  try { if ((await stat(cwd)).isDirectory()) return; } catch { /* report actionable error */ }
  throw new Error(`Project directory is missing or inaccessible: ${clean(cwd)}. Restore it or add its new location.`);
}
export async function loadCatalog(currentSessionDir?: string): Promise<Catalog> {
  const codexHome = process.env.CODEX_HOME || join(homedir(), ".codex");
  const [codex, piResults, dirResults] = await Promise.all([
    readCodex(codexHome),
    (async () => {
      const sessions = await SessionManager.listAll();
      if (currentSessionDir) sessions.push(...await SessionManager.list(process.cwd(), currentSessionDir));
      return sessions;
    })().then(value => ({ value, error: "" }), () => ({ value: [], error: "Pi session index could not be read." })),
    loadDirectories().then(value => ({ value, error: "" }), e => ({ value: [], error: clean(e.message) })),
  ]);
  const piSessions: Session[] = piResults.value.map(s => ({
    provider: "pi", id: s.id, cwd: s.cwd, title: clean(s.name) || clean(s.firstMessage) || "New Pi session",
    file: s.path, updatedAt: s.modified.getTime(), preview: clean(s.firstMessage),
  }));
  return { sessions: [...piSessions, ...codex.sessions], directories: dirResults.value,
    warnings: [...codex.warnings, piResults.error, dirResults.error].filter(Boolean) };
}

// Create only a native header. Never fabricate an assistant turn to force persistence.
// switchSession then owns the file and performs Pi's normal project-trust lifecycle.
export async function createPiSession(cwd: string): Promise<{ file: string; header: string }> {
  await assertDirectory(cwd);
  const manager = SessionManager.create(cwd);
  const file = manager.getSessionFile()!;
  const header = JSON.stringify(manager.getHeader()) + "\n";
  await writeFile(file, header, { flag: "wx", mode: 0o600 });
  return { file, header };
}
export async function removeCancelledSession(created: { file: string; header: string }): Promise<void> {
  // Remove only our unchanged header, never an existing/now-used conversation.
  try { if (await readFile(created.file, "utf8") === created.header) await unlink(created.file); } catch { /* best effort */ }
}
