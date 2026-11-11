// Feature 2 (permission policy) unit tests with a fake DOM + fake sessions.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  AUTO_REVIEW_PRESET,
  FULL_ACCESS_PRESET,
  currentPreset,
  installPermissionPolicy,
  isFullAccessLabel,
  liveSessions,
  pruneFullAccess,
  shouldAutoSwitch,
} from '../client.js'

globalThis.MutationObserver = class { observe() {} disconnect() {} }

test('preset machine values match the host catalog', () => {
  assert.equal(FULL_ACCESS_PRESET, 'danger-full-access')
  assert.equal(AUTO_REVIEW_PRESET, 'auto')
})

test('isFullAccessLabel matches zh/en labels at the start only', () => {
  assert.equal(isFullAccessLabel('完全权限'), true)
  assert.equal(isFullAccessLabel('完全权限 让代理不受限制地执行'), true)
  assert.equal(isFullAccessLabel('Full access'), true)
  assert.equal(isFullAccessLabel('自动审查'), false)
  assert.equal(isFullAccessLabel('仅可查看'), false)
  assert.equal(isFullAccessLabel('工作区内修改'), false)
  assert.equal(isFullAccessLabel(''), false)
  assert.equal(isFullAccessLabel(null), false)
})

test('shouldAutoSwitch: only known non-auto presets, once', () => {
  assert.equal(shouldAutoSwitch('workspace-write', false), true)
  assert.equal(shouldAutoSwitch('danger-full-access', false), true)
  assert.equal(shouldAutoSwitch('auto', false), false)
  assert.equal(shouldAutoSwitch(undefined, false), false)
  assert.equal(shouldAutoSwitch('workspace-write', true), false)
})

function fakeEl(text) {
  return { textContent: text, removed: false, remove() { this.removed = true } }
}

test('pruneFullAccess removes full-access from selects, listboxes and menus', () => {
  const opts = [fakeEl('仅可查看'), fakeEl('完全权限'), fakeEl('工作区内修改')]
  const items = [fakeEl('自动审查EXP'), fakeEl('完全权限'), fakeEl('Full access'), fakeEl('仅可查看')]
  const doc = {
    querySelectorAll(sel) {
      if (sel === 'option') return opts
      if (sel.includes('listbox')) return items
      return []
    },
  }
  assert.equal(pruneFullAccess(doc), 3)
  assert.deepEqual(opts.map((o) => o.removed), [false, true, false])
  assert.deepEqual(items.map((o) => o.removed), [false, true, true, false])
})

test('liveSessions: keys+binding, list fallback, hostile shapes', () => {
  const live = { sessionId: 's1' }
  const viaKeys = liveSessions({ keys: () => ['s1', 's2'], binding: (id) => (id === 's1' ? { session: live } : undefined) })
  assert.deepEqual(viaKeys.map((x) => x.id), ['s1'])
  const viaList = liveSessions({ list: () => [{ sessionId: 'a' }, { nope: 1 }] })
  assert.deepEqual(viaList.map((x) => x.id), ['a'])
  assert.deepEqual(liveSessions({ keys: () => { throw new Error('x') } }), [])
  assert.deepEqual(liveSessions(undefined), [])
  assert.deepEqual(liveSessions(42), [])
})

test('currentPreset reads the permissions projection defensively', () => {
  const live = { projections: { faceOf: (n) => (n === 'permissions' ? { getSnapshot: () => 'workspace-write' } : undefined) } }
  assert.equal(currentPreset(live), 'workspace-write')
  assert.equal(currentPreset({}), undefined)
  assert.equal(currentPreset({ projections: { faceOf: () => { throw new Error('x') } } }), undefined)
})

function fakeTimers() {
  const intervals = new Map()
  let next = 1
  return {
    setInterval(fn) { const id = next++; intervals.set(id, fn); return id },
    clearInterval(id) { intervals.delete(id) },
    setTimeout(fn) { fn(); return 0 },
    clearTimeout() {},
    async runIntervals() { for (const fn of [...intervals.values()]) await fn() },
    get size() { return intervals.size },
  }
}

function fakeLive(preset, fail = false) {
  const calls = []
  return {
    calls,
    projections: { faceOf: () => ({ getSnapshot: () => preset }) },
    async command(text) {
      calls.push(text)
      if (fail) return { ok: false, error: { code: 'unavailable' } }
      return { ok: true, value: { matched: true } }
    },
  }
}

test('policy: first sight of a non-auto session switches it once', async () => {
  const timers = fakeTimers()
  const live = fakeLive('workspace-write')
  const sessions = { keys: () => ['s1'], binding: () => ({ session: live }) }
  const doc = { body: {}, querySelectorAll: () => [] }
  const dispose = installPermissionPolicy(doc, () => sessions, timers)
  await timers.runIntervals()
  await timers.runIntervals()
  assert.deepEqual(live.calls, ['/permission auto'])
  dispose()
  assert.equal(timers.size, 0)
})

test('policy: already-auto sessions are left alone; failures are not retried', async () => {
  const timers = fakeTimers()
  const autoLive = fakeLive('auto')
  const failLive = fakeLive('read-only', true)
  const sessions = {
    keys: () => ['a', 'b'],
    binding: (id) => ({ session: id === 'a' ? autoLive : failLive }),
  }
  const doc = { body: {}, querySelectorAll: () => [] }
  const dispose = installPermissionPolicy(doc, () => sessions, timers)
  await timers.runIntervals()
  await timers.runIntervals()
  assert.deepEqual(autoLive.calls, [])
  assert.deepEqual(failLive.calls, ['/permission auto'])
  dispose()
})
