import { basename, isAbsolute, normalize } from "node:path";
import { stripVTControlCharacters } from "node:util";

export type Provider = "pi" | "codex";
export interface Session {
  provider: Provider;
  id: string;
  cwd: string;
  title: string;
  updatedAt: number;
  file?: string;
  preview?: string;
  model?: string;
  archived?: boolean;
  source?: string;
}
export interface Catalog {
  sessions: Session[];
  directories: string[];
  warnings: string[];
}
export interface Project {
  cwd: string;
  name: string;
  sessions: Session[];
  updatedAt: number;
}
export type SourceFilter = "all" | Provider;

// Metadata is untrusted terminal input: strip ANSI/OSC, control and bidi chars.
export function clean(value: unknown, max = 300): string {
  return stripVTControlCharacters(typeof value === "string" ? value : "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, max);
}
export function directoryKey(cwd: string): string {
  // Do not realpath: worktrees and symlinked project identities remain distinct.
  return normalize(cwd);
}
export function validDirectory(cwd: unknown): cwd is string {
  return typeof cwd === "string" && isAbsolute(cwd) && !/[\u0000-\u001f\u007f]/.test(cwd);
}
export function projectName(cwd: string): string { return clean(basename(cwd) || cwd); }
export function compactPath(cwd: string, home: string): string {
  return clean(cwd === home ? "~" : cwd.startsWith(home + "/") ? "~" + cwd.slice(home.length) : cwd);
}
export function buildProjects(catalog: Catalog, query: string, filter: SourceFilter, archived: boolean, currentCwd: string): Project[] {
  const terms = clean(query).toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const groups = new Map<string, Project>();
  const add = (cwd: string) => {
    const key = directoryKey(cwd);
    if (!groups.has(key)) groups.set(key, { cwd: key, name: projectName(key), sessions: [], updatedAt: 0 });
    return groups.get(key)!;
  };
  for (const cwd of [...catalog.directories, currentCwd]) if (validDirectory(cwd)) add(cwd);
  const seen = new Set<string>();
  for (const session of catalog.sessions) {
    if (!validDirectory(session.cwd) || (filter !== "all" && session.provider !== filter) || (!archived && session.archived)) continue;
    const key = `${session.provider}:${session.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const project = add(session.cwd);
    project.sessions.push(session);
    project.updatedAt = Math.max(project.updatedAt, session.updatedAt);
  }
  return [...groups.values()].flatMap(project => {
    const pathMatch = terms.every(term => `${project.name} ${project.cwd}`.toLocaleLowerCase().includes(term));
    const sessions = pathMatch ? project.sessions : project.sessions.filter(s =>
      terms.every(term => `${project.cwd} ${s.title} ${s.id}`.toLocaleLowerCase().includes(term)));
    if (!pathMatch && !sessions.length) return [];
    // Keep manually added/current folders available even when empty.
    return [{ ...project, sessions: sessions.sort((a, b) => b.updatedAt - a.updatedAt) }];
  }).sort((a, b) => Number(b.cwd === directoryKey(currentCwd)) - Number(a.cwd === directoryKey(currentCwd)) || b.updatedAt - a.updatedAt || a.cwd.localeCompare(b.cwd));
}
export function relativeTime(time: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - time) / 60000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 1440)}d`;
}
