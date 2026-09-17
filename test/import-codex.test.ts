import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { parseCodexTranscript, readCodexTranscript, createImportedSession, continueCodexInPi } from "../src/import-codex.ts";
import { removeCancelledSession } from "../src/storage.ts";
import type { Session } from "../src/catalog.ts";

const session: Session = { provider: "codex", id: "00000000-0000-0000-0000-000000000001", cwd: "/tmp", title: "历史", updatedAt: 0 };
function history(cwd = session.cwd) {
  return [
    { type: "session_meta", payload: { id: session.id, cwd } },
    { type: "response_item", payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "do not import instructions" }] } },
    { type: "event_msg", payload: { type: "user_message", message: "你好" } },
    { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "你好" }, { type: "input_image", image_url: "secret" }] } },
    { type: "response_item", payload: { type: "function_call", name: "bash", arguments: "dangerous" } },
    { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Hello\n世界" }] } },
  ].map(r => JSON.stringify(r)).join("\n") + "\n";
}
test("imports text roles once, omits tools/instructions/images and reports losses", () => {
  const result = parseCodexTranscript(history(), session);
  assert.deepEqual(result.turns.map(t => [t.role, t.text]), [["user", "你好"], ["assistant", "Hello\n世界"]]);
  assert(result.warnings.some(w => w.includes("omitted")));
  assert(!JSON.stringify(result).includes("dangerous"));
});
test("fails closed for mismatched identity/project, malformed records and rollback; tolerates partial tail", () => {
  assert.throws(() => parseCodexTranscript(history(), { ...session, id: "other" }), /match/);
  assert.throws(() => parseCodexTranscript(history("/other"), session), /match/);
  assert.throws(() => parseCodexTranscript(history() + "broken\n", session), /Malformed/);
  assert.throws(() => parseCodexTranscript(history() + JSON.stringify({ type: "event_msg", payload: { type: "thread_rolled_back" } }), session), /rollbacks/);
  assert(parseCodexTranscript(history() + '{"partial":', session).warnings.some(w => w.includes("trailing")));
});
test("native Pi session preserves text context, uses Pi model, leaves source untouched and cleans cancelled forks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dock-import-"));
  const old = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
  try {
    const source = { ...session, cwd: dir, file: join(dir, "rollout.jsonl") };
    const original = history(dir);
    await writeFile(source.file, original);
    const transcript = await readCodexTranscript(source);
    const created = await createImportedSession(source, transcript, "gpt-5.4", "high");
    const loaded = SessionManager.open(created.file);
    assert.equal(loaded.getCwd(), dir);
    assert.equal(loaded.getSessionName(), "[Codex → Pi] 历史");
    const context = loaded.buildSessionContext();
    assert.deepEqual(context.model, { provider: "openai-codex", modelId: "gpt-5.4" });
    assert.equal(context.thinkingLevel, "high");
    assert(context.messages.some(m => m.role === "user" && m.content === "你好"));
    assert(context.messages.some(m => m.role === "assistant"));
    assert(!context.messages.some(m => m.role === "toolResult"));
    assert.equal((await stat(created.file)).mode & 0o777, 0o600);
    assert.equal(await readFile(source.file, "utf8"), original);
    await removeCancelledSession(created);
    await assert.rejects(stat(created.file));
    let attemptedFile = "";
    const ctx = {
      model: { provider: "openai-codex", id: "gpt-5.4" }, thinkingLevel: "high",
      modelRegistry: { getAvailable: () => [{ provider: "openai-codex", id: "gpt-5.4" }] },
      ui: { confirm: async () => true },
      switchSession: async (file: string) => { attemptedFile = file; return { cancelled: true }; },
    };
    await continueCodexInPi(ctx as any, source);
    assert(attemptedFile);
    await assert.rejects(stat(attemptedFile));
    attemptedFile = "";
    ctx.ui.confirm = async () => false;
    await continueCodexInPi(ctx as any, source);
    assert.equal(attemptedFile, "");
    assert.equal(await readFile(source.file, "utf8"), original);
    const retained = await createImportedSession(source, transcript, "gpt-5.4", "off");
    await writeFile(retained.file, retained.header + "\n");
    await removeCancelledSession(retained);
    assert((await stat(retained.file)).isFile());
  } finally {
    if (old === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = old;
    await rm(dir, { recursive: true, force: true });
  }
});
test("missing Pi auth fails before reading source or launching anything", async () => {
  await assert.rejects(continueCodexInPi({ modelRegistry: { getAvailable: () => [] } } as any, session), /Pi \/login/);
});
