/**
 * DSH 插件管理器 — 核心服务模块（供 Node 模式 server.mjs 和 Electron 模式 main.js 共用）
 *
 * 功能：
 *  - 枚举 DSH web profile 的插件条目：
 *      第三方条目：各 bundle 包的 cordis.patch.yml 中 insert 的条目（如 claude-move、whale-girl、modsearch）
 *      内置条目：dsh-base / dsh-web-app 内置补丁中的条目（只读展示，不允许停用）
 *  - 状态判定：用户层补丁（profiles/web/cordis.patch.yml）+ 全局补丁中是否写了 disabled: true
 *  - HTTP API：GET /api/plugins、POST /api/plugins/<id>/toggle
 *  - 切换只改写 cordis.patch.yml 中由本程序管理的 section（其他内容原样保留），
 *    DSH 的 HMR 监听自动热生效，无需重启
 *
 * 注意：条目 id ≠ 包名（如包 dsh-claude-move 的条目 id 是 claude-move），
 *       本程序一律使用补丁文件中的真实条目 id。
 */

import { createServer } from 'node:http'
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── 配置 ────────────────────────────────────────────────────────────────────
const DEFAULT_PORT = 8765
const HOST = '127.0.0.1'

// DSH 关键文件路径
const DSH_HOME = process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME || '', '.dsh')
const PROFILE_DIR = join(DSH_HOME, 'profiles', 'web')
const PROFILE_PATCH = join(PROFILE_DIR, 'cordis.patch.yml')
const PROFILE_MANIFEST = join(PROFILE_DIR, 'package.json')
const HOME_PATCH = join(DSH_HOME, 'cordis.patch.yml')
const NODE_MODULES = join(PROFILE_DIR, 'node_modules')

// 内置 bundle 补丁（dsh 仓库内，只读参考）
const DSH_REPO = process.env.DSH_REPO || 'C:/Users/Administrator/deepseek-harness'
const BASE_PATCH = join(DSH_REPO, 'packages', 'bundle', 'base', 'cordis.patch.yml')
const WEB_APP_PATCH = join(DSH_REPO, 'packages', 'bundle', 'web-app', 'cordis.patch.yml')

// 本程序管理的 section 标记（自动生成，勿手改）
const SECTION_START = '# --- dsh-plugin-manager managed (auto-generated; do not edit) ---'
const SECTION_END = '# --- end dsh-plugin-manager ---'

// 核心包：停用会导致系统功能明显受损，UI 上提示警告
const CORE_PACKAGES = new Set([
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  '@linxin666/dsh-web-ui-all',
  '@dsh-memory/bundle',
  '@dsh-external/workflow',
  '@dsh-external/dsh-sidechain',
  '@liustack/modlens',
  '@liustack/modsearch',
  '@nanmicoder/dsh-auto-mode',
  '@loserfox/distill',
  'dsh-premise-guard',
])

// ── 小工具 ──────────────────────────────────────────────────────────────────

