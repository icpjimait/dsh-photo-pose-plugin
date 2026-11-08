/**
 * dsh-photo-pose-plugin — PUBLIC, clean version for the DeepSeek Harness
 * plugin developer program.
 *
 * Wraps a 60-pose photography pose library (12 scenes: 肖像室内 / 咖啡馆 /
 * 城市街头 / 公园草地 / 海边 / 黄昏日落 / 山野旅行 / 校园 / 运动场 /
 * 商务职场 / 亲子家庭 / 情侣约会) as two model-callable DSH tools.
 * Everything in the library is SFW: portrait, couple, friends, family,
 * street, sports and business poses with concrete body guidance plus
 * lens / framing / lighting notes.
 *
 * The pose data ships INSIDE this package (poses/poses.json) so the
 * plugin works out of the box after install. Override with
 * $DSH_PHOTO_POSE_DB / $DSH_PHOTO_POSE_LOG to use a custom library.
 *
 * Official shape, from "Build a tool":
 *   defineTool({ name, description, parameters, output: { schema, render },
 *                async execute(args) { ... } })
 * registered via ctx.tools.register(), with `inject = ['tools']` so Cordis
 * waits for the tool registry before apply() runs.
 * https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/tool
 *
 * Tools (names are photo-specific so this plugin never collides with the
 * private novel pose plugin when both are installed in one profile):
 *   sample_photo_pose — 按场景随机抽 N 个摄影姿势（动作要领 + 拍摄建议），
 *                 默认冷却期去重（排除最近 10 次），写 used.log。
 *   photo_pose_stats  — 库总量 / 历史抽取 / 按场景 / 按氛围。
 * Deliberately NO reset tool: the model must never be able to wipe used.log.
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  appendUsed,
  formatBlock,
  loadPoses,
  loadUsedOrdered,
  poseStats,
  resolveDbPath,
  resolveLogPath,
  samplePoses,
} from './pose.js'

export const name = 'photo-pose-plugin'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.tools.register(
    defineTool({
      name: 'sample_photo_pose',
      description:
        '从摄影姿势库按场景随机抽取拍摄姿势参考（动作要领+拍摄建议），默认冷却期去重，抽到的自动记入 used.log。拍人像、写真、情侣、闺蜜、亲子、街拍、运动、商务不知道摆什么姿势、想换个场景时调用。',
      parameters: {
        scene: { type: 'string', description: '限定场景，如 海边 / 咖啡馆 / 校园 / 黄昏日落。不填则任意场景。' },
        n: { type: 'number', description: '抽取个数，默认 3。' },
        cooldown: { type: 'number', description: '冷却期：排除最近 K 次抽取用过的姿势，默认 10，0=不冷却。' },
        strict: { type: 'boolean', description: '严格模式：历史上用过的永不重抽，默认 false。' },
        allow_repeat: { type: 'boolean', description: '不去重，全随机，默认 false。' },
        include_description: { type: 'boolean', description: '是否附带每个姿势的画面描述，默认 false。' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args) {
        const dbPath = resolveDbPath()
        const logPath = resolveLogPath(dbPath)
        const poses = loadPoses(dbPath)
        const usedOrdered = loadUsedOrdered(logPath)
        const { picked, excludedCount, mode, fallback } = samplePoses(poses, usedOrdered, {
          scene: args.scene,
          n: args.n,
          cooldown: args.cooldown,
          strict: args.strict,
          allowRepeat: args.allow_repeat,
        })
        appendUsed(logPath, picked)
        const block = formatBlock(picked, excludedCount, mode, args.include_description)
        if (!fallback) return block
        return (
          'WARN: 限定条件下可用姿势已抽完，本次从冷却中的姿势里重抽 —— 如需全新姿势，请扩充库或调大冷却期。\n' +
          block
        )
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'photo_pose_stats',
      description: '查看摄影姿势库统计：总量、历史抽取次数、按场景和按氛围分布。不知道有哪些场景可用时先调这个。',
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute() {
        const dbPath = resolveDbPath()
        const logPath = resolveLogPath(dbPath)
        const poses = loadPoses(dbPath)
        const usedOrdered = loadUsedOrdered(logPath)
        const stats = poseStats(poses, usedOrdered)
        return [
          `库总量：${stats.total} 个摄影姿势，历史抽取：${stats.draws} 次`,
          `按场景：${Object.entries(stats.byScene).sort().map(([k, v]) => `${k}${v}`).join(' ')}`,
          `按氛围：${Object.entries(stats.byMood).sort().map(([k, v]) => `${k}${v}`).join(' ')}`,
        ].join('\n')
      },
    }),
  )
}
