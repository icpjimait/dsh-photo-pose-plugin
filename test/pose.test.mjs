import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadPoses, loadUsedOrdered, samplePoses, formatBlock, poseStats } from '../lib/pose.js'

function makeDb() {
  const dir = mkdtempSync(join(tmpdir(), 'pose-test-'))
  const poses = [
    { id: 'P001', name: '测试姿势A', category: '测试', scenes: ['卧室'], rhythm: '慢', action: '动作A', camera: '镜头A' },
    { id: 'P002', name: '测试姿势B', category: '测试', scenes: ['卧室', '浴室'], rhythm: '快', action: '动作B', camera: '镜头B' },
    { id: 'P003', name: '测试姿势C', category: '测试', scenes: ['浴室'], rhythm: '慢', action: '动作C', camera: '镜头C' },
  ]
  const dbPath = join(dir, 'poses.json')
  writeFileSync(dbPath, JSON.stringify({ poses }, null, 2), 'utf-8')
  return { dir, dbPath, poses }
}

test('loadPoses 读库并校验', () => {
  const { dbPath } = makeDb()
  assert.equal(loadPoses(dbPath).length, 3)
})

test('按场景过滤', () => {
  const { poses } = makeDb()
  const r = samplePoses(poses, [], { scene: '浴室', n: 3, cooldown: 0 })
  assert.equal(r.picked.length, 2)
  assert.ok(r.picked.every((p) => p.scenes.includes('浴室')))
})

test('冷却期排除最近用过的', () => {
  const { poses } = makeDb()
  // P001, P002 最近用过，冷却 10 -> 卧室只剩 P002？不，P002 也在最近里，所以只剩 0 -> fallback
  // 用更小的例子：只排除 P001
  const r = samplePoses(poses, ['P001'], { scene: '卧室', n: 3, cooldown: 10 })
  assert.ok(r.picked.every((p) => p.id !== 'P001'))
  assert.equal(r.excludedCount, 1)
})

test('严格模式排除所有历史', () => {
  const { poses } = makeDb()
  const r = samplePoses(poses, ['P001', 'P002'], { n: 3, strict: true })
  assert.deepEqual(r.picked.map((p) => p.id), ['P003'])
})

test('池子抽完时 fallback 重抽并标记', () => {
  const { poses } = makeDb()
  const r = samplePoses(poses, ['P001', 'P002', 'P003'], { n: 2, strict: true })
  assert.equal(r.fallback, true)
  assert.equal(r.picked.length, 2)
})

test('stats 按场景/节奏计数', () => {
  const { poses } = makeDb()
  const s = poseStats(poses, ['P001', 'P001', 'P002'])
  assert.equal(s.total, 3)
  assert.equal(s.usedEver, 2)
  assert.equal(s.draws, 3)
  assert.equal(s.byScene['卧室'], 2)
})

test('formatBlock 带 id 和镜头', () => {
  const { poses } = makeDb()
  const out = formatBlock([poses[0]], 0, '冷却期 10 次')
  assert.ok(out.includes('[P001]'))
  assert.ok(out.includes('镜头A'))
})

test('loadUsedOrdered 只取每行第一个 P 编号', () => {
  const { dir } = makeDb()
  const logPath = join(dir, 'used.log')
  writeFileSync(logPath, '# comment\n2026-11-08 04:00:00 P001 测试姿势A\n2026-11-08 04:01:00 P002 测试姿势B\n', 'utf-8')
  assert.deepEqual(loadUsedOrdered(logPath), ['P001', 'P002'])
})
