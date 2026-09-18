/**
 * lastUpdated 的取数方式。
 *
 * VitePress 默认给每个页面 spawn 一次 `git log -1 --pretty="%ai" <文件>`
 * （node_modules/vitepress/dist/node/chunk-*.js 里的 getGitTimestamp），只在单次构建内缓存。
 * 本机 git 进程启动约 1 秒（`git --version` 连跑 20 次要 19 秒），557 个页面就是构建里最贵的一步。
 *
 * 这里改成一条 `git log --name-only` 拿到「文件 → 最后提交时间」映射，再由一个 Vite 插件
 * 在 md 交给 VitePress 解析之前把 `lastUpdated: <ISO>` 写进 frontmatter —— VitePress 见
 * frontmatter.lastUpdated 是 Date 就直接采用、不再 spawn（见 resolvePageData 里
 * `frontmatter.lastUpdated instanceof Date` 那一支）。
 *
 * 取数方式变了，但每页的值与之前一致：都是「最后一次改到这个文件的提交」的 %ai。
 * 页面自己写了 lastUpdated（或写成 false）的，插件不动它。
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'

/** `git log --pretty=%ai` 的输出格式 */
const GIT_DATE_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [+-]\d{4}$/

/**
 * 扫一遍历史，得到「相对 dir 的 posix 路径 → ISO 时间」。
 * 日志从新到旧，所以每个文件第一次出现的那行就是它最后一次提交。
 * @param {string} dir 仓库内的目录（docs 目录绝对路径）
 */
export function collectGitDates(dir) {
  let output
  try {
    output = execFileSync(
      'git',
      // quotePath=false：文件名里有中文，不能让 git 转义成 \xxx 八进制
      // relative：路径输出成相对 cwd（docs）的形式，正好等于 pageData.relativePath
      ['-c', 'core.quotePath=false', 'log', '--pretty=format:%ai', '--name-only', '--relative', '--', '.'],
      { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }
    )
  } catch {
    // 不在 git 仓库、没装 git 或历史为空：返回空映射，让 VitePress 用自己的取数方式
    return new Map()
  }

  const dates = new Map()
  let current = ''
  for (const line of output.split('\n')) {
    if (GIT_DATE_RE.test(line)) {
      current = new Date(line).toISOString()
      continue
    }
    const file = line.trim()
    if (!file || !current || dates.has(file)) continue
    dates.set(file, current)
  }
  return dates
}

/** 把 ISO 时间写进 frontmatter 开头；文件自己声明了 lastUpdated 就原样返回 */
function injectLastUpdated(source, iso) {
  const open = source.match(/^---\r?\n/)
  if (open) {
    const end = source.indexOf('\n---', open[0].length)
    const frontmatter = end === -1 ? '' : source.slice(open[0].length, end)
    if (/^lastUpdated\s*:/m.test(frontmatter)) return source
    return source.replace(open[0], `${open[0]}lastUpdated: ${iso}\n`)
  }
  // 没有 frontmatter 的笔记补一个，VitePress 只认文件开头这一块
  return `---\nlastUpdated: ${iso}\n---\n\n${source}`
}

/**
 * 在 md 进入 VitePress 之前注入 frontmatter.lastUpdated。
 * enforce: 'pre' 保证跑在 VitePress 的 md 插件前面；带 ?query 的是同一个文件的子请求（样式块等），跳过。
 * @param {string} dir docs 目录绝对路径
 */
export function lastUpdatedPlugin(dir) {
  /** 一次构建只扫一遍历史 */
  let dates = null
  return {
    name: 'deadream:last-updated',
    enforce: 'pre',
    transform(source, id) {
      const [file, query] = id.split('?')
      if (query || !file.endsWith('.md')) return
      const relative = path.relative(dir, file).split(path.sep).join('/')
      if (relative.startsWith('..')) return
      dates ??= collectGitDates(dir)
      const iso = dates.get(relative)
      // 没提交过的新文件不注入：VitePress 自己算出来也是「没有时间」，页脚同样不显示
      if (!iso) return
      const next = injectLastUpdated(source, iso)
      return next === source ? undefined : next
    },
  }
}
