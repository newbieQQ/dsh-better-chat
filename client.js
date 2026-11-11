/**
 * dsh-better-chat 客户端：让审批卡片的回车 / Esc 不再挑焦点。
 *
 * 背景（DSH 0.2.2-rc.1 的 @deepseek-ai/dsh-client-ui-approval）：
 * 官方审批卡自带键盘处理 —— Enter 批准（单次）、Esc 拒绝 —— 但它的
 * keydown 挂在卡片根节点上，且要求焦点先落在卡片内。审批弹出时焦点
 * 往往还在对话区/页面主体上，按回车毫无反应，必须先点一下卡片。
 *
 * 本模块补两件事，不改官方任何逻辑：
 * 1. 审批卡出现时，若用户没有正在别处输入，把焦点送进卡片的详情区
 *    （[data-approval-scroll]，本身 tabIndex=0），官方处理立即生效。
 * 2. 焦点不在卡片内时兜底路由：在 document 捕获阶段监听 keydown，
 *    满足全部防误触条件时，点击卡片操作行里的按钮 —— 顺序由官方渲染
 *    固定为 [拒绝, 允许（单次）, 始终允许?]，回车点「允许（单次）」，
 *    永远不会误触「始终允许」；Esc 点「拒绝」。
 *
 * 防误触（与官方卡片内部规则对齐）：
 * - 正在任何输入控件（input/textarea/select/contenteditable）里打字 → 不管
 * - 焦点已在卡片内 → 官方处理，绝不重复作答
 * - 带 Ctrl/Meta/Alt/Shift、长按连发、输入法组词中 → 不管
 * - 回车落在某个按钮/链接上 → 保留那个按钮自己的回车行为
 * - 卡片已作答（aria-busy=true）或按钮禁用 → 不管
 */

const CARD_SELECTOR = '[data-approval-key]'
const SCROLL_SELECTOR = '[data-approval-scroll]'
const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable="true"], [contenteditable=""]'

/** 卡片操作行的按钮：详情滚动区之外的全部按钮，顺序 [拒绝, 允许, 始终允许?]。 */
export function actionButtons(card) {
  return [...card.querySelectorAll('button')].filter((b) => !b.closest(SCROLL_SELECTOR))
}

/** 找当前可作答的审批卡（DOM 顺序第一张未作答、按钮齐全的卡）。 */
export function findPendingCard(doc) {
  for (const card of doc.querySelectorAll(CARD_SELECTOR)) {
    if (card.getAttribute('aria-busy') === 'true') continue
    const buttons = actionButtons(card)
    if (buttons.length >= 2 && !buttons[0].disabled && !buttons[1].disabled) return card
  }
  return null
}

/**
 * 纯判定：这次 keydown 是否应该路由到审批卡。
 * @returns {'allow'|'reject'|null}
 */
export function decideKeyAction(input) {
  const { key, ctrlKey, metaKey, altKey, shiftKey, repeat, isComposing, keyCode, defaultPrevented, target, activeElement, card } = input
  if (!card) return null
  if (defaultPrevented) return null
  if (key !== 'Enter' && key !== 'Escape') return null
  if (ctrlKey || metaKey || altKey || shiftKey) return null
  if (repeat || isComposing || keyCode === 229) return null
  if (activeElement && card.contains(activeElement)) return null // 焦点在卡内：官方处理
  if (target && typeof target.closest === 'function') {
    if (target.closest(EDITABLE_SELECTOR) !== null) return null // 正在别处输入
    if (key === 'Enter' && target.closest('button, a[href], [role="button"]') !== null) return null
  }
  return key === 'Enter' ? 'allow' : 'reject'
}

/** 纯判定：审批卡出现时是否应该把焦点送进详情区。 */
export function shouldAutoFocus(activeElement, card) {
  if (!activeElement) return true
  if (activeElement === card.ownerDocument?.body) return true
  if (card.contains(activeElement)) return false // 已经在卡里
  if (typeof activeElement.closest === 'function' && activeElement.closest(EDITABLE_SELECTOR) !== null) return false // 正在别处输入
  return true
}

