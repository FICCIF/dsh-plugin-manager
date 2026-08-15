/**
 * DSH 插件管理器 — 业务逻辑（Neutralino 版）
 *
 * 从原 Node 版（app.mjs）移植：
 *  - 文件读写改用 Neutralino.filesystem API（页面运行在系统 WebView2 内）
 *  - 正则解析逻辑原样保留（纯 JS，无 Node 依赖）
 *
 * 注意：条目 id ≠ 包名（如包 dsh-claude-move 的条目 id 是 claude-move），
 *       本程序一律使用补丁文件中的真实条目 id。
 */

// ── 路径常量（需与 neutralino.config.json 的 filesystem.allowedPaths 一致） ──
const DSH_HOME = 'C:/Users/Administrator/.dsh'
const PROFILE_DIR = DSH_HOME + '/profiles/web'
const PROFILE_PATCH = PROFILE_DIR + '/cordis.patch.yml'
const PROFILE_MANIFEST = PROFILE_DIR + '/package.json'
const HOME_PATCH = DSH_HOME + '/cordis.patch.yml'
const NODE_MODULES = PROFILE_DIR + '/node_modules'
const DSH_REPO = 'C:/Users/Administrator/deepseek-harness'
const BASE_PATCH = DSH_REPO + '/packages/bundle/base/cordis.patch.yml'
const WEB_APP_PATCH = DSH_REPO + '/packages/bundle/web-app/cordis.patch.yml'

// 本程序管理的 section 标记
const SECTION_START = '# --- dsh-plugin-manager managed (auto-generated; do not edit) ---'
const SECTION_END = '# --- end dsh-plugin-manager ---'

// 核心包：停用会导致系统功能明显受损
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

// ── 文件读写（Neutralino） ──────────────────────────────────────────────────

/** 读取文件；不存在/失败返回空串 */
async function readFileSafe(path) {
  try {
    return await Neutralino.filesystem.readFile(path)
  } catch {
    return ''
  }
}

/** 读取 JSON；失败返回 null */
async function readJsonSafe(path) {
  const text = await readFileSafe(path)
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

// ── 补丁解析（纯 JS 正则，与 Node 版一致） ─────────────────────────────────

/** 提取 insert 块内的条目 id */
function extractInsertedIds(text) {
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

/** 提取所有条目 id（顶层 + insert 内） */
function extractAllEntryIds(text) {
  const ids = new Set()
  const re = /- id:\s*([^\s#]+)/g
  let m
  while ((m = re.exec(text)) !== null) ids.add(m[1])
  return ids
}

/** 提取被 disabled 的条目 id */
function extractDisabledIds(text) {
  const ids = new Set()
  const re = /- id:\s*([^\s#]+)(?:\r?\n\s*)?(?:#[^\r\n]*\r?\n\s*)?disabled:\s*true/g
  let m
  while ((m = re.exec(text)) !== null) ids.add(m[1])
  return ids
}

// ── 插件条目枚举 ────────────────────────────────────────────────────────────

/** 枚举第三方条目：[{ id, pkg }] */
async function collectThirdParty() {
  const items = []
  const seen = new Set()
  const push = (id, pkg) => {
    if (id && !seen.has(id)) {
      seen.add(id)
      items.push({ id, pkg })
    }
  }

  const manifest = await readJsonSafe(PROFILE_MANIFEST)
  const bundles = manifest?.dsh?.profile?.bundles ?? []
  for (const pkg of bundles) {
    // 内置包（dsh-base / dsh-web-app）不在 node_modules，读取失败返回空串 -> 无条目
    const patchText = await readFileSafe(NODE_MODULES + '/' + pkg + '/cordis.patch.yml')
    for (const id of extractInsertedIds(patchText)) push(id, pkg)
  }

  // 全局补丁 insert（皮肤等）
  for (const id of extractInsertedIds(await readFileSafe(HOME_PATCH))) push(id, '（全局补丁）')

  // 用户补丁 insert（兜底）
  for (const id of extractInsertedIds(await readFileSafe(PROFILE_PATCH))) push(id, '（用户补丁）')

  return items
}

/** 枚举内置条目（只读）：[{ id, disabled }] */
async function collectBuiltins() {
  const baseText = await readFileSafe(BASE_PATCH)
  const webText = await readFileSafe(WEB_APP_PATCH)
  const ids = new Set([...extractAllEntryIds(baseText), ...extractAllEntryIds(webText)])
  const disabled = new Set([...extractDisabledIds(baseText), ...extractDisabledIds(webText)])
  return [...ids].map(id => ({ id, disabled: disabled.has(id) }))
}

/** 当前停用集合（用户层 + 全局补丁） */
async function readUserDisabled() {
  const disabled = new Set()
  for (const id of extractDisabledIds(await readFileSafe(PROFILE_PATCH))) disabled.add(id)
  for (const id of extractDisabledIds(await readFileSafe(HOME_PATCH))) disabled.add(id)
  return disabled
}

// ── 切换启停（写补丁文件） ─────────────────────────────────────────────────

/**
 * 切换一个第三方条目的启停状态。
 * 只重写 cordis.patch.yml 中本程序管理的 section，其余内容原样保留。
 */
async function togglePlugin(id) {
  const thirdParty = await collectThirdParty()
  if (!thirdParty.some(p => p.id === id)) {
    throw new Error('未知插件条目 id: ' + id + '（内置条目不可操作）')
  }

  let text = await readFileSafe(PROFILE_PATCH)
  const disabled = await readUserDisabled()
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

  const sectionRe = new RegExp('^' + escapeRegExp(SECTION_START) + '[\\s\\S]*?^' + escapeRegExp(SECTION_END) + '[ \\t]*\\r?\\n?', 'm')
  if (sectionRe.test(text)) {
    text = text.replace(sectionRe, section)
  } else {
    if (text.length > 0 && !text.endsWith('\n')) text += '\n'
    text += (text.endsWith('\n\n') || text.length === 0 ? '' : '\n') + section
  }

  await Neutralino.filesystem.writeFile(PROFILE_PATCH, text)
  return { id, enabled: !willDisable }
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ── 组装页面数据 ────────────────────────────────────────────────────────────

async function buildPayload() {
  const userDisabled = await readUserDisabled()

  const thirdParty = (await collectThirdParty()).map(({ id, pkg }) => ({
    id,
    pkg,
    enabled: !userDisabled.has(id),
    kind: 'third-party',
    core: CORE_PACKAGES.has(pkg) || pkg.startsWith('@deepseek-ai/'),
  }))
  thirdParty.sort((a, b) => a.id.localeCompare(b.id, 'zh-CN'))

  const builtins = (await collectBuiltins()).map(({ id, disabled }) => ({
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

// 暴露给页面
window.DSHPluginManager = {
  list: buildPayload,
  toggle: togglePlugin,
}
