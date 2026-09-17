import { spawnSync } from "node:child_process";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { THREAD_ID } from "./codex.ts";
import { assertDirectory } from "./storage.ts";
import { clean, validDirectory } from "./catalog.ts";

export function codexArgs(cwd: string, id?: string): string[] {
  if (!validDirectory(cwd)) throw new Error("Invalid Codex working directory.");
  if (id !== undefined && !THREAD_ID.test(id)) throw new Error("Invalid Codex thread ID.");
  return id ? ["resume", id, "--cd", cwd] : ["--cd", cwd];
}
export async function launchCodex(ctx: ExtensionCommandContext, cwd: string, id?: string): Promise<void> {
  await assertDirectory(cwd);
  const args = codexArgs(cwd, id);
  const ready = spawnSync("codex", ["--version"], { encoding: "utf8", timeout: 5000, windowsHide: true });
  if (ready.error || ready.status !== 0) throw new Error("Codex CLI is unavailable. Install it and run `codex login` first.");
  const confirmed = await ctx.ui.confirm(id ? "Continue original Codex thread?" : "Start Codex in this directory?",
    `${clean(cwd)}\n${id ? `Thread: ${id}\n` : ""}Pi will pause; Codex CLI takes over this terminal. Quit Codex to return to Pi.\nStop this thread in Codex App first — simultaneous writers are NOT detected.\nCodex's own authentication, sandbox and approval settings apply.`);
  if (!confirmed) return;
  const result = await ctx.ui.custom<{ status: number | null; error?: string }>((tui, _theme, _kb, done) => {
    let outcome: { status: number | null; error?: string } = { status: null };
    tui.stop();
    try {
      process.stdout.write("\x1b[2J\x1b[H");
      // No shell, no prompt, no bypass flags. Native Codex alone writes its history.
      const child = spawnSync("codex", args, { cwd, stdio: "inherit", env: process.env });
      outcome = { status: child.status, error: child.error?.message ?? (child.signal ? `signal ${child.signal}` : undefined) };
    } catch (e) { outcome.error = (e as Error).message; }
    finally { tui.start(); tui.requestRender(true); }
    done(outcome);
    return { render: () => [], invalidate() {} };
  });
  if (result?.error || (result && result.status !== 0)) {
    ctx.ui.notify(`Codex returned: ${clean(result.error || `exit ${result.status}`)}. Pi session is unchanged.`, "warning");
  } else ctx.ui.notify("Back in Pi. Codex history stays in Codex; Pi session is unchanged.", "info");
}
