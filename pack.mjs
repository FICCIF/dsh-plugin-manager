/**
 * DSH 插件管理器 — 一键打包脚本（瘦身版）
 *
 * 用法：node pack.mjs
 *
 * 步骤：
 *  1. 从 node_modules/electron/dist 拷贝 Electron 运行时
 *  2. 瘦身：删除用不到的大文件（多语言包只留中英、WebGPU 编译器、ffmpeg 等）
 *  3. 放入应用代码（resources/app）
 *  4. 重命名主程序为「DSH插件管理器.exe」
 *  5. 压缩成绿色便携包 zip
 *
 * 产物：
 *  dist/DSH插件管理器/                  （解压版，可直接运行）
 *  ../DSH插件管理器-v<版本>-win32-x64.zip （便携包，上传 GitHub Releases）
 */

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, renameSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname)

// 版本号（从 package.json 读取）
const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

const APP_NAME = 'DSH插件管理器'
const ELECTRON_DIST = join(ROOT, 'node_modules', 'electron', 'dist')
const OUT_DIR = join(ROOT, 'dist', APP_NAME)
const ZIP_PATH = join(dirname(ROOT), `${APP_NAME}-v${version}-win32-x64.zip`)

// ── 瘦身清单 ────────────────────────────────────────────────────────────────

/** 多语言包：只保留中英文（省 ~40MB） */
const KEEP_LOCALES = new Set(['zh-CN.pak', 'zh-TW.pak', 'en-US.pak'])

/** 顶层可删除的大文件 */
const REMOVE_FILES = new Set([
  'dxcompiler.dll',          // WebGPU/DX12 编译器（页面用不到）
  'dxil.dll',                // DXIL 辅助
  'ffmpeg.dll',              // 音视频解码（页面无视频）
  'LICENSES.chromium.html',  // 许可证列表（14.6MB，纯文档）
])

// ── 工具 ────────────────────────────────────────────────────────────────────

function log(step, msg) {
  console.log(`[${step}] ${msg}`)
}

function sizeMB(p) {
  return statSync(p).size / 1024 / 1024
}

function run(cmd, args) {
  execFileSync(cmd, args, { stdio: 'inherit' })
}

// ── 主流程 ──────────────────────────────────────────────────────────────────

log('1/5', `拷贝 Electron 运行时 (${APP_NAME})...`)
if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true })
mkdirSync(OUT_DIR, { recursive: true })
cpSync(ELECTRON_DIST, OUT_DIR, { recursive: true })
log('1/5', '拷贝完成')

log('2/5', '瘦身：删除用不到的文件...')
// 多语言包
const localesDir = join(OUT_DIR, 'locales')
if (existsSync(localesDir)) {
  for (const f of readdirSync(localesDir)) {
    if (!KEEP_LOCALES.has(f)) {
      const p = join(localesDir, f)
      const mb = sizeMB(p)
      rmSync(p)
      log('2/5', `  删除 locales/${f} (-${mb.toFixed(1)}MB)`)
    }
  }
}
// 顶层大文件
for (const f of REMOVE_FILES) {
  const p = join(OUT_DIR, f)
  if (existsSync(p)) {
    const mb = sizeMB(p)
    rmSync(p)
    log('2/5', `  删除 ${f} (-${mb.toFixed(1)}MB)`)
  }
}

log('3/5', '放入应用代码 (resources/app)...')
const appDir = join(OUT_DIR, 'resources', 'app')
mkdirSync(appDir, { recursive: true })
for (const f of ['main.js', 'app.mjs', 'server.mjs', 'package.json']) {
  cpSync(join(ROOT, f), join(appDir, f))
}
cpSync(join(ROOT, 'public'), join(appDir, 'public'), { recursive: true })

log('4/5', '重命名主程序...')
renameSync(join(OUT_DIR, 'electron.exe'), join(OUT_DIR, `${APP_NAME}.exe`))

log('5/5', `压缩便携包 -> ${ZIP_PATH} ...`)
if (existsSync(ZIP_PATH)) rmSync(ZIP_PATH)
// 用系统 tar（bsdtar）压缩 zip
run('tar', ['-a', '-c', '-f', ZIP_PATH, '-C', join(ROOT, 'dist'), APP_NAME])

const total = sizeMB(OUT_DIR)
const zipMB = statSync(ZIP_PATH).size / 1024 / 1024
console.log('')
console.log('✅ 打包完成！')
console.log(`   解压版: ${OUT_DIR} (${total.toFixed(0)}MB)`)
console.log(`   便携包: ${ZIP_PATH} (${zipMB.toFixed(1)}MB)`)
