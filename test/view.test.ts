import { test } from "node:test";
import assert from "node:assert/strict";
import { KeybindingsManager, TUI_KEYBINDINGS, visibleWidth } from "@earendil-works/pi-tui";
import { stripVTControlCharacters } from "node:util";
import { DockView, type DockAction } from "../src/view.ts";
import { demoCatalog } from "../src/demo.ts";
import { testTheme } from "./helpers.ts";

function view(demo = false, rows = 36) {
  const actions: (DockAction | undefined)[] = [];
  const component = new DockView({ catalog: demoCatalog(), cwd: "/workspace/session-dock", theme: testTheme(),
    keybindings: new KeybindingsManager(TUI_KEYBINDINGS), rows: () => rows, repaint() {}, done: a => actions.push(a), demo });
  return { component, actions };
}
test("wide/narrow/CJK/emoji render never exceeds terminal width or height", () => {
  for (const width of [20, 38, 60, 85, 86, 100, 140]) for (const rows of [12, 22, 28, 36, 50]) {
    const { component } = view(false, rows);
    component.handleInput("\x1b[200~中文👩‍💻\x1b[201~");
    const lines = component.render(width);
    assert(lines.every(line => visibleWidth(line) <= width), `${width}×${rows} overflow`);
    assert(lines.length <= rows, `${width}×${rows} height overflow: ${lines.length}`);
  }
});
test("Tab + arrows select a Codex session; Enter returns typed action", () => {
  const { component, actions } = view();
  component.handleInput("\t"); component.handleInput("\x1b[B"); component.handleInput("\r");
  assert.equal(actions[0]?.type, "resume");
  assert.equal((actions[0] as Extract<DockAction, { type: "resume" }>).session.provider, "codex");
});
test("typing Chinese filters, Esc clears then closes", () => {
  const { component, actions } = view();
  component.handleInput("\x1b[200~接着\x1b[201~");
  assert.equal(component.query, "接着");
  assert.equal(component.selectedSession?.provider, "codex");
  component.handleInput("\x1b"); assert.equal(component.query, ""); assert.equal(actions.length, 0);
  component.handleInput("\x1b"); assert.equal(actions.length, 1); assert.equal(actions[0], undefined);
});
test("source filter cycles and new-session hotkeys retain selected cwd", () => {
  const { component, actions } = view();
  component.handleInput("\x06"); assert.equal(component.sourceFilter, "pi");
  component.handleInput("\x06"); assert.equal(component.sourceFilter, "codex");
  component.handleInput("\x0e"); assert.deepEqual(actions[0], { type: "new-pi", cwd: "/workspace/session-dock" });
  component.handleInput("\x0f"); assert.deepEqual(actions[1], { type: "new-codex", cwd: "/workspace/session-dock" });
});
test("demo cannot launch, refresh, add directories or modify sessions", () => {
  const { component, actions } = view(true);
  for (const key of ["\x0e", "\x0f", "\x07", "\x12", "\t", "\r"]) component.handleInput(key);
  assert.equal(actions.length, 0);
  assert(component.render(120).map(stripVTControlCharacters).join("\n").includes("actions disabled"));
});
test("narrow mode supports switching to sessions and retains hints", () => {
  const { component } = view(); component.handleInput("\t");
  const output = component.render(70).map(stripVTControlCharacters).join("\n");
  assert(output.includes("SESSIONS")); assert(output.includes("new Pi"));
});
