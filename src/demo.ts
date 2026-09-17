import type { Catalog } from "./catalog.ts";

// Invented data only. Safe to use for screenshots and community previews.
export function demoCatalog(now = Date.now()): Catalog {
  const projects = ["/workspace/session-dock", "/workspace/atlas-web", "/workspace/api-gateway", "/workspace/design-system", "/workspace/playground"];
  const titles = [
    ["Polish the project and session picker", "接着 Codex App 的会话在终端工作", "Add keyboard navigation and Chinese search", "Review the native resume handoff"],
    ["Finish the dashboard command palette", "修复移动端布局和加载状态", "Add integration tests for checkout"],
    ["Investigate request timeout handling", "Review authorization boundaries"],
    ["A quieter dark theme with clear contrast", "整理组件文档和无障碍检查"],
    ["Try the new project workflow"],
  ];
  return { directories: projects, warnings: [], sessions: titles.flatMap((items, p) => items.map((title, s) => ({
    provider: (s % 2 ? "codex" : "pi") as "pi" | "codex",
    id: `00000000-0000-4000-8000-${String(p * 10 + s).padStart(12, "0")}`,
    title, cwd: projects[p], updatedAt: now - (p * 180 + s * 27 + 4) * 60000,
    model: s % 2 ? "Codex App" : "Pi", source: "demo",
  }))) };
}
