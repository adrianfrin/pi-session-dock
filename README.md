# Pi Session Dock

English | [简体中文](README.zh-CN.md)

A local-first project and session picker for **Pi + Codex**, inside the Pi terminal.

Browse conversations by directory, search their titles, and resume each conversation in its native runtime. No transcript conversion, no cloud service, no telemetry.

## Install

Requires **Pi 0.85.1 or newer** and **Node.js 22.13+**. Codex features additionally require the official `codex` CLI and `codex login`.

```sh
pi install git:github.com/adrianfrin/pi-session-dock
```

Then run `/reload` in Pi and open `/dock`.

For a pinned release:

```sh
pi install git:github.com/adrianfrin/pi-session-dock@v0.1.0
```

## Features

- Two-pane project/session picker, with a single-pane layout on narrow terminals.
- Pi and Codex history grouped by exact working directory, including Git worktrees.
- Search project paths, session titles and IDs; supports Chinese input.
- Filter by Pi/Codex and optionally include archived Codex threads.
- Resume Pi sessions in place, using Pi's normal project-trust lifecycle.
- Resume original Codex threads through the official interactive CLI. Quit Codex to return to your unchanged Pi session.
- Create a new Pi or Codex session in a selected directory.
- Add folders that have no conversation history yet.
- Optional `dock-night` dark theme, selectable through `/settings`.
- `/dock demo` uses invented data and disables actions: safe for showing the interface without exposing personal sessions.

## Commands and keys

| Command | Action |
| --- | --- |
| `/dock` | Open your local projects and sessions |
| `/dock <search>` | Open with a search query |
| `/dock add <directory>` | Register an existing folder; supports `~` and spaces |
| `/dock demo` | Interactive preview with fictional data; no writes |
| `/dock help` | Show keyboard shortcuts |

| Key | Action |
| --- | --- |
| Type | Search paths, titles and IDs |
| `↑` / `↓`, Page Up / Down | Select an item |
| `Tab` / `Shift+Tab` | Switch panes |
| `Enter` | Enter session pane / resume selected session |
| `Ctrl+F` | Cycle All → Pi → Codex |
| `Ctrl+H` | Toggle archived Codex threads |
| `Ctrl+N` | New Pi session in selected project |
| `Ctrl+O` | New Codex session in selected project |
| `Ctrl+G` | Add folder |
| `Ctrl+R` | Refresh indexes |
| `Esc` | Clear search, then close |
| `Ctrl+C` | Close |

List navigation follows Pi's configured selection bindings. Dock-specific shortcuts apply only while its picker is open. Use a terminal at least 38 columns × 22 rows.

## How Codex resume works

The picker reads local metadata, then asks for confirmation before pausing Pi and running:

```sh
codex resume <thread-id> --cd <project-directory>
```

Arguments are passed directly to the executable, not interpolated into a shell command. No prompt is submitted automatically. Codex's own authentication, sandbox, approvals and conversation locks remain in effect; this extension does not bypass them.

**“This conversation is open in another app”** is Codex's own lock protection. Close the conversation in Codex App or the other CLI (fully quit the app if needed), then press **R** in Codex to retry. Stopping generation alone may not release ownership. Do not delete lock files or the conversation.

Session Dock does **not** detect live ownership in advance, transfer a running turn, or turn Codex history into Pi history. Cloud-only threads without a local index are not supported.

## Storage and privacy

- Pi history is discovered through `SessionManager.listAll()`, plus the current session storage directory.
- Codex history is read from the newest `state_*.sqlite` under `CODEX_HOME` (default `~/.codex`), using a **read-only connection**. Subagent threads are excluded.
- If SQLite is unavailable or incompatible, discovery falls back to bounded rollout-header reads and `session_index.jsonl`. Titles may be incomplete; a warning is shown.
- Codex's internal index schema is not a stable public API. Discovery is limited to 10,000 recent indexed threads/files and may need updates for future Codex versions.
- Added directories live in `<Pi agent directory>/session-dock.json`. No transcript cache is written.
- Browsing never modifies either provider's history. Creating a Pi session writes a native header; resuming a Pi session lets Pi manage its normal session lifecycle. Only the official Codex CLI writes Codex history during handoff.
- Session titles and paths are visible on screen. Use **`/dock demo`** when sharing screenshots.

## Development

```sh
npm ci --ignore-scripts
npm run check
pi -e ./src/index.ts --theme ./themes/dock-night.json --use-theme dock-night
```

Tests cover catalog filtering, Chinese input, terminal escape sanitization, width/height safety, read-only SQLite discovery, rollout fallback, folder configuration, native Pi headers and Codex argv/terminal restoration using a stub executable. Native conversation ownership is enforced by Codex, not simulated as an extension feature.

Tested locally on macOS with Pi 0.85.1 and Ghostty. Other platforms have not yet been interactively validated. This is an early `0.1.0` release; reports and contributions are welcome.

## License

MIT. Independent community project; not affiliated with OpenAI or the Pi maintainers.
