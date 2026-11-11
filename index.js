/**
 * dsh-better-chat — DSH 聊天增强插件。
 *
 * 宿主侧入口只是占位（让 bundle 能被加载）；功能都在 Web 客户端
 * （client.js，见 package.json 的 exports / dsh 清单）：
 * 功能一 = 审批卡片的回车批准 / Esc 拒绝（自动送入焦点 + 全局兜底路由）。
 */

/** Plugin identity for cordis.yml rows. */
export const name = 'dsh-better-chat'

/** Plugin body: nothing host-side yet; the client half does the work. */
export function apply(ctx) {}
