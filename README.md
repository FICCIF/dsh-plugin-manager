# DSH 插件管理器

一个**图形化工具**，用来一键启用/停用 [DSH](https://github.com/deepseek-ai/deepseek-harness) 的插件，修改即时生效（DSH 热加载），无需重启。

支持两种使用形态：

| 形态 | 适用场景 | 怎么启动 |
|---|---|---|
| 🖥️ **桌面应用**（Electron） | 日常使用，双击打开独立窗口 | 运行打包产物 `DSH插件管理器.exe`，或 `npm start` |
| 🌐 **浏览器模式**（Node） | 开发调试、远程访问 | `node server.mjs` 后浏览器打开 `http://127.0.0.1:8765`，或双击 `start.bat` |

## ✨ 功能

- 列出 DSH 的**第三方插件条目**（如 `claude-move`、`whale-girl`、`modsearch`），显示当前启用/停用状态
- 一键切换启停，带二次确认，**保存即热生效，无需重启 DSH**
- 内置插件（dsh-base / dsh-web-app 官方组件）**锁定保护**，避免误停核心功能
- 搜索过滤、统计卡片（总数 / 已启用 / 已停用）

## 🚀 快速开始

### 桌面应用

```bash
npm install          # 安装依赖
npm start            # 开发模式启动桌面窗口
node pack.mjs        # 一键瘦身打包：绿色免安装 exe + 便携 zip（产物在 dist/ 与项目上级目录）
```

打包后直接双击 `dist\DSH插件管理器-win32-x64\DSH插件管理器.exe` 即可使用，无需安装。

> **瘦身说明**：`pack.mjs` 会自动删除用不到的运行时文件（多语言包只留中英、WebGPU 编译器、ffmpeg 等），把 317MB 的 Electron 运行时压到便携包约 104MB。

### 浏览器模式

双击 `start.bat`，或：

```bash
npm run server       # 等价于 node server.mjs
# 浏览器打开 http://127.0.0.1:8765
```

## 🧠 原理

- 插件启停的"开关"实际是补丁文件 `~/.dsh/profiles/web/cordis.patch.yml`
- 在该文件中给某个条目写上 `- id: xxx` + `disabled: true` 即停用，删掉即启用
- DSH 启动时会监听这个文件（HMR），**保存即热生效，不需要重启**
- 本程序只维护文件中 `# --- dsh-plugin-manager managed ---` 段内的内容，该段外的手动配置（注释、补丁）一律原样保留
- ⚠️ **条目 id ≠ 包名**：如包 `dsh-claude-move` 在加载树里的条目 id 是 `claude-move`，本程序一律使用补丁文件中的真实条目 id

## 📁 文件结构

```
├── main.js          Electron 主进程（窗口 + 内置服务）
├── app.mjs          核心服务模块（Node / Electron 共用）
├── server.mjs       Node 模式入口
├── pack.mjs         一键瘦身打包脚本
├── public/
│   └── index.html   前端页面（原生 HTML/JS/CSS，无框架）
├── start.bat        浏览器模式一键启动
└── package.json     项目定义（Electron）
```

## ⚠️ 注意事项

- 请勿停用核心插件（`dsh-base`、`dsh-web-app`、`web-ui-all` 全家桶、工具类等），可能导致界面或功能异常
- 个别界面类插件停用后需要刷新浏览器页面才完全生效
- 端口 `127.0.0.1:8765` 被占用时，程序会尝试直接打开现有服务（如 `node server.mjs` 已在运行）
- 本工具面向 DSH web profile；其他 profile 请自行调整 `app.mjs` 中的路径常量

## 📄 License

[MIT](LICENSE)
