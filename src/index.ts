import { stat } from "node:fs/promises";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { BorderedLoader } from "@earendil-works/pi-coding-agent";
import type { Catalog } from "./catalog.ts";
import { clean } from "./catalog.ts";
import { addDirectory, assertDirectory, createPiSession, loadCatalog, removeCancelledSession } from "./storage.ts";
import { launchCodex } from "./launch.ts";
import { DockView, type DockAction } from "./view.ts";
import { demoCatalog } from "./demo.ts";

async function discover(ctx: ExtensionCommandContext): Promise<Catalog | undefined> {
  return ctx.ui.custom<Catalog | undefined>((tui, theme, _kb, done) => {
    const loader = new BorderedLoader(tui, theme, "Session Dock · reading local session indexes…");
    let closed = false;
    loader.onAbort = () => { closed = true; done(undefined); };
    // Capture before starting async work; no per-session references are used on completion.
    const sessionDir = ctx.sessionManager.getSessionDir();
    loadCatalog(sessionDir).then(result => {
      if (!closed) { closed = true; done(result); }
    }, error => {
      if (!closed) { closed = true; done({ sessions: [], directories: [], warnings: [clean(error.message)] }); }
    });
    return loader;
  });
}

export async function resumePi(ctx: ExtensionCommandContext, file: string, cwd: string): Promise<void> {
  await assertDirectory(cwd);
  // Avoid Pi's "missing file -> create" behavior for stale selections.
  if (!(await stat(file)).isFile()) throw new Error("Pi session file no longer exists.");
  const result = await ctx.switchSession(file, { withSession: async fresh => {
    fresh.ui.notify("Session Dock · resumed Pi session", "info");
  } });
  if (result.cancelled) ctx.ui.notify("Session switch cancelled.", "info");
}
async function newPi(ctx: ExtensionCommandContext, cwd: string): Promise<void> {
  const created = await createPiSession(cwd);
  try {
    const result = await ctx.switchSession(created.file, { withSession: async fresh => {
      fresh.ui.notify("Session Dock · new Pi session in " + clean(cwd), "info");
    } });
    if (result.cancelled) await removeCancelledSession(created);
  } catch (error) { await removeCancelledSession(created); throw error; }
}

export default function sessionDock(pi: ExtensionAPI) {
  // No background processes, network calls or session scanning at startup.
  pi.registerCommand("dock", {
    description: "Project + session dock for Pi and Codex (/dock demo for a safe preview)",
    getArgumentCompletions: prefix => ["demo", "add", "help"].filter(s => s.startsWith(prefix)).map(s => ({ value: s, label: s })),
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui") { ctx.ui.notify("Session Dock requires Pi's interactive terminal mode.", "warning"); return; }
      if (!ctx.isIdle() || ctx.hasPendingMessages()) { ctx.ui.notify("Wait for the current turn and queued messages to finish before opening Session Dock.", "warning"); return; }
      if (args.trim() === "help") {
        ctx.ui.notify("/dock [search] · /dock add <directory> · /dock demo\nTab: pane · ↑↓: move · Enter: open · ^F: source · ^H: archived\n^N: new Pi · ^O: new Codex · ^G: add folder · ^R: refresh", "info"); return;
      }
      try {
        if (args.trim().startsWith("add ")) {
          let directory = args.trim().slice(4).trim();
          if ((directory.startsWith('"') && directory.endsWith('"')) || (directory.startsWith("'") && directory.endsWith("'"))) directory = directory.slice(1, -1);
          if (!directory) return;
          await addDirectory(directory, ctx.cwd);
          args = "";
        }
        const demo = args.trim() === "demo";
        let query = demo ? "" : args.trim();
        while (true) {
          const catalog = demo ? demoCatalog() : await discover(ctx);
          if (!catalog) return;
          const action = await ctx.ui.custom<DockAction | undefined>((tui, theme, keybindings, done) => {
            const view = new DockView({ catalog, cwd: demo ? "/workspace/session-dock" : ctx.cwd,
              currentId: ctx.sessionManager.getSessionId(), theme, keybindings,
              rows: () => tui.terminal.rows, repaint: () => tui.requestRender(),
              done: action => { query = view.query; done(action); }, query, demo });
            return view;
          }, { overlay: true, overlayOptions: { width: "96%", maxHeight: "95%", anchor: "center" } });
          if (!action) return;
          if (action.type === "refresh") continue;
          if (action.type === "add") {
            const value = await ctx.ui.input("Add project directory", "Absolute path, ~/path, or a path relative to the current project");
            if (value?.trim()) { await addDirectory(value.trim(), ctx.cwd); query = ""; }
            continue;
          }
          if (action.type === "new-pi") { await newPi(ctx, action.cwd); return; }
          if (action.type === "new-codex") { await launchCodex(ctx, action.cwd); return; }
          if (action.type === "resume") {
            const session = action.session;
            if (session.provider === "codex") { await launchCodex(ctx, session.cwd, session.id); return; }
            if (!session.file) throw new Error("Pi session path is missing.");
            await resumePi(ctx, session.file, session.cwd); return;
          }
        }
      } catch (error) {
        // Commands return after replacement; successful switches never reuse old ctx/pi.
        ctx.ui.notify("Session Dock · " + clean((error as Error).message), "error");
      }
    },
  });
}
