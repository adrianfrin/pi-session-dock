# Pi Session Dock

[English](README.md) | 简体中文

在 Pi 终端中使用的 **Pi + Codex** 项目与会话选择器，以本地数据为中心。

按目录浏览对话、搜索标题，并在各自的原生运行环境中继续会话。不转换对话记录、不依赖云端服务、不收集遥测数据。

## 安装

需要 **Pi 0.85.1 或更新版本**以及 **Node.js 22.13+**。使用 Codex 功能还需要安装官方 `codex` CLI，并通过 `codex login` 登录。

```sh
pi install git:github.com/adrianfrin/pi-session-dock
```

随后在 Pi 中执行 `/reload`，再输入 `/dock` 打开面板。

如需安装固定版本：

```sh
pi install git:github.com/adrianfrin/pi-session-dock@v0.1.0
```

## 功能

- 双栏项目与会话选择器，终端较窄时切换为单栏布局。
- 按完整工作目录归类 Pi 和 Codex 历史会话，包括 Git worktree。
- 搜索项目路径、会话标题和 ID，支持中文输入。
- 按 Pi / Codex 筛选，并可选择显示已归档的 Codex 会话。
- 在 Pi 内直接恢复 Pi 会话，遵循 Pi 原生的项目信任流程。
- 通过官方交互式 CLI 恢复原始 Codex 会话。退出 Codex 后，返回未被改变的原 Pi 会话。
- 在选定目录中新建 Pi 或 Codex 会话。
- 添加尚无会话历史的目录。
- 提供可选的 `dock-night` 深色主题，可通过 `/settings` 选择。
- `/dock demo` 使用虚构数据并禁用操作，便于展示界面而不泄露个人会话。

## 命令与快捷键

| 命令 | 操作 |
| --- | --- |
| `/dock` | 打开本地项目与会话列表 |
| `/dock <search>` | 打开面板并填入搜索内容 |
| `/dock add <directory>` | 登记已有目录，支持 `~` 和空格 |
| `/dock demo` | 使用虚构数据进行交互演示，不写入数据 |
| `/dock help` | 显示快捷键帮助 |

| 按键 | 操作 |
| --- | --- |
| 直接输入 | 搜索路径、标题和 ID |
| `↑` / `↓`、Page Up / Down | 选择条目 |
| `Tab` / `Shift+Tab` | 切换面板 |
| `Enter` | 进入会话面板 / 恢复选中的会话 |
| `Ctrl+F` | 循环切换来源：全部 → Pi → Codex |
| `Ctrl+H` | 显示或隐藏已归档的 Codex 会话 |
| `Ctrl+N` | 在选定项目中新建 Pi 会话 |
| `Ctrl+O` | 在选定项目中新建 Codex 会话 |
| `Ctrl+G` | 添加目录 |
| `Ctrl+R` | 刷新索引 |
| `Esc` | 清空搜索，再次按下关闭面板 |
| `Ctrl+C` | 关闭面板 |

列表导航遵循 Pi 中配置的选择快捷键。Dock 专用快捷键仅在选择器打开时生效。终端尺寸至少需要 38 列 × 22 行。

## Codex 会话恢复原理

选择器读取本地元数据，征求确认后暂停 Pi，并运行：

```sh
codex resume <thread-id> --cd <project-directory>
```

参数直接传给可执行程序，不会拼接成 Shell 命令。插件不会自动提交提示词。Codex 自身的身份验证、沙箱、审批和会话锁始终生效，插件不会绕过这些机制。

**“This conversation is open in another app”（此会话已在其他应用中打开）**是 Codex 自身的会话锁保护。请在 Codex App 或另一个 CLI 中关闭对应会话，必要时完全退出应用，然后在 Codex 中按 **R** 重试。仅停止生成不一定会释放会话占用。不要删除锁文件或会话。

Session Dock **不会**提前检测实时占用状态、转移正在执行的轮次，或将 Codex 历史转换成 Pi 历史。不支持没有本地索引的纯云端会话。

## 存储与隐私

- Pi 历史通过 `SessionManager.listAll()` 以及当前会话存储目录发现。
- Codex 历史通过**只读连接**读取 `CODEX_HOME`（默认为 `~/.codex`）下最新版本的 `state_*.sqlite`，不包含子代理会话。
- 如果 SQLite 不可用或不兼容，会回退到有读取上限的 rollout 文件头扫描及 `session_index.jsonl`。此时标题可能不完整，界面会显示警告。
- Codex 内部索引结构不是稳定的公共 API。最多扫描最近的 10,000 个索引会话或文件，未来 Codex 版本可能需要适配更新。
- 手动添加的目录保存在 `<Pi agent directory>/session-dock.json`，不写入对话记录缓存。
- 浏览列表不会修改任何一方的历史。新建 Pi 会话会写入原生会话头；恢复 Pi 会话时，由 Pi 按正常生命周期管理会话。切换至 Codex 后，只有官方 Codex CLI 会写入 Codex 历史。
- 会话标题和路径会显示在屏幕上。分享截图时请使用 **`/dock demo`**。

## 开发

```sh
npm ci --ignore-scripts
npm run check
pi -e ./src/index.ts --theme ./themes/dock-night.json --use-theme dock-night
```

测试涵盖列表筛选、中文输入、终端转义字符清理、宽高边界、只读 SQLite 发现、rollout 回退、目录配置、原生 Pi 会话头，以及通过模拟可执行程序验证 Codex 参数传递和终端恢复。原生会话占用保护由 Codex 执行，不会作为插件功能加以模拟。

已在 macOS、Pi 0.85.1 和 Ghostty 下进行本地测试。其他平台尚未完成交互验收。目前为早期 `0.1.0` 版本，欢迎反馈问题和参与贡献。

## 许可证

MIT。独立社区项目，与 OpenAI 或 Pi 维护者没有隶属关系。
