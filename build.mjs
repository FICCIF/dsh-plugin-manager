/**
 * DSH 插件管理器 — 一键构建脚本（Neutralino 版）
 *
 * 用法：
 *   node build.mjs win        # Windows 便携版（默认）
 *   node build.mjs mac        # macOS 通用版（Intel + Apple Silicon）
 *
 * 产物（绿色便携版，约 5MB）：
 *  Windows: dist/DSH插件管理器/{exe, neutralino.config.json, resources.neu}
 *  macOS:   dist/DSH插件管理器-mac/DSH插件管理器.app（.app 结构）
 *  便携包:  ../DSH插件管理器-v<版本>-<平台>-<架构>.zip（上传 GitHub Releases）
 */

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateRawSync, crc32 } from 'node:zlib'
import { createPackage as asarCreatePackage } from '@electron/asar'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname)

const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

const APP_NAME = 'DSH插件管理器'
const PLATFORM = process.argv[2] === 'mac' ? 'mac' : 'win'
const RESOURCES_DIR = join(ROOT, 'resources')

// ── 平台配置 ────────────────────────────────────────────────────────────────
const PLATFORMS = {
  win: {
    binary: join(ROOT, 'vendor', 'neutralino', 'neutralino-win_x64.exe'),
    outDir: join(ROOT, 'dist', APP_NAME),
    arch: 'x64',
    async build() {
      cpSync(this.binary, join(this.outDir, `${APP_NAME}.exe`))
      cpSync(join(ROOT, 'neutralino.config.json'), join(this.outDir, 'neutralino.config.json'))
      await packResources(join(this.outDir, 'resources.neu'))
    },
  },
  mac: {
    // universal 二进制：同时支持 Intel (x64) 与 Apple Silicon (arm64)
    binary: join(ROOT, 'vendor', 'neutralino', 'neutralino-mac_universal'),
    outDir: join(ROOT, 'dist', `${APP_NAME}.app`),
    arch: 'universal',
    async build() {
      const contents = join(this.outDir, 'Contents')
      const macosDir = join(contents, 'MacOS')
      const resDir = join(contents, 'Resources')
      mkdirSync(macosDir, { recursive: true })
      mkdirSync(resDir, { recursive: true })
      // 可执行文件
      cpSync(this.binary, join(macosDir, APP_NAME))
      // 资源（config + resources.neu 必须与可执行文件同级目录的 Resources/）
      cpSync(join(ROOT, 'neutralino.config.json'), join(resDir, 'neutralino.config.json'))
      await packResources(join(resDir, 'resources.neu'))
      // Info.plist
      writeFileSync(join(contents, 'Info.plist'), INFO_PLIST)
    },
  },
}

/**
 * 打包 resources.neu —— 官方同款 ASAR 格式（neu CLI 内部即用
 * @electron/asar 的 createPackage，绝不是 zip！）
 * 注意：neutralino.config.json 也要一并打进资源包（与官方一致）。
 */
