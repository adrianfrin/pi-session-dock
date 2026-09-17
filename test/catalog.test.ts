import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProjects, clean, compactPath, relativeTime } from "../src/catalog.ts";
import { demoCatalog } from "../src/demo.ts";
import { codexArgs } from "../src/launch.ts";

test("groups both providers by exact directory; current project comes first", () => {
  const projects = buildProjects(demoCatalog(), "", "all", false, "/workspace/api-gateway");
  assert.equal(projects[0].cwd, "/workspace/api-gateway");
  assert.equal(projects.find(p => p.name === "session-dock")!.sessions.length, 4);
});
test("Chinese title search, paths and IDs work", () => {
  for (const query of ["接着 Codex", "workspace/session-dock", "000000000001"]) {
    const projects = buildProjects(demoCatalog(), query, "all", false, "/empty");
    assert.equal(projects[0].name, "session-dock");
  }
});
test("source + archive filters; duplicates do not multiply sessions", () => {
  const catalog = demoCatalog();
  catalog.sessions.push(catalog.sessions[0]);
  catalog.sessions[1].archived = true;
  const filtered = buildProjects(catalog, "", "codex", false, "/empty").flatMap(p => p.sessions);
  assert(filtered.every(s => s.provider === "codex" && !s.archived));
  assert.equal(buildProjects(catalog, "", "all", true, "/empty").flatMap(p => p.sessions).length, 12);
});
test("empty directories survive filters; missing query returns no matches", () => {
  assert(buildProjects({ directories: ["/new"], sessions: [], warnings: [] }, "", "codex", false, "/current").some(p => p.cwd === "/new"));
  assert.equal(buildProjects(demoCatalog(), "zzzzz", "all", false, "/current").length, 0);
});
test("untrusted metadata cannot emit control sequences, bidi, or OSC clipboard", () => {
  assert.equal(clean("\x1b[31mhello\x1b[0m\x1b]52;c;evil\x07\nworld\u202e"), "hello world");
  assert.equal(clean("x".repeat(500)).length, 300);
  assert.equal(compactPath("/home/test2/repo", "/home/test"), "/home/test2/repo");
  assert.equal(compactPath("/home/test/repo", "/home/test"), "~/repo");
});
test("safe argv preserves special paths and never injects prompt or shell flags", () => {
  const cwd = "/tmp/a b/'$(touch nope)'";
  const id = "12345678-1234-4567-8900-123456789abc";
  assert.deepEqual(codexArgs(cwd, id), ["resume", id, "--cd", cwd]);
  assert.deepEqual(codexArgs(cwd), ["--cd", cwd]);
  assert.throws(() => codexArgs("relative"));
  assert.throws(() => codexArgs(cwd, "--dangerously-bypass-approvals-and-sandbox"));
});
test("relative timestamps handle future clock skew", () => {
  assert.equal(relativeTime(200, 100), "now");
  assert.equal(relativeTime(0, 7200000), "2h");
});
