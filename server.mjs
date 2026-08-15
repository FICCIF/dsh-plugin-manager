/**
 * DSH 插件管理器 — Node 模式入口（浏览器版 / 开发调试用）
 * 桌面版请运行打包后的 exe，或 `npm start`（Electron）。
 * 本入口在纯 Node 环境下启动 HTTP 服务，用浏览器访问。
 */

import { startServer, DEFAULT_PORT, HOST } from './app.mjs'

const { url, port, profilePatch } = await startServer({ port: DEFAULT_PORT, host: HOST })

console.log('=============================================')
console.log('  DSH 插件管理器已启动（Node 模式）')
console.log(`  访问地址: ${url}`)
console.log(`  补丁文件: ${profilePatch}`)
console.log('  修改即时生效（DSH 热加载），无需重启')
console.log('  按 Ctrl+C 停止服务')
console.log('=============================================')
