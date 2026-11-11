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

/** 本插件不需要任何客户端服务。 */
export const inject = []

/** 插件主体：挂载审批快捷键增强，卸载时完整摘除。 */
export function apply(ctx) {
  ctx.effect(() => install(document), 'dsh-better-chat: approval enter/esc routing')
}