function install(doc) {
  const focusedCards = new WeakSet()

  const tryAutoFocus = () => {
    const card = findPendingCard(doc)
    if (!card || focusedCards.has(card)) return
    focusedCards.add(card)
    if (!shouldAutoFocus(doc.activeElement, card)) return
    const region = card.querySelector(SCROLL_SELECTOR)
    if (region && typeof region.focus === 'function') region.focus()
  }

  const observer = new MutationObserver(tryAutoFocus)
  observer.observe(doc.documentElement, { childList: true, subtree: true })
  tryAutoFocus()

  const onKeyDown = (event) => {
    const card = findPendingCard(doc)
    const action = decideKeyAction({
      key: event.key,
      ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey, shiftKey: event.shiftKey,
      repeat: event.repeat, isComposing: event.isComposing, keyCode: event.keyCode,
      defaultPrevented: event.defaultPrevented,
      target: event.target, activeElement: doc.activeElement, card,
    })
    if (!action) return
    const buttons = actionButtons(card)
    const button = action === 'allow' ? buttons[1] : buttons[0]
    if (!button || button.disabled) return
    event.preventDefault()
    event.stopPropagation()
    button.click()
  }
  doc.addEventListener('keydown', onKeyDown, true)

  return () => {
    observer.disconnect()
    doc.removeEventListener('keydown', onKeyDown, true)
  }
}

/**
 * 功能二：权限策略 —— 去掉「完全权限」选项，新会话默认「自动审查」。
 *
 * 背景（DSH 0.2.2-rc.1 的权限预设，@deepseek-ai/dsh-client-ui-permission-presets）：
 * 会话权限有四个预设值：read-only（仅可查看）、workspace-write（工作区内
 * 修改）、danger-full-access（完全权限）、auto（自动审查，EXP）。「自动
 * 审查」由实验层 @deepseek-ai/dsh-experimental-auto-review 提供：开启该层
 * 后才出现在当前会话的选择器里；通用设置不提供 auto，新会话默认值里
 * 也选不到它。宿主切换预设的通道是会话对象的 command(`/permission <值>`)，
 * 带参命令直接生效、不弹风险确认。
 *
 * 本功能补两件事：
 * 1. 界面移除完全权限：观察 DOM，把选择器/菜单/设置下拉里标签为「完全
 *    权限 / Full access」的选项摘掉。只动界面——直接输入 /permission
 *    danger-full-access 命令仍可达（宿主行为，不在本插件管辖内）。
 * 2. 默认自动审查：轮询会话服务，第一次见到某个会话且其权限不是 auto
 *    时，用宿主同一条命令通道切到 auto。每个会话只尝试一次：之后用户
 *    手动改走，本插件不再干预；auto 不可用（实验层没开）时命令会失败，
 *    记录一次日志便不再重试。
 */

/** 完全权限的预设机器值。 */
export const FULL_ACCESS_PRESET = 'danger-full-access'
/** 自动审查的预设机器值。 */
export const AUTO_REVIEW_PRESET = 'auto'
/** 完全权限在各语言界面里的选项标签（选项文字以标签开头）。 */
export const FULL_ACCESS_LABELS = ['完全权限', 'Full access']

/** 纯判定：一段选项文字是否就是「完全权限」选项（标签打头，或恰好相等）。 */
export function isFullAccessLabel(text) {
  if (typeof text !== 'string') return false
  const t = text.trim()
  return FULL_ACCESS_LABELS.some((label) => t === label || t.startsWith(label))
}

/** 纯判定：这个会话现在是否应该被切到自动审查。 */
export function shouldAutoSwitch(preset, alreadyHandled) {
  return preset !== undefined && preset !== null && preset !== AUTO_REVIEW_PRESET && !alreadyHandled
}

/**
 * 防御式枚举宿主的 live 会话：优先 keys()+binding()，退回 list()。
 * 服务形状对不上时安静返回空数组，绝不抛错。
 */
