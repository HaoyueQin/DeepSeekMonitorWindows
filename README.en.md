# DeepSeek / MiMo Monitor Windows

<div align="center">

[![Release](https://img.shields.io/github/v/release/HaoyueQin/DeepSeekMonitorWindows?color=4d6bfe)](https://github.com/HaoyueQin/DeepSeekMonitorWindows/releases/latest)
[![CI](https://github.com/HaoyueQin/DeepSeekMonitorWindows/actions/workflows/ci.yml/badge.svg)](https://github.com/HaoyueQin/DeepSeekMonitorWindows/actions/workflows/ci.yml)
[![Auto Release](https://github.com/HaoyueQin/DeepSeekMonitorWindows/actions/workflows/release.yml/badge.svg)](https://github.com/HaoyueQin/DeepSeekMonitorWindows/actions/workflows/release.yml)
[![Platform](https://img.shields.io/badge/Platform-Windows%2010%2F11-0078D4?logo=windows11&logoColor=white)](https://github.com/HaoyueQin/DeepSeekMonitorWindows/releases/latest)
![License](https://img.shields.io/github/license/HaoyueQin/DeepSeekMonitorWindows?color=green)
![Tauri](https://img.shields.io/badge/Tauri-2-FFC131?logo=tauri&logoColor=black)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![Rust](https://img.shields.io/badge/Rust-stable-DEA584?logo=rust&logoColor=black)

[简体中文](README.md) | **English**

</div>

---

A Windows desktop app for monitoring DeepSeek & MiMo API usage: account balance, daily and monthly spend, per-model token consumption with cache-hit rates, and week-by-week usage trends.

> **Disclaimer**: This project is not an official DeepSeek or MiMo product and is not affiliated with either company.

## Screenshots

| Light mode | Dark mode |
| --- | --- |
| ![Dashboard, light mode](screenshots/dashboard-light.png) | ![Dashboard, dark mode](screenshots/dashboard-dark.png) |

> Dashboard: balance card, daily / monthly spend, three model rows (V4 Flash · V4 Flash Vision · V4 Pro) and the 7-day trend chart.

## Features

### DeepSeek
- Account balance via the official balance API (prefers the CNY entry when multiple currencies are returned).
- Usage data: monthly cost, total tokens, request counts, cache hit / miss, output tokens.
- Dedicated rows for **V4 Flash / V4 Flash Vision (deepseek-v4-flash-vision-exp) / V4 Pro**, each with its own accent color and icon.
- 7-day spend trend chart and per-model detail views, both paged by week.
- Usage token captured automatically through an embedded login window (manual paste as fallback); history cached locally for up to 36 months.

### MiMo
- One-click switch between DeepSeek and MiMo in the header.
- Balance query plus usage breakdowns by model (V2.5 / V2.5 Pro) and by day.
- Silent queries through a hidden WebView window that only appears when login is required; 401 redirects to login automatically.

### Application
- Low-balance Windows notifications with configurable threshold and cooldown.
- Auto refresh (global + MiMo-specific interval), autostart, always-on-top, tray-resident window.
- Data export (JSON / CSV), import, cache cleanup, and history-depth management.
- In-app update check and install via a signature-verified updater.
- Liquid-glass UI with dark / light / system themes and bilingual (zh/en) interface.

## Requirements

- Windows 10 or Windows 11.
- Microsoft Edge WebView2 Runtime (built into Windows 11; separate install may be needed on Windows 10).

## Download

Grab `DeepSeekMonitorWindows_*_x64-setup.exe` from [GitHub Releases](https://github.com/HaoyueQin/DeepSeekMonitorWindows/releases/latest) and run it. Upgrading over an existing installation does not require uninstalling first.

The app self-updates: after a new release ships, use "Settings → About → Check for updates".

## Building from source

Requirements:

- Node.js 18+ and npm
- Rust 1.77.2+ (MSVC toolchain recommended)
- Visual Studio Build Tools 2022 (*Desktop development with C++* workload)

```powershell
git clone https://github.com/HaoyueQin/DeepSeekMonitorWindows.git
cd DeepSeekMonitorWindows
npm install
npm run tauri:dev     # develop
npm run tauri:check   # full check
npx tauri build       # NSIS installer -> src-tauri/target/release/bundle/nsis/
```

## Quick start

1. Save your DeepSeek API Key under "Settings → Account" (from the open-platform API Keys page); it is verified on save.
2. Usage stats require the web usage token: click "Auto sync" and log in inside the popup window, or paste the token manually.
3. For MiMo, click "Log in to MiMo" once; afterwards queries run silently.
4. Left-click the tray icon to show the panel; right-click for show/quit. Header buttons: refresh, theme, settings, hide.

## Data storage

App configuration (API key & usage token, credentials encrypted with Windows DPAPI before hitting disk) lives at:

```text
%APPDATA%\DeepSeekMonitorWindows\config.json
```

**Never commit that file or publish secrets from screenshots/logs.** The WebView2 login cache sits at `%LOCALAPPDATA%\com.deepseek.monitor.windows\EBWebView` and is local runtime data only.

## Project layout

```text
DeepSeekMonitorWindows/
├── src/                         # React + TypeScript frontend
│   ├── main.tsx                 # App entry, global state, multi-month cache merge
│   ├── types.ts / utils.ts      # Types and helpers
│   ├── i18n.ts                  # zh/en i18n
│   └── components/              # Dashboard / Settings / Model detail
├── src-tauri/                   # Tauri + Rust backend
│   └── src/
│       ├── lib.rs               # Tauri commands, window mgmt, callback server
│       └── modules/             # config(DPAPI) / deepseek / mimo / tray / types
├── scripts/                     # Windows dev scripts
└── .github/workflows/           # CI and auto-release pipelines
```

## Acknowledgments

Full lineage of this project — credit to every upstream generation:

| Generation | Project | Notes |
| --- | --- | --- |
| 🥇 Origin | [JayHome137/DeepSeekMonitor](https://github.com/JayHome137/DeepSeekMonitor) | macOS menu-bar + WidgetKit app (Swift / SwiftUI / AppKit / WidgetKit) that pioneered "DeepSeek balance & usage monitoring"; this project inherits its visual direction and product idea. |
| 🥈 Windows port | [Joyi-code/DeepSeekMonitorWindows](https://github.com/Joyi-code/DeepSeekMonitorWindows) | The direct upstream, rebuilt for Windows with Tauri 2 + React + Rust; this repo continues from it. |
| 🥉 This repo | HaoyueQin/DeepSeekMonitorWindows | Adds full MiMo support, V4 Flash Vision adaptation, multi-currency balance fix, history-depth management, CI-driven releases, and more. |

Additional thanks:

- The [Tauri](https://tauri.app/), [React](https://react.dev/) and [Rust](https://www.rust-lang.org/) communities for outstanding infrastructure;
- Everyone who filed issues and gave feedback.

> Note: this README previously misattributed the upstream to felikschu/deepseek-monitor (a Python-based DeepSeek platform-change monitor). After verifying each repository's own statements, the correct lineage is the table above — corrections offered with thanks to JayHome137 and Joyi-code.

## License

[MIT](LICENSE)
