// dsh-better-chat 审批快捷键：纯判定与按钮定位的单元测试（假 DOM，零依赖）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { actionButtons, findPendingCard, decideKeyAction, shouldAutoFocus } from '../client.js'

// --- 极小假 DOM：只实现 client.js 用到的表面 ---
function matches(el, selector) {
  return selector.split(',').some((part) => {
    const s = part.trim()
    if (s.startsWith('[')) {
      const m = s.match(/^\[([a-zA-Z-]+)(?:="([^"]*)")?\]$/)
      if (!m) return false
      const v = el.attrs[m[1]]
      return m[2] === undefined ? v !== undefined : v === m[2]
    }
    return el.tag === s
  })
}
class El {
  constructor(tag, attrs = {}, children = []) {
    this.tag = tag; this.attrs = attrs; this.children = []; this.parent = null
    this.disabled = false; this.clicks = 0; this.focused = 0; this.ownerDocument = null
    for (const c of children) this.append(c)
  }
  append(c) { c.parent = this; this.children.push(c); return c }
  getAttribute(n) { return this.attrs[n] ?? null }
  closest(sel) { let e = this; while (e) { if (matches(e, sel)) return e; e = e.parent } return null }
  contains(other) { let e = other; while (e) { if (e === this) return true; e = e.parent } return false }
  querySelectorAll(sel) { const out = []; const walk = (e) => { for (const c of e.children) { if (matches(c, sel)) out.push(c); walk(c) } }; walk(this); return out }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null }
  click() { this.clicks++ }
  focus() { this.focused++ }
}
function approvalCard({ busy = false, withAlways = false, detailButton = false } = {}) {
  const scrollChildren = detailButton ? [new El('button')] : []
  const card = new El('div', { 'data-approval-key': 'k1', ...(busy ? { 'aria-busy': 'true' } : {}) }, [
    new El('div', { 'data-approval-scroll': '' }, scrollChildren),
    new El('div', {}, [
      new El('button'), // 拒绝
      new El('button'), // 允许（单次）
      ...(withAlways ? [new El('button')] : []), // 始终允许
    ]),
  ])
  return card
}
const baseInput = {
  key: 'Enter', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
  repeat: false, isComposing: false, keyCode: 13, defaultPrevented: false,
  target: new El('div'), activeElement: new El('body'), card: approvalCard(),
}

test('回车 → allow，Esc → reject（焦点不在卡内、非输入状态）', () => {
  assert.equal(decideKeyAction(baseInput), 'allow')
  assert.equal(decideKeyAction({ ...baseInput, key: 'Escape', keyCode: 27 }), 'reject')
})
test('没有待审批卡 → 不管', () => {
  assert.equal(decideKeyAction({ ...baseInput, card: null }), null)
})
test('焦点已在卡内 → 交给官方处理', () => {
  const card = approvalCard()
  const inside = card.querySelector('[data-approval-scroll]')
  assert.equal(decideKeyAction({ ...baseInput, card, activeElement: inside }), null)
})
test('正在输入控件里打字 → 不管（textarea / input / contenteditable）', () => {
  for (const target of [new El('textarea'), new El('input'), new El('div', { contenteditable: 'true' })]) {
    assert.equal(decideKeyAction({ ...baseInput, target }), null)
    assert.equal(decideKeyAction({ ...baseInput, target, key: 'Escape', keyCode: 27 }), null)
  }
})
test('修饰键、连发、输入法组词、已被处理 → 不管', () => {
  assert.equal(decideKeyAction({ ...baseInput, ctrlKey: true }), null)
  assert.equal(decideKeyAction({ ...baseInput, shiftKey: true }), null)
  assert.equal(decideKeyAction({ ...baseInput, repeat: true }), null)
  assert.equal(decideKeyAction({ ...baseInput, isComposing: true }), null)
  assert.equal(decideKeyAction({ ...baseInput, keyCode: 229 }), null)
  assert.equal(decideKeyAction({ ...baseInput, defaultPrevented: true }), null)
  assert.equal(decideKeyAction({ ...baseInput, key: 'a', keyCode: 65 }), null)
})
test('回车落在别的按钮上 → 保留按钮原生行为；Esc 不受此限', () => {
  const btn = new El('button')
  assert.equal(decideKeyAction({ ...baseInput, target: btn }), null)
  assert.equal(decideKeyAction({ ...baseInput, target: btn, key: 'Escape', keyCode: 27 }), 'reject')
})
test('actionButtons：跳过详情区内的按钮，顺序为 [拒绝, 允许, 始终允许?]', () => {
  const card = approvalCard({ withAlways: true, detailButton: true })
  const buttons = actionButtons(card)
  assert.equal(buttons.length, 3)
  assert.equal(buttons.includes(card.querySelector('[data-approval-scroll]').children[0]), false)
})
test('findPendingCard：跳过已作答与按钮被禁用的卡', () => {
  const doc = new El('div', {}, [approvalCard({ busy: true }), approvalCard()])
  const found = findPendingCard(doc)
  assert.ok(found)
  assert.equal(found.getAttribute('aria-busy'), null)
  const disabledCard = approvalCard(); actionButtons(disabledCard)[1].disabled = true
  const doc2 = new El('div', {}, [disabledCard])
  assert.equal(findPendingCard(doc2), null)
})
test('shouldAutoFocus：主体焦点可送入，别处输入不抢，已在卡内不重复', () => {
  const card = approvalCard()
  const doc = { body: new El('body') }; card.ownerDocument = doc
  assert.equal(shouldAutoFocus(null, card), true)
  assert.equal(shouldAutoFocus(doc.body, card), true)
  assert.equal(shouldAutoFocus(new El('textarea'), card), false)
  assert.equal(shouldAutoFocus(card.querySelector('[data-approval-scroll]'), card), false)
  assert.equal(shouldAutoFocus(new El('div'), card), true)
})