export function liveSessions(sessions) {
  const out = []
  if (!sessions || typeof sessions !== 'object') return out
  try {
    if (typeof sessions.keys === 'function' && typeof sessions.binding === 'function') {
      for (const id of sessions.keys()) {
        const live = sessions.binding(id)?.session
        if (live) out.push({ id, live })
      }
      return out
    }
    if (typeof sessions.list === 'function') {
      for (const s of sessions.list() ?? []) {
        if (s && s.sessionId) out.push({ id: s.sessionId, live: s })
      }
    }
  } catch { /* 服务形状不同：放弃枚举 */ }
  return out
}

/** 读会话当前的权限预设值（投影不可用时返回 undefined）。 */
export function currentPreset(live) {
  try {
    return live?.projections?.faceOf('permissions')?.getSnapshot?.()
  } catch {
    return undefined
  }
}

/**
 * 把「完全权限」选项从当前文档里摘掉：原生 select 的 option、弹出
 * 选择器（role=listbox）与菜单（role=menu）里的 option/menuitem。
 * @returns 摘掉的个数
 */
export function pruneFullAccess(doc) {
  let removed = 0
  for (const opt of doc.querySelectorAll('option')) {
    if (isFullAccessLabel(opt.textContent)) { opt.remove(); removed++ }
  }
  for (const item of doc.querySelectorAll('[role="listbox"] [role="option"], [role="menu"] [role="menuitem"]')) {
    if (isFullAccessLabel(item.textContent)) { item.remove(); removed++ }
  }
  return removed
}

/**
 * 安装权限策略：DOM 观察（防抖扫描）+ 会话轮询（默认 auto）。
 * getSessions 每次调用现取 ctx.sessions（服务可能晚于插件就绪）。
 * @returns 卸载函数
 */
export function installPermissionPolicy(doc, getSessions, timers = { setInterval, clearInterval, setTimeout, clearTimeout }) {
  let disposed = false
  let scanTimer = 0
  const scheduleScan = () => {
    if (disposed || scanTimer) return
    scanTimer = timers.setTimeout(() => {
      scanTimer = 0
      if (!disposed) pruneFullAccess(doc)
    }, 120)
  }
  const observer = new MutationObserver(scheduleScan)
  if (doc.body) observer.observe(doc.body, { childList: true, subtree: true })
  pruneFullAccess(doc)

  const handled = new Set()
  const tick = async () => {
    if (disposed) return
    let sessions
    try { sessions = getSessions() } catch { return }
    for (const { id, live } of liveSessions(sessions)) {
      if (handled.has(id)) continue
      const preset = currentPreset(live)
      if (!shouldAutoSwitch(preset, handled.has(id))) {
        if (preset !== undefined && preset !== null) handled.add(id)
        continue
      }
      handled.add(id)
      if (typeof live.command !== 'function') continue
      try {
        const result = await live.command(`/permission ${AUTO_REVIEW_PRESET}`)
        if (!result?.ok) console.info('[dsh-better-chat] auto review not applied for session', id, result?.error?.code ?? '')
      } catch {
        console.info('[dsh-better-chat] auto review switch failed for session', id)
      }
    }
  }
  const timer = timers.setInterval(() => { void tick() }, 2500)
  void tick()

  return () => {
    disposed = true
    observer.disconnect()
    if (scanTimer) timers.clearTimeout(scanTimer)
    timers.clearInterval(timer)
  }
}

/** 本插件不硬依赖任何客户端服务（sessions 服务是可选增强，缺了只是不自动切）。 */
export const inject = []

/** 插件主体：挂载两组增强，卸载时完整摘除。 */
export function apply(ctx) {
  ctx.effect(() => install(document), 'dsh-better-chat: approval enter/esc routing')
  ctx.effect(
    () => installPermissionPolicy(document, () => ctx.sessions),
    'dsh-better-chat: permission policy (no full access, auto review by default)',
  )
}
