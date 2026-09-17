import type { Theme } from "@earendil-works/pi-coding-agent";
import { Input, matchesKey, truncateToWidth, visibleWidth, type Component, type Focusable, type KeybindingsManager } from "@earendil-works/pi-tui";
import { homedir } from "node:os";
import { buildProjects, clean, compactPath, relativeTime, type Catalog, type Project, type Session, type SourceFilter } from "./catalog.ts";

export type DockAction = { type: "resume"; session: Session } | { type: "new-pi" | "new-codex"; cwd: string } | { type: "add" | "refresh" };
export interface ViewOptions {
  catalog: Catalog;
  cwd: string;
  currentId?: string;
  theme: Theme;
  keybindings: KeybindingsManager;
  rows: () => number;
  repaint: () => void;
  done: (action: DockAction | undefined) => void;
  query?: string;
  demo?: boolean;
}
const pad = (s: string, width: number) => {
  const clipped = truncateToWidth(s, Math.max(0, width), "…");
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
};

export class DockView implements Component, Focusable {
  private input: Input;
  private pane: "projects" | "sessions" = "projects";
  private projectIndex = 0;
  private sessionIndex = 0;
  private filter: SourceFilter = "all";
  private archived = false;
  private projects: Project[] = [];
  private visibleItems = 6;
  private note = "";
  private _focused = false;
  get focused() { return this._focused; }
  set focused(value: boolean) { this._focused = value; this.input.focused = value; }
  constructor(private options: ViewOptions) {
    this.input = new Input({ prompt: "", placeholder: "project, title or session ID…", placeholderStyle: text => options.theme.fg("dim", text) });
    this.input.setValue(options.query || "");
    this.rebuild();
  }
  get selectedProject(): Project | undefined { return this.projects[this.projectIndex]; }
  get selectedSession(): Session | undefined { return this.selectedProject?.sessions[this.sessionIndex]; }
  get sourceFilter() { return this.filter; }
  get query() { return this.input.getValue(); }
  invalidate() { this.input.invalidate(); }
  private rebuild() {
    this.projects = buildProjects(this.options.catalog, this.input.getValue(), this.filter, this.archived, this.options.cwd);
    this.projectIndex = Math.min(this.projectIndex, Math.max(0, this.projects.length - 1));
    this.sessionIndex = Math.min(this.sessionIndex, Math.max(0, (this.selectedProject?.sessions.length ?? 0) - 1));
  }
  private finish(action: DockAction) {
    if (this.options.demo) { this.note = "DEMO · actions disabled; /dock opens your real local sessions"; return; }
    this.options.done(action);
  }
  handleInput(data: string) {
    const kb = this.options.keybindings;
    if (matchesKey(data, "ctrl+c")) { this.options.done(undefined); return; }
    if (kb.matches(data, "tui.select.cancel")) {
      if (this.input.getValue()) { this.input.setValue(""); this.projectIndex = this.sessionIndex = 0; this.rebuild(); }
      else { this.options.done(undefined); return; }
    } else if (matchesKey(data, "tab") || matchesKey(data, "shift+tab")) {
      this.pane = this.pane === "projects" ? "sessions" : "projects";
    } else if (matchesKey(data, "ctrl+f")) {
      this.filter = this.filter === "all" ? "pi" : this.filter === "pi" ? "codex" : "all";
      this.projectIndex = this.sessionIndex = 0; this.rebuild();
    } else if (matchesKey(data, "ctrl+h")) {
      this.archived = !this.archived; this.rebuild();
    } else if (matchesKey(data, "ctrl+r")) this.finish({ type: "refresh" });
    else if (matchesKey(data, "ctrl+g")) this.finish({ type: "add" });
    else if (matchesKey(data, "ctrl+n") || matchesKey(data, "ctrl+o")) {
      if (this.selectedProject) this.finish({ type: matchesKey(data, "ctrl+n") ? "new-pi" : "new-codex", cwd: this.selectedProject.cwd });
    } else if (kb.matches(data, "tui.select.up") || kb.matches(data, "tui.select.down") || kb.matches(data, "tui.select.pageUp") || kb.matches(data, "tui.select.pageDown")) {
      const down = kb.matches(data, "tui.select.down") || kb.matches(data, "tui.select.pageDown");
      const count = kb.matches(data, "tui.select.pageUp") || kb.matches(data, "tui.select.pageDown") ? this.visibleItems : 1;
      const delta = (down ? 1 : -1) * count;
      if (this.pane === "projects") {
        this.projectIndex = Math.max(0, Math.min(this.projects.length - 1, this.projectIndex + delta));
        this.sessionIndex = 0;
      } else this.sessionIndex = Math.max(0, Math.min((this.selectedProject?.sessions.length ?? 0) - 1, this.sessionIndex + delta));
    } else if (kb.matches(data, "tui.select.confirm")) {
      if (this.pane === "projects") this.pane = "sessions";
      else if (this.selectedSession) this.finish({ type: "resume", session: this.selectedSession });
    } else {
      const before = this.input.getValue();
      this.input.handleInput(data);
      if (before !== this.input.getValue()) { this.projectIndex = this.sessionIndex = 0; this.note = ""; this.rebuild(); }
    }
    this.options.repaint();
  }
  render(width: number): string[] {
    const th = this.options.theme;
    if (width < 38 || this.options.rows() < 22) return [truncateToWidth(th.fg("warning", "Session Dock · enlarge terminal (38×22) · Esc closes"), width)];
    const height = Math.min(32, Math.max(14, this.options.rows() - 4));
    const capacity = Math.max(1, Math.floor((height - 16) / 2));
    this.visibleItems = Math.min(capacity, Math.max(3, this.projects.length, this.selectedProject?.sessions.length ?? 0));
    const bodyHeight = this.visibleItems * 2;
    const inner = width - 2;
    const dual = width >= 86;
    const leftWidth = dual ? Math.min(38, Math.floor(inner * .32)) : inner;
    const rightWidth = dual ? inner - leftWidth - 1 : inner;
    const border = (s: string) => th.fg("borderMuted", s);
    const row = (s = "") => border("│") + pad(s, inner) + border("│");
    const rule = () => border("├" + "─".repeat(inner) + "┤");
    const label = (s: string) => th.fg("muted", s);
    const shortcut = (key: string, text: string) => th.fg("accent", key) + label(" " + text);
    const lines = [border("╭" + "─".repeat(inner) + "╮")];
    const total = this.options.catalog.sessions.filter(s => !s.archived).length;
    const tag = this.options.demo ? "DEMO · NO WRITES" : "LOCAL · NO CLOUD";
    const brand = ` ${th.fg("accent", th.bold("◈ SESSION DOCK"))}  ${label("pick up where you left off")}`;
    lines.push(row(pad(brand, Math.max(18, inner - tag.length - 2)) + th.fg("dim", tag) + " "));
    lines.push(row(` ${label(`${this.projects.length} projects`)} ${th.fg("dim", " / ")} ${label(`${total} local sessions`)} ${th.fg("dim", " · Pi + Codex, one place")}`));
    lines.push(rule());
    const input = this.input.render(Math.max(8, inner - 12))[0] || "";
    lines.push(row(` ${th.fg("accent", "Search")}  ${input}`));
    const chip = (id: SourceFilter, text: string) => this.filter === id ? th.bg("selectedBg", th.fg("accent", ` ${text} `)) : label(` ${text} `);
    lines.push(row(` ${chip("all", "ALL")}${chip("pi", "π PI")}${chip("codex", "◆ CODEX")}  ${th.fg("dim", "^F source")}  ${label(this.archived ? "archived: on" : "archived: off")} ${th.fg("dim", "^H")}`));
    lines.push(rule());
    const projectHeading = ` ${this.pane === "projects" ? th.fg("accent", "●") : "○"} PROJECTS`;
    const sessionHeading = ` ${this.pane === "sessions" ? th.fg("accent", "●") : "○"} SESSIONS ${label(`(${this.selectedProject?.sessions.length ?? 0})`)}`;
    lines.push(row(dual ? pad(projectHeading, leftWidth) + border("│") + pad(sessionHeading, rightWidth) : this.pane === "projects" ? projectHeading : sessionHeading));
    const projectRows = this.projectRows(leftWidth, this.visibleItems);
    const sessionRows = this.sessionRows(rightWidth, this.visibleItems);
    for (let i = 0; i < bodyHeight; i++) {
      lines.push(row(dual ? pad(projectRows[i] || "", leftWidth) + border("│") + pad(sessionRows[i] || "", rightWidth) : (this.pane === "projects" ? projectRows[i] : sessionRows[i]) || ""));
    }
    lines.push(rule());
    const session = this.selectedSession;
    lines.push(row(` ${th.fg("text", compactPath(this.selectedProject?.cwd || this.options.cwd, homedir()))}`));
    const detail = session ? `${session.provider === "pi" ? "π Pi · switch in place" : "◆ Codex · native CLI · quit to return"}${session.archived ? " · ARCHIVED" : ""}  ${session.id.slice(0, 8)}` : "Empty project · ^N starts Pi · ^O starts Codex";
    lines.push(row(` ${th.fg(session?.provider === "codex" ? "success" : "accent", detail)}`));
    const warning = this.note || this.options.catalog.warnings[0];
    lines.push(row(` ${warning ? th.fg("warning", clean(warning)) : th.fg("dim", session?.provider === "codex" ? "Original history preserved. Stop the same thread in Codex App before resuming." : "Search titles, paths or IDs. Browsing never changes your conversations.")}`));
    lines.push(rule());
    lines.push(row(` ${shortcut("↑↓", "move")}  ${shortcut("Tab", "pane")}  ${shortcut("Enter", this.pane === "projects" ? "sessions" : "resume")}  ${shortcut("Esc", "close")}`));
    lines.push(row(` ${shortcut("^N", "new Pi")}  ${shortcut("^O", "new Codex")}  ${shortcut("^G", "add folder")}  ${shortcut("^R", "refresh")}`));
    lines.push(border("╰" + "─".repeat(inner) + "╯"));
    // Width-safe even for IME, emoji, ANSI, long paths and very narrow windows.
    return lines.map(s => truncateToWidth(s, width));
  }
  private projectRows(width: number, count: number): string[] {
    const th = this.options.theme, rows: string[] = [];
    const start = Math.max(0, Math.min(this.projectIndex - Math.floor(count / 2), this.projects.length - count));
    if (!this.projects.length) return [th.fg("muted", " No matches"), th.fg("dim", " Esc clears search")];
    for (let i = start; i < Math.min(this.projects.length, start + count); i++) {
      const p = this.projects[i], selected = i === this.projectIndex;
      const current = p.cwd === this.options.cwd ? " · here" : "";
      let first = pad(` ${selected ? "›" : " "} ${th.fg(selected ? "accent" : "text", p.name)}${th.fg("dim", current)}`, width);
      const pi = p.sessions.filter(s => s.provider === "pi").length, codex = p.sessions.length - pi;
      let second = pad(`   ${th.fg("muted", `${pi} Pi · ${codex} Codex`)}${th.fg("dim", p.updatedAt ? ` · ${relativeTime(p.updatedAt)}` : "")}`, width);
      if (selected && this.pane === "projects") { first = th.bg("selectedBg", first); second = th.bg("selectedBg", second); }
      rows.push(first, second);
    }
    return rows;
  }
  private sessionRows(width: number, count: number): string[] {
    const th = this.options.theme, rows: string[] = [];
    const sessions = this.selectedProject?.sessions || [];
    if (!sessions.length) return [th.fg("muted", " No sessions in this view"), th.fg("dim", " ^N new Pi · ^O new Codex")];
    const start = Math.max(0, Math.min(this.sessionIndex - Math.floor(count / 2), sessions.length - count));
    for (let i = start; i < Math.min(sessions.length, start + count); i++) {
      const s = sessions[i], selected = i === this.sessionIndex;
      const badge = th.fg(s.provider === "pi" ? "accent" : "success", s.provider === "pi" ? "π PI   " : "◆ CODEX");
      let first = pad(` ${selected ? "›" : " "} ${badge}  ${th.fg("text", clean(s.title))}`, width);
      const current = s.provider === "pi" && s.id === this.options.currentId ? " · current" : "";
      let second = pad(`            ${th.fg("dim", `${relativeTime(s.updatedAt)} ago · ${clean(s.model || s.source || "local")}${s.archived ? " · archived" : ""}${current}`)}`, width);
      if (selected && this.pane === "sessions") { first = th.bg("selectedBg", first); second = th.bg("selectedBg", second); }
      rows.push(first, second);
    }
    return rows;
  }
}
