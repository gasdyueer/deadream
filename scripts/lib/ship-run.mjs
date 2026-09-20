/**
 * 导入脚本的收尾动作（`--ship`）：把刚导入的内容直接提交并推送。
 *
 * 只是把 scripts/ship.mjs 当成子进程再跑一遍 —— 提交信息的生成、暂存范围、
 * 推送失败后的代理重试都留在那边，这里不重复实现一份。
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SHIP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'ship.mjs')

/** 跑一遍 ship；它失败时按同样的退出码结束，别让「导入完成」掩盖「没发出去」 */
export function shipImport() {
  try {
    // stdio 直通，ship 的输出与单独执行 pnpm ship 完全一样
    execFileSync(process.execPath, [SHIP], { stdio: 'inherit' })
  } catch (error) {
    process.exit(typeof error.status === 'number' ? error.status : 1)
  }
}
