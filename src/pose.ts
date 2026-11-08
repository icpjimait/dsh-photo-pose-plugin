/**
 * Pure pose-sampling logic for the photo pose library.
 *
 * Ported 1:1 from the novel pose plugin's sample.py-compatible logic,
 * re-skinned for photography: same cooldown / strict / fallback rules,
 * same used.log sharing. No DSH imports here on purpose: this file is
 * unit-testable with plain `node --test`, and src/index.ts is only the
 * thin DSH wrapper around it.
 *
 * Data ships INSIDE this package (poses/poses.json, 60 poses / 12 scenes),
 * so the plugin works out of the box after install. Override with
 * $DSH_PHOTO_POSE_DB (poses.json path) and $DSH_PHOTO_POSE_LOG (used.log).
 * When the DB is the bundled one, used.log defaults to ~/.dsh/photo-pose-used.log
 * so installs stay clean; when the DB lives in a photo-pose-library checkout,
 * used.log sits next to it (<library>/used.log), same as the novel plugin.
 */
import { existsSync, readFileSync, appendFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

export interface Pose {
  id: string
  name: string
  category: string
  scenes: string[]
  rhythm: string
  action: string
  camera: string
  prose?: string
}

export interface SampleOptions {
  scene?: string
  scenes?: string[]
  n?: number
  cooldown?: number
  strict?: boolean
  allowRepeat?: boolean
  includeProse?: boolean
}

export interface SampleResult {
  picked: Pose[]
  excludedCount: number
  mode: string
  fallback: boolean
}

export const DEFAULT_COOLDOWN = 10

export function resolveDbPath(): string {
  if (process.env.DSH_PHOTO_POSE_DB) return resolve(process.env.DSH_PHOTO_POSE_DB)
  const candidates = [
    // Bundled data: <package>/poses/poses.json (lib/pose.js -> ../poses/poses.json)
    join(dirname(fileURLToPath(import.meta.url)), '..', 'poses', 'poses.json'),
    join(homedir(), 'workspace', 'photo-pose-library', 'poses', 'poses.json'),
    // When the plugin is checked out next to the library.
    resolve(process.cwd(), 'photo-pose-library', 'poses', 'poses.json'),
  ]
  for (const p of candidates) if (existsSync(p)) return p
  return candidates[0]
}

export function resolveLogPath(dbPath: string): string {
  if (process.env.DSH_PHOTO_POSE_LOG) return resolve(process.env.DSH_PHOTO_POSE_LOG)
  // Library checkout: <library>/poses/poses.json -> <library>/used.log
  if (dbPath.includes(`${sep}photo-pose-library${sep}poses${sep}`)) {
    return join(dirname(dirname(dbPath)), 'used.log')
  }
  return join(homedir(), '.dsh', 'photo-pose-used.log')
}

export function loadPoses(dbPath: string): Pose[] {
  let raw: string
  try {
    raw = readFileSync(dbPath, 'utf-8')
  } catch {
    throw new Error(`找不到姿势库 ${dbPath}（hint: 设 $DSH_PHOTO_POSE_DB 指向 poses.json）`)
  }
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch (e) {
    throw new Error(`poses.json 解析失败: ${e instanceof Error ? e.message : String(e)}`)
  }
  const poses = (data as { poses?: Pose[] }).poses ?? []
  if (poses.length === 0) throw new Error('姿势库为空')
  const ids = poses.map((p) => p.id)
  if (new Set(ids).size !== ids.length) throw new Error('姿势 id 有重复')
  return poses
}

export function loadUsedOrdered(logPath: string): string[] {
  if (!existsSync(logPath)) return []
  const ordered: string[] = []
  for (const line of readFileSync(logPath, 'utf-8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const m = /\bP\d+\b/.exec(trimmed)
    if (m) ordered.push(m[0])
  }
  return ordered
}

export function appendUsed(logPath: string, picked: Pick<Pose, 'id' | 'name'>[]): void {
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ')
  mkdirSync(dirname(logPath), { recursive: true })
  if (!existsSync(logPath)) {
    writeFileSync(logPath, '# 摄影姿势使用记录（时间 id 名称）—— 抽取器自动追加，永不覆盖\n', 'utf-8')
  }
  const lines = picked.map((p) => `${ts} ${p.id} ${p.name}\n`).join('')
  appendFileSync(logPath, lines, 'utf-8')
}

export function samplePoses(
  poses: Pose[],
  usedOrdered: string[],
  opts: SampleOptions = {},
): SampleResult {
  const n = opts.n ?? 3
  const cooldown = opts.cooldown ?? DEFAULT_COOLDOWN
  const scenes = opts.scenes ?? (opts.scene ? [opts.scene] : [])

  let pool = poses
  if (scenes.length > 0) {
    pool = poses.filter((p) => scenes.some((s) => p.scenes.includes(s)))
    if (pool.length === 0) {
      throw new Error(`场景 ${scenes.join('/')} 下没有姿势（hint: 用 photo_stats 看有哪些场景）`)
    }
  }

  const used = new Set(usedOrdered)
  let excluded = new Set<string>()
  let mode = '不去重'
  if (opts.strict) {
    excluded = new Set(pool.map((p) => p.id).filter((id) => used.has(id)))
    pool = pool.filter((p) => !used.has(p.id))
    mode = '严格模式'
  } else if (!opts.allowRepeat && cooldown > 0) {
    const recent = new Set(usedOrdered.slice(-cooldown))
    excluded = new Set(pool.map((p) => p.id).filter((id) => recent.has(id)))
    pool = pool.filter((p) => !recent.has(p.id))
    mode = `冷却期 ${cooldown} 次`
  }

  let fallback = false
  if (pool.length === 0) {
    // Same degradation as the novel plugin: say the cost, then redraw from cooldown.
    pool = poses.filter((p) => scenes.length === 0 || scenes.some((s) => p.scenes.includes(s)))
    excluded = new Set()
    fallback = true
  }

  // Fisher–Yates shuffle, then take n (== random.sample in sample.py).
  const shuffled = [...pool]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  const picked = shuffled.slice(0, Math.min(n, shuffled.length))
  return { picked, excludedCount: excluded.size, mode, fallback }
}

export function formatBlock(
  picked: Pose[],
  excludedCount: number,
  mode: string,
  includeProse = false,
): string {
  const lines = [`摄影姿势参考 · 本次抽取 ${picked.length} 个（${mode}，排除 ${excludedCount} 个）`]
  picked.forEach((p, i) => {
    lines.push(`${i + 1}. [${p.id}] ${p.name}（${p.category} · 适用：${p.scenes.join('/')} · 氛围：${p.rhythm}）`)
    lines.push(`  动作要领：${p.action}`)
    lines.push(`  拍摄建议：${p.camera}`)
    if (includeProse && p.prose) lines.push(`  画面描述：${p.prose}`)
  })
  lines.push('')
  lines.push('用法：按动作要领指导被摄者摆姿势，拍摄建议里的焦段、机位和光线直接照着布；')
  lines.push('抽到的姿势已记入 used.log（冷却期内不会重抽）。')
  return lines.join('\n')
}

export function poseStats(poses: Pose[], usedOrdered: string[]) {
  const byScene: Record<string, number> = {}
  const byMood: Record<string, number> = {}
  for (const p of poses) {
    for (const s of p.scenes) byScene[s] = (byScene[s] ?? 0) + 1
    byMood[p.rhythm] = (byMood[p.rhythm] ?? 0) + 1
  }
  return {
    total: poses.length,
    usedEver: new Set(usedOrdered).size,
    draws: usedOrdered.length,
    byScene,
    byMood,
  }
}
