#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { COLLECTIONS, loadPosts } from '../docs/.vitepress/lib/posts.mjs'

/**
 * 执行 git 命令，失败时返回空串而不是抛错。core.quotepath=false 保证中文路径不被转义。
 * 只去尾部空白：`git status --porcelain` 的首行以空格开头（` M 路径`），
 * 整段 trim 会把那个空格吃掉，让下面按固定列切片的首行整体错位一位。
 */
function git(args) {
  try {
    return execFileSync('git', ['-c', 'core.quotepath=false', ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trimEnd()
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
    collectionLabel: post.collectionLabel,
    status: post.draft ? '草稿' : '已发布',
    date: post.date || '—',
    title: post.title,
    tags: post.tags.length ? post.tags.map((tag) => `#${tag}`).join(' ') : '—',
    words: String(post.words),
    commit: lastCommit.get(file) || '未提交',
    dirty: dirty.has(file),
    draft: post.draft,
    noDate: !post.date,
    noTags: !post.tags.length,
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

const byCollection = new Map(COLLECTIONS.map((collection) => [collection.name, []]))
for (const row of rows) {
  const bucket = byCollection.get(row.collection)
  if (bucket) bucket.push(row)
  else byCollection.set(row.collection, [row])
}

console.log('\ndeadream 内容状态\n')
for (const { name, label } of COLLECTIONS) {
  const list = byCollection.get(name) ?? []
  if (!list.length) continue
  // 条目多的分类默认只列最近几条，免得刷屏
  const shown = showAll || list.length <= 20 ? list : list.slice(0, 5)
  const more = shown.length < list.length ? `（只列最近 ${shown.length} 条，全部用 pnpm track --all）` : ''
  console.log(`【${label}】共 ${list.length} 条${more}`)
  renderTable(shown)
  console.log()
}

const summarize = (list) => {
  const published = list.filter((row) => !row.draft).length
  const drafts = list.length - published
  return `${published} 已发布${drafts ? ` · ${drafts} 草稿` : ''}`
}
const dirtyCount = rows.filter((row) => row.dirty).length
const totals = COLLECTIONS.map(({ name, label }) => {
  const list = byCollection.get(name) ?? []
  return `${label} ${list.length}（${summarize(list)}）`
}).join(' · ')
console.log(`${totals}${dirtyCount ? ` · 未提交改动 ${dirtyCount}（*）` : ''}`)

const hints = []
if (rows.some((row) => row.noDate)) hints.push('有内容缺少 date，列表顺序会不稳定，请补上 frontmatter 的 date。')
if (rows.some((row) => row.noTags)) hints.push('有内容缺少 tags：列表页与标签页靠标签聚合，补上 frontmatter 的 tags（pnpm ship 会拦）。')
if (dirtyCount) hints.push('有未提交的改动：pnpm ship')
if (rows.some((row) => row.draft)) hints.push(`有草稿：把 frontmatter 的 draft 改成 false 即会发布。`)
if (!hints.length) hints.push('一切干净：pnpm new "标题" 写文章，pnpm upload / pnpm import:diary 导入笔记，pnpm ship 发布。')
console.log(`\n${hints.map((hint) => `· ${hint}`).join('\n')}\n`)