async function packResources(dest) {
  const tmp = mkdtempSync(join(tmpdir(), 'dshpm-res-'))
  try {
    cpSync(RESOURCES_DIR, join(tmp, 'resources'), { recursive: true })
    cpSync(join(ROOT, 'neutralino.config.json'), join(tmp, 'neutralino.config.json'))
    await asarCreatePackage(tmp, dest)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

const INFO_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>${APP_NAME}</string>
  <key>CFBundleDisplayName</key>
  <string>${APP_NAME}</string>
  <key>CFBundleIdentifier</key>
  <string>com.ficcif.dsh-plugin-manager</string>
  <key>CFBundleVersion</key>
  <string>${version}</string>
  <key>CFBundleShortVersionString</key>
  <string>${version}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleExecutable</key>
  <string>${APP_NAME}</string>
  <key>LSMinimumSystemVersion</key>
  <string>10.13</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
`

function log(msg) {
  console.log('[' + APP_NAME + '] ' + msg)
}

function sizeMB(p) {
  return statSync(p).size / 1024 / 1024
}

// ── 前端资源收集与 zip 生成 ─────────────────────────────────────────────────

function collectFiles(dir, base = '') {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? base + '/' + e.name : e.name
    const full = join(dir, e.name)
    if (e.isDirectory()) out.push(...collectFiles(full, rel))
    else out.push({ name: rel, data: readFileSync(full) })
  }
  return out
}

/** 标准 zip（deflate）生成器：保证与 Neutralino 的 minizip 读取器兼容 */
function makeZip(files) {
  const parts = []
  const central = []
  let offset = 0
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8')
    // 注意：zip 的 method 8 要求「原始 deflate 流」——必须用 deflateRawSync，
    // 不能用 deflateSync（后者带 zlib 头，解压端会失败）
    const data = deflateRawSync(f.data)
    const crc = crc32(f.data)

    // Unix 权限位写入 external attrs 高 16 位（mac 可执行文件需要 0755）
    const extAttrs = f.mode ? ((0x8000 | f.mode) << 16) >>> 0 : 0

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(8, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0x21, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(f.data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    parts.push(local, nameBuf, data)

    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(0x0800, 8)
    cd.writeUInt16LE(8, 10)
    cd.writeUInt16LE(0, 12)
    cd.writeUInt16LE(0x21, 14)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(data.length, 20)
    cd.writeUInt32LE(f.data.length, 24)
    cd.writeUInt16LE(nameBuf.length, 28)
    cd.writeUInt16LE(0, 30)
    cd.writeUInt16LE(0, 32)
    cd.writeUInt16LE(0, 34)
    cd.writeUInt16LE(0, 36)
    cd.writeUInt32LE(extAttrs, 38)
    cd.writeUInt32LE(offset, 42)
    central.push(cd, nameBuf)

    offset += 30 + nameBuf.length + data.length
  }

  const cdStart = offset
  const cdSize = central.reduce((s, b) => s + b.length, 0)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(cdSize, 12)
  eocd.writeUInt32LE(cdStart, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([...parts, ...central, eocd])
}

/** 递归收集目录树，可指定可执行文件（写 Unix 0755 权限位） */
function collectTree(dir, base = '', executable = null) {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? base + '/' + e.name : e.name
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      out.push(...collectTree(full, rel, executable))
    } else {
      out.push({
        name: rel,
        data: readFileSync(full),
        mode: rel === executable ? 0o755 : 0o644,
      })
    }
  }
  return out
}

// ── 主流程 ──────────────────────────────────────────────────────────────────

const cfg = PLATFORMS[PLATFORM]
const zipName = `${APP_NAME}-v${version}-${PLATFORM}-${cfg.arch}.zip`
const ZIP_PATH = join(dirname(ROOT), zipName)

log(`1/4 组装输出目录 (${PLATFORM}/${cfg.arch})...`)
if (existsSync(cfg.outDir)) rmSync(cfg.outDir, { recursive: true, force: true })
mkdirSync(cfg.outDir, { recursive: true })

log('2/4 复制运行时与配置...')
cfg.build()

log('3/4 打包前端资源 (resources.neu)...')

log('4/4 压缩便携包...')
if (existsSync(ZIP_PATH)) rmSync(ZIP_PATH)
// 便携包用内置 zip 生成器：保留 Unix 权限位（mac 解压后可直接运行）
writeFileSync(ZIP_PATH, makeZip(collectTree(cfg.outDir, PLATFORM === 'mac' ? `${APP_NAME}.app` : APP_NAME, PLATFORM === 'mac' ? `${APP_NAME}.app/Contents/MacOS/${APP_NAME}` : null)))

const total = sizeMB(cfg.outDir)
const zipMB = statSync(ZIP_PATH).size / 1024 / 1024
console.log('')
console.log('✅ 构建完成！')
console.log(`   应用目录: ${cfg.outDir}`)
console.log(`   便携包:   ${ZIP_PATH} (${zipMB.toFixed(1)}MB)`)

