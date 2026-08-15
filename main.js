/**
 * DSH 插件管理器 — Electron 主进程
 * 职责：
 *  1. 启动内置 HTTP 服务（复用 app.mjs 的核心逻辑）
 *  2. 创建桌面窗口加载管理页面
 *  3. 单实例锁（防止重复启动导致端口冲突）
 *  4. 窗口关闭 = 退出应用（HTTP 服务随之停止）
 */

import { app, BrowserWindow, shell, dialog } from 'electron'
import { startServer, DEFAULT_PORT, PROFILE_PATCH } from './app.mjs'

const APP_TITLE = 'DSH 插件管理器'
let mainWindow = null
let serverInfo = null

// 单实例锁：第二个实例启动时聚焦已有窗口
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    // 1) 启动 HTTP 服务
    try {
      serverInfo = await startServer({ port: DEFAULT_PORT })
    } catch (err) {
      if (err?.code === 'EADDRINUSE') {
        // 端口被占用：可能是 Node 模式的 server.mjs 已在运行，直接加载现有服务
        console.warn(`[${APP_TITLE}] 端口 ${DEFAULT_PORT} 已被占用，尝试直接打开现有服务页面…`)
        serverInfo = { url: `http://127.0.0.1:${DEFAULT_PORT}` }
      } else {
        console.error('服务启动失败：', err)
        dialog.showErrorBox(APP_TITLE, `内置服务启动失败：${err.message}\n请关闭占用端口的程序后重试。`)
        app.quit()
        return
      }
    }

    // 2) 创建主窗口
    mainWindow = new BrowserWindow({
      width: 1120,
      height: 780,
      minWidth: 820,
      minHeight: 560,
      title: APP_TITLE,
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })

    // 外链（GitHub 等）用系统浏览器打开
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('http')) shell.openExternal(url)
      return { action: 'deny' }
    })

    await mainWindow.loadURL(serverInfo.url)
    console.log(`[${APP_TITLE}] 窗口已加载: ${serverInfo.url}`)
    console.log(`[${APP_TITLE}] 补丁文件: ${PROFILE_PATCH}`)

    mainWindow.on('closed', () => {
      mainWindow = null
    })
  })

  // 3) 窗口全部关闭 = 退出应用（macOS 惯例除外，这里主要面向 Windows）
  app.on('window-all-closed', () => {
    app.quit()
  })

  app.on('before-quit', () => {
    if (serverInfo?.server) {
      try { serverInfo.server.close() } catch { /* 忽略 */ }
    }
  })
}
