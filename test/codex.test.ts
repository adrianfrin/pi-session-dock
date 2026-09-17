import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readCodex, readDatabase } from "../src/codex.ts";
const id = "12345678-1234-4567-8900-123456789abc";

test("SQLite reader handles app/CLI titles, ms, archived, and excludes subagents; no writes", async () => {
  const home = await mkdtemp(join(tmpdir(), "dock-sqlite-"));
  try {
    const path = join(home, "state_5.sqlite"), db = new DatabaseSync(path);
    db.exec("CREATE TABLE threads (id TEXT, cwd TEXT, title TEXT, updated_at INTEGER, updated_at_ms INTEGER, source TEXT, archived INTEGER, name TEXT, model TEXT)");
    const insert = db.prepare("INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    insert.run(id, "/project", "original", 1700000000, 1700000000123, "vscode", 0, "Renamed in App", "gpt-test");
    insert.run(id.slice(0, -1) + "d", "/project", "archive", 1700000001, null, "cli", 1, "", "");
    insert.run(id.slice(0, -1) + "e", "/project", "guardian", 1700000002, null, '{"subagent":{"other":"guardian"}}', 0, "", "");
    db.close();
    const before = await readFile(path);
    const result = await readDatabase(path);
    assert.equal(result.sessions.length, 2);
    assert.equal(result.sessions[0].archived, true);
    assert.equal(result.sessions[1].title, "Renamed in App");
    assert.equal(result.sessions[1].updatedAt, 1700000000123);
    assert.deepEqual(await readFile(path), before);
  } finally { await rm(home, { recursive: true, force: true }); }
});
test("old minimal schema works; malformed IDs and relative cwds are skipped", async () => {
  const home = await mkdtemp(join(tmpdir(), "dock-old-"));
  try {
    const path = join(home, "state_1.sqlite"), db = new DatabaseSync(path);
    db.exec("CREATE TABLE threads (id TEXT, cwd TEXT, title TEXT, updated_at INTEGER)");
    const q = db.prepare("INSERT INTO threads VALUES (?, ?, ?, ?)");
    q.run(id, "/project", "Old", 1700000000); q.run("--bad", "/project", "Bad", 0); q.run(id, "relative", "Bad", 0);
    db.close();
    const result = await readCodex(home);
    assert.equal(result.sessions.length, 1);
    assert.equal(result.sessions[0].updatedAt, 1700000000000);
  } finally { await rm(home, { recursive: true, force: true }); }
});
test("missing Codex home is an empty source, not an error", async () => {
  assert.deepEqual(await readCodex(join(tmpdir(), "dock-no-such-home-123456")), { sessions: [], warnings: [] });
});
test("corrupt database falls back to bounded rollout headers + index; source files unchanged", async () => {
  const home = await mkdtemp(join(tmpdir(), "dock-rollout-"));
  try {
    await writeFile(join(home, "state_99.sqlite"), "not sqlite");
    const dir = join(home, "sessions", "2026", "09", "17"); await mkdir(dir, { recursive: true });
    const content = JSON.stringify({ type: "session_meta", payload: { id, cwd: "/project", source: "vscode" } }) + "\n{partial";
    const file = join(dir, "rollout.jsonl"); await writeFile(file, content);
    await writeFile(join(dir, "bad.jsonl"), "broken\n");
    await writeFile(join(home, "session_index.jsonl"), JSON.stringify({ id, thread_name: "中文 App 标题" }) + "\n{partial");
    const result = await readCodex(home);
    assert.equal(result.sessions.length, 1);
    assert.equal(result.sessions[0].title, "中文 App 标题");
    assert(result.warnings.length >= 1);
    assert.equal(await readFile(file, "utf8"), content);
  } finally { await rm(home, { recursive: true, force: true }); }
});
