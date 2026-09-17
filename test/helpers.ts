import { readFileSync } from "node:fs";
import { Theme } from "@earendil-works/pi-coding-agent";
export function testTheme(): Theme {
  const data = JSON.parse(readFileSync(new URL("../themes/dock-night.json", import.meta.url), "utf8"));
  const bgKeys = new Set(["selectedBg", "searchMatchBg", "userMessageBg", "customMessageBg", "toolPendingBg", "toolSuccessBg", "toolErrorBg"]);
  const fg = Object.fromEntries(Object.entries(data.colors).filter(([k]) => !bgKeys.has(k)));
  const bg = Object.fromEntries(Object.entries(data.colors).filter(([k]) => bgKeys.has(k)));
  return new Theme(fg as ConstructorParameters<typeof Theme>[0], bg as ConstructorParameters<typeof Theme>[1], "truecolor");
}