/** 提取补丁文本中所有 insert 块内的条目 id */
export function extractInsertedIds(text) {
  const ids = new Set()
  const blockRe = /- insert:[^\n]*\n((?:[ \t]+- id:\s*[^\s#]+[^\n]*\n)+)/g
  let m
  while ((m = blockRe.exec(text)) !== null) {
    const idRe = /- id:\s*([^\s#]+)/g
    let im
    while ((im = idRe.exec(m[1])) !== null) ids.add(im[1])
  }
  return ids
}

/** 提取补丁文本中所有条目 id（顶层 + insert 内），用于内置补丁的完整枚举 */
export function extractAllEntryIds(text) {
  const ids = new Set()
  const re = /- id:\s*([^\s#]+)/g
  let m
  while ((m = re.exec(text)) !== null) ids.add(m[1])
  return ids
}

/** 提取补丁文本中被 disabled 的条目 id */
export function extractDisabledIds(text) {
  const ids = new Set()
  const re = /- id:\s*([^\s#]+)(?:\r?\n\s*)?(?:#[^\r\n]*\r?\n\s*)?disabled:\s*true/g
  let m
  while ((m = re.exec(text)) !== null) ids.add(m[1])
  return ids
}

/** 读取文件（不存在返回空串） */
function readFile(path) {
  if (!existsSync(path)) return ''
  return readFileSync(path, 'utf8')
}

/** 安全读取 JSON */
function readJson(path) {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

// ── 插件条目枚举 ────────────────────────────────────────────────────────────

/**
 * 枚举第三方条目：[{ id, pkg }]
 * 来源：package.json bundles 中每个可解析包的 cordis.patch.yml insert 条目，
 *       加上全局补丁与用户补丁里的 insert 条目（如皮肤）。
 */
export function collectThirdParty() {
  const items = []
  const seen = new Set()
  const push = (id, pkg) => {
    if (id && !seen.has(id)) {
      seen.add(id)
      items.push({ id, pkg })
    }
  }

  const manifest = readJson(PROFILE_MANIFEST)
  const bundles = manifest?.dsh?.profile?.bundles ?? []
  for (const pkg of bundles) {
    // 包目录存在才算第三方（内置 dsh-base/dsh-web-app 不在 node_modules）
    const dir = join(NODE_MODULES, pkg)
    if (!existsSync(dir)) continue
    const patchText = readFile(join(dir, 'cordis.patch.yml'))
    for (const id of extractInsertedIds(patchText)) push(id, pkg)
  }

  // 全局补丁 insert（皮肤等）
  for (const id of extractInsertedIds(readFile(HOME_PATCH))) push(id, '（全局补丁）')

  // 用户补丁 insert（兜底）
  for (const id of extractInsertedIds(readFile(PROFILE_PATCH))) push(id, '（用户补丁）')

  return items
}

/**
 * 枚举内置条目（只读）：[{ id, disabled }]
 * 来源：dsh-base 与 dsh-web-app 内置补丁（后层 web-app 覆盖 base）。
 */
export function collectBuiltins() {
  const baseText = readFile(BASE_PATCH)
  const webText = readFile(WEB_APP_PATCH)
  const ids = new Set([...extractAllEntryIds(baseText), ...extractAllEntryIds(webText)])
  const disabled = new Set([...extractDisabledIds(baseText), ...extractDisabledIds(webText)])
  return [...ids].map(id => ({ id, disabled: disabled.has(id) }))
}

/** 当前停用集合（用户层 + 全局补丁） */
export function readUserDisabled() {
  const disabled = new Set()
  for (const id of extractDisabledIds(readFile(PROFILE_PATCH))) disabled.add(id)
  for (const id of extractDisabledIds(readFile(HOME_PATCH))) disabled.add(id)
  return disabled
}

// ── 切换启停（写补丁文件） ─────────────────────────────────────────────────

/**
 * 切换一个第三方条目的启停状态。
 * 只重写 cordis.patch.yml 中本程序管理的 section：
 *  - section 已存在 -> 整体替换
 *  - section 不存在 -> 追加到文件末尾
 * 文件其余内容（注释、手写条目）一律原样保留。
 */
export function togglePlugin(id) {
  const thirdParty = collectThirdParty()
  if (!thirdParty.some(p => p.id === id)) {
    const err = new Error(`未知插件条目 id: ${id}（内置条目不可操作）`)
    err.code = 'UNKNOWN_PLUGIN'
    throw err
  }

  let text = readFile(PROFILE_PATCH)
  const disabled = readUserDisabled()
  const willDisable = !disabled.has(id)

  const entries = [...disabled]
  if (willDisable) entries.push(id)
  else entries.splice(entries.indexOf(id), 1)
  entries.sort((a, b) => a.localeCompare(b, 'zh-CN'))

  const section = [
    SECTION_START,
    '# 本段由「DSH 插件管理器」自动维护',
    ...entries.map(e => `- id: ${e}\n  disabled: true`),
    SECTION_END,
    '',
  ].join('\n')

  const sectionRe = new RegExp(`^${escapeRegExp(SECTION_START)}[\\s\\S]*?^${escapeRegExp(SECTION_END)}[ \\t]*\\r?\\n?`, 'm')
  if (sectionRe.test(text)) {
    text = text.replace(sectionRe, section)
  } else {
    if (text.length > 0 && !text.endsWith('\n')) text += '\n'
    text += (text.endsWith('\n\n') || text.length === 0 ? '' : '\n') + section
  }

  writeFileSync(PROFILE_PATCH, text, 'utf8')
  return { id, enabled: !willDisable }
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ── HTTP 服务 ───────────────────────────────────────────────────────────────

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end(text)
}

export function buildPluginsPayload() {
  const userDisabled = readUserDisabled()

  const thirdParty = collectThirdParty().map(({ id, pkg }) => ({
    id,
    pkg,
    enabled: !userDisabled.has(id),
    kind: 'third-party',
    core: CORE_PACKAGES.has(pkg) || pkg.startsWith('@deepseek-ai/'),
  }))
  thirdParty.sort((a, b) => a.id.localeCompare(b.id, 'zh-CN'))

  const builtins = collectBuiltins().map(({ id, disabled }) => ({
    id,
    pkg: '内置（dsh-base / dsh-web-app）',
    enabled: !disabled,
    kind: 'builtin',
    core: true,
  }))
  builtins.sort((a, b) => a.id.localeCompare(b.id, 'zh-CN'))

  const all = [...thirdParty, ...builtins]
  return {
    total: all.length,
    enabled: all.filter(p => p.enabled).length,
    disabled: all.filter(p => !p.enabled).length,
    thirdPartyCount: thirdParty.length,
    builtinCount: builtins.length,
    thirdParty,
    builtins,
  }
}

/**
 * 启动 HTTP 服务（Node 模式与 Electron 模式共用）。
 * @returns {{ server: import('node:http').Server, port: number, host: string, url: string, baseDir: string }}
 */
export function startServer({ port = DEFAULT_PORT, host = HOST, publicDir = join(__dirname, 'public') } = {}) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || host}`)
    const path = url.pathname

    try {
      if (path === '/api/plugins' && req.method === 'GET') {
        sendJson(res, 200, buildPluginsPayload())
        return
      }

      const toggleMatch = path.match(/^\/api\/plugins\/([^/]+)\/toggle$/)
      if (toggleMatch && req.method === 'POST') {
        const id = decodeURIComponent(toggleMatch[1])
        const result = togglePlugin(id)
        sendJson(res, 200, result)
        return
      }

      if (path === '/api/health' && req.method === 'GET') {
        sendJson(res, 200, { ok: true, port, profilePatch: PROFILE_PATCH })
        return
      }

      // 静态文件（只服务 public 目录）
      if (req.method === 'GET') {
        const publicRoot = resolve(publicDir)
        let filePath = path === '/' ? '/index.html' : path
        filePath = resolve(publicRoot, '.' + filePath)
        if (!filePath.startsWith(publicRoot)) {
          sendText(res, 403, 'forbidden')
          return
        }
        if (existsSync(filePath) && statSync(filePath).isFile()) {
          const ext = filePath.slice(filePath.lastIndexOf('.')) || '.html'
          res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
          res.end(readFileSync(filePath))
          return
        }
      }

      sendText(res, 404, 'not found')
    } catch (err) {
      const status = err.code === 'UNKNOWN_PLUGIN' ? 400 : 500
      sendJson(res, status, { ok: false, error: err.message })
    }
  })

  return new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise)
    server.listen(port, host, () => {
      resolvePromise({
        server,
        port,
        host,
        url: `http://${host}:${port}`,
        baseDir: __dirname,
        profilePatch: PROFILE_PATCH,
      })
    })
  })
}

export { DSH_HOME, PROFILE_PATCH, PROFILE_MANIFEST, HOME_PATCH, BASE_PATCH, WEB_APP_PATCH, SECTION_START, SECTION_END, DEFAULT_PORT, HOST, CORE_PACKAGES }
