import { test } from 'node:test'
import assert from 'node:assert/strict'
import { localizedTitle, pickUpdates, runUpdate, findUpdateRow, makeUpdateClickHandler } from '../client.js'

const entry = (overrides = {}) => ({
  name: 'dsh-better-chat',
  title: { 'zh-CN': '聊天增强', en: 'Better Chat' },
  defaultVersion: '0.3.0',
  installation: { status: 'update-available', installedVersion: '0.2.1' },
  versions: [
    { version: '0.3.0', install: { spec: 'git+https://example.test/x.git#abc' } },
    { version: '0.2.1', install: { spec: 'git+https://example.test/x.git#def' } },
  ],
  ...overrides,
})

test('localizedTitle follows the language chain', () => {
  assert.equal(localizedTitle({ 'zh-CN': '聊天增强', en: 'Better Chat' }, 'zh-CN'), '聊天增强')
  assert.equal(localizedTitle({ en: 'Better Chat' }, 'fr-FR'), 'Better Chat')
  assert.equal(localizedTitle('Plain', 'en'), 'Plain')
  assert.equal(localizedTitle(undefined, 'en'), '')
})

test('pickUpdates keeps only update-available entries with a spec', () => {
  const results = [{ value: { entries: [
    entry(),
    entry({ name: 'fresh', installation: { status: 'not-installed' } }),
    entry({ name: 'current', installation: { status: 'installed', installedVersion: '0.3.0' } }),
    entry({ name: 'nospec', versions: [{ version: '9.9.9', install: {} }] }),
  ] } }]
  const updates = pickUpdates(results, 'zh-CN')
  assert.equal(updates.length, 1)
  assert.equal(updates[0].name, 'dsh-better-chat')
  assert.equal(updates[0].title, '聊天增强')
  assert.equal(updates[0].installedVersion, '0.2.1')
  assert.equal(updates[0].version, '0.3.0')
  assert.equal(updates[0].spec, 'git+https://example.test/x.git#abc')
})

test('runUpdate calls installBundle with the spec and enabled flag', async () => {
  const calls = []
  const remote = { pluginManager: { installBundle: async (spec, options) => { calls.push([spec, options]); return { ok: true, value: { application: 'applied' } } } } }
  const update = { name: 'x', spec: 'git+https://example.test/x.git#abc', registry: 'https://registry.example' }
  const result = await runUpdate(remote, update, () => 'req-1')
  assert.equal(result.value.application, 'applied')
  assert.equal(calls[0][0], update.spec)
  assert.deepEqual(calls[0][1], { enabled: true, requestId: 'req-1', registry: 'https://registry.example' })
})

function fakeRow() {
  const label = { textContent: ' 有新版本 ', parentElement: null }
  const row = {
    textContent: '聊天增强 审批卡回车确认 0.3.0 · newbie',
    children: [],
    querySelector: () => null,
    appendChild(child) { this.children.push(child) },
  }
  label.parentElement = row
  return { label, row }
}

test('findUpdateRow locates the row for a title from its status label', () => {
  const { label, row } = fakeRow()
  const doc = { querySelectorAll: (selector) => (selector === 'button' ? [label] : []) }
  assert.equal(findUpdateRow(doc, '聊天增强'), row)
  assert.equal(findUpdateRow(doc, '不存在的插件'), null)
})

test('update click handler reports applied and failure states', async () => {
  const button = { disabled: false, textContent: '更新到 0.3.0' }
  const doc = { defaultView: { confirm: () => true } }
  const update = { name: 'x', title: '聊天增强', installedVersion: '0.2.1', version: '0.3.0', spec: 'spec' }
  const okRemote = () => ({ pluginManager: { installBundle: async () => ({ ok: true, value: { application: 'applied' } }) } })
  await makeUpdateClickHandler(doc, okRemote, update, button)({})
  assert.equal(button.textContent, '已更新，重启 DSH 后生效')

  const button2 = { disabled: false, textContent: '更新到 0.3.0' }
  const failRemote = () => ({ pluginManager: { installBundle: async () => ({ ok: true, value: { application: 'failed' } }) } })
  await makeUpdateClickHandler(doc, failRemote, update, button2)({})
  assert.equal(button2.disabled, false)
  assert.equal(button2.textContent, '更新失败，点此重试')
})
