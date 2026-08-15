# DSH 插件管理器

一个**超轻量桌面应用**（约 2MB），用来一键启用/停用 [DSH](https://github.com/deepseek-ai/deepseek-harness) 的插件，修改即时生效（DSH 热加载），无需重启。

基于 **Neutralino.js**（用系统自带 WebView2 内核），而不是 Electron——所以体积只有 Electron 版的 **1/50**。

## 📦 下载

- **Windows x64**：`DSH插件管理器-v1.1.0-win32-x64.zip`（1.1MB）— 解压双击 `DSH插件管理器.exe`
- **macOS universal**：`DSH插件管理器-v1.1.0-mac-universal.zip`（1.8MB）— 同时支持 Intel 与 Apple Silicon

> macOS 首次打开：右键点击应用 → 打开（未签名应用需要绕过 Gatekeeper）

## ✨ 功能

- 列出 DSH 的**第三方插件条目**（如 `claude-move`、`whale-girl`、`modsearch`），显示当前启用/停用状态
- 一键切换启停，带二次确认，**保存即热生效，无需重启 DSH**
- 内置插件（dsh-base / dsh-web-app 官方组件）**锁定保护**，避免误停核心功能
- 搜索过滤、统计卡片（总数 / 已启用 / 已停用）

## 🧠 原理

- 插件启停的"开关"是补丁文件 `~/.dsh/profiles/web/cordis.patch.yml`
- 本程序只维护文件中 `# --- dsh-plugin-manager managed ---` 段，段外的手动配置一律原样保留
- ⚠️ **条目 id ≠ 包名**：如包 `dsh-claude-move` 的条目 id 是 `claude-move`，程序按真实条目 id 操作
- 修改后 DSH 的 HMR 监听自动热生效

## 🛠️ 从源码构建

```bash
npm install          # 安装依赖（含 @electron/asar 资源打包器）
node build.mjs win   # 构建 Windows 版（dist/DSH插件管理器/）
node build.mjs mac   # 构建 macOS universal 版（dist/DSH插件管理器.app/）
```

产物：
- `dist/` 下的应用目录（绿色便携）
- 项目上级目录的 `DSH插件管理器-v<版本>-<平台>-<架构>.zip`（上传 GitHub Releases）

## 📁 文件结构

```
├── build.mjs               一键构建脚本（win / mac）
├── neutralino.config.json  Neutralino 应用配置
├── resources/              前端源码（页面 + 业务逻辑）
│   ├── index.html          管理界面
│   ├── app.js              业务逻辑（读/写补丁文件）
│   └── js/neutralino.js    客户端库
├── vendor/neutralino/      Neutralino 运行时二进制
└── package.json            项目定义
```

## ⚠️ 已知问题与说明

- **使用 server 模式**（`enableServer: true`，本地端口 8766）：Neutralino v6 的 `app://` 协议在新版 WebView2（151+）上会白屏，server 模式是官方模板同款配置，稳定可用
- Windows 需要 WebView2 运行时（Win10/11 通常自带）；macOS 使用系统 WKWebView，无需额外依赖
- 请勿停用核心插件（dsh-base、dsh-web-app、web-ui-all 全家桶、工具类等）
- 应用默认读取 `C:\Users\Administrator\.dsh` 与 `C:\Users\Administrator\deepseek-harness`（如需适配其他机器/路径，修改 `resources/app.js` 顶部常量与 `neutralino.config.json` 的 `filesystem.allowedPaths`）

## 📄 License

[MIT](LICENSE)
