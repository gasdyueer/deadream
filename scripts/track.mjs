#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { loadPosts } from '../docs/.vitepress/lib/posts.mjs'

/** 执行 git 命令，失败时返回空串而不是抛错。core.quotepath=false 保证中文路径不被转义。 */
function git(args) {
  try {
    return execFileSync('git', ['-c', 'core.quotepath=false', ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

const argv = process.argv.slice(2)
if (argv.includes('-h') || argv.includes('--help')) {
  console.log(`用法：pnpm track [--all]

默认列出所有「文章」和最近 5 条「日记」；--all 连 500+ 条日记一起列。`)
  process.exit(0)
}
const showAll = argv.includes('--all')

const WIDE_RE = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/

/** 终端显示宽度（中日韩字符占两列）。 */
function displayWidth(text) {
  let width = 0
  for (const char of text) width += WIDE_RE.test(char) ? 2 : 1
  return width
}

function pad(text, width) {
  return text + ' '.repeat(Math.max(0, width - displayWidth(text)))
}

const inRepo = git(['rev-parse', '--is-inside-work-tree']) === 'true'
const dirty = new Set(
  inRepo
    ? git(['status', '--porcelain', '--', 'docs/posts', 'docs/diary'])
        .split('\n')
        .filter(Boolean)
        .map((line) => line.slice(3).split(' -> ').pop().trim())
    : []
)

/** 每个文件的最后一次提交：git log 从新到旧，第一次出现的提交就是它 */
const lastCommit = new Map()
if (inRepo) {
  let head = ''
  for (const line of git(['log', '--format=@@%h %cs', '--name-only', '--', 'docs/posts', 'docs/diary']).split('\n')) {
    if (line.startsWith('@@')) {
      head = line.slice(2)
      continue
    }
    const file = line.trim()
    if (file && !lastCommit.has(file)) lastCommit.set(file, head)
  }
}

const posts = loadPosts({ drafts: 'include' })
if (!posts.length) {
  console.log('还没有任何内容。用 pnpm new "标题" 创建文章，或 pnpm import:diary 导入日记。')
  process.exit(0)
}

const rows = posts.map((post) => {
  const file = `docs/${post.file}`
  return {
    collection: post.collection,
    status: post.draft ? '草稿' : '已发布',
    date: post.date || '—',
    title: post.title,
    tags: post.tags.length ? post.tags.map((tag) => `#${tag}`).join(' ') : '—',
    words: String(post.words),
    commit: lastCommit.get(file) || '未提交',
    dirty: dirty.has(file),
    draft: post.draft,
    noDate: !post.date,
  }
})

const HEADERS = ['状态', '日期', '标题', '标签', '字数', '最后提交']
const KEYS = ['status', 'date', 'title', 'tags', 'words', 'commit']

function renderTable(list) {
  const widths = HEADERS.map((header, index) =>
    Math.max(displayWidth(header), ...list.map((row) => displayWidth(row[KEYS[index]])))
  )
  console.log(HEADERS.map((header, index) => pad(header, widths[index])).join('  '))
  console.log(widths.map((width) => '─'.repeat(width)).join('  '))
  for (const row of list) {
    const line = KEYS.map((key, index) => pad(row[key], widths[index])).join('  ')
    console.log(`${line}${row.dirty ? '  *' : ''}`)
  }
}

const postRows = rows.filter((row) => row.collection === 'post')
const diaryRows = rows.filter((row) => row.collection === 'diary')

console.log('\ndeadream 内容状态\n')
if (postRows.length) {
  console.log('【文章】')
  renderTable(postRows)
  console.log()
}
if (diaryRows.length) {
  const shown = showAll ? diaryRows : diaryRows.slice(0, 5)
  console.log(`【日记】共 ${diaryRows.length} 篇${showAll ? '' : '（最近 5 篇，全部用 pnpm track --all）'}`)
  renderTable(shown)
  console.log()
}

const summarize = (list) => {
  const published = list.filter((row) => !row.draft).length
  const drafts = list.length - published
  return `${published} 已发布${drafts ? ` · ${drafts} 草稿` : ''}`
}
const dirtyCount = rows.filter((row) => row.dirty).length
console.log(`文章 ${postRows.length}（${summarize(postRows)}）· 日记 ${diaryRows.length}（${summarize(diaryRows)}）${dirtyCount ? ` · 未提交改动 ${dirtyCount}（*）` : ''}`)

const hints = []
if (rows.some((row) => row.noDate)) hints.push('有内容缺少 date，列表顺序会不稳定，请补上 frontmatter 的 date。')
if (dirtyCount) hints.push('有未提交的改动：pnpm ship')
if (rows.some((row) => row.draft)) hints.push(`有草稿：把 frontmatter 的 draft 改成 false 即会发布。`)
if (!hints.length) hints.push('一切干净：pnpm new "标题" 写文章，pnpm import:diary 导入日记，pnpm ship 发布。')
console.log(`\n${hints.map((hint) => `· ${hint}`).join('\n')}\n`)
