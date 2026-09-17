import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { launchCodex } from "../src/launch.ts";

test("native handoff uses argv and restores terminal on success/failure; cancel never launches", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dock-launch-"));
  const oldPath = process.env.PATH;
  const oldArgs = process.env.DOCK_TEST_ARGS;
  const oldExit = process.env.DOCK_TEST_EXIT;
  const calls: string[] = [], notices: string[] = [];
  let confirm = true;
  const ctx = { ui: {
    confirm: async () => confirm,
    notify: (message: string) => notices.push(message),
    custom: async (factory: Function) => {
      let value;
      factory({ stop: () => calls.push("stop"), start: () => calls.push("start"), requestRender: () => calls.push("render") }, {}, {}, (v: unknown) => { value = v; });
      return value;
    },
  } } as unknown as ExtensionCommandContext;
  try {
    await writeFile(join(dir, "codex"), '#!/bin/sh\nif [ "$1" = "--version" ]; then exit 0; fi\nprintf "%s\\n" "$@" > "$DOCK_TEST_ARGS"\nexit "${DOCK_TEST_EXIT:-0}"\n', { mode: 0o700 });
    process.env.PATH = dir;
    process.env.DOCK_TEST_ARGS = join(dir, "args.txt");
    const id = "12345678-1234-4567-8900-123456789abc";
    await launchCodex(ctx, dir, id);
    assert.deepEqual((await readFile(process.env.DOCK_TEST_ARGS, "utf8")).trim().split("\n"), ["resume", id, "--cd", dir]);
    assert.deepEqual(calls, ["stop", "start", "render"]);
    process.env.DOCK_TEST_EXIT = "42";
    await launchCodex(ctx, dir, id);
    assert(notices.at(-1)?.includes("exit 42"));
    assert.deepEqual(calls.slice(-3), ["stop", "start", "render"]);
    confirm = false;
    await launchCodex(ctx, dir, id);
    assert.equal(calls.length, 6);
    process.env.PATH = join(dir, "missing");
    await assert.rejects(launchCodex(ctx, dir, id), /unavailable/);
  } finally {
    for (const [key, value] of [["PATH", oldPath], ["DOCK_TEST_ARGS", oldArgs], ["DOCK_TEST_EXIT", oldExit]]) {
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
    }
    await rm(dir, { recursive: true, force: true });
  }
});
