import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addDirectory, loadDirectories, assertDirectory, createPiSession, removeCancelledSession } from "../src/storage.ts";
import { SessionManager } from "@earendil-works/pi-coding-agent";

test("folder registry validates existing directories, deduplicates and preserves corrupt config", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dock-config-"));
  const path = join(dir, "settings.json");
  try {
    await addDirectory(dir, dir, path); await addDirectory(dir, dir, path);
    assert.deepEqual(await loadDirectories(path), [dir]);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    await assert.rejects(assertDirectory(join(dir, "missing")));
    await writeFile(path, "broken");
    await assert.rejects(addDirectory(dir, dir, path));
    assert.equal(await readFile(path, "utf8"), "broken");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("new Pi header preserves target cwd and can be opened by native SessionManager", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dock-pi-"));
  const old = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
  try {
    const created = await createPiSession(dir);
    const loaded = SessionManager.open(created.file);
    assert.equal(loaded.getCwd(), dir);
    assert.equal(loaded.getEntries().length, 0);
    await removeCancelledSession(created);
    await assert.rejects(stat(created.file));
    const retained = await createPiSession(dir);
    await writeFile(retained.file, retained.header + "{some-new-data}\n");
    await removeCancelledSession(retained);
    assert((await stat(retained.file)).isFile());
  } finally {
    if (old === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = old;
    await rm(dir, { recursive: true, force: true });
  }
});
