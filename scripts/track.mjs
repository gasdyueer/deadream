#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { loadPosts } from '../docs/.vitepress/lib/posts.mjs'

/** 执行 git 命令，失败时返回空串而不是抛错。 */
function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

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
    ? git(['status', '--porcelain', '--', 'docs/posts'])
        .split('\n')
        .filter(Boolean)
        .map((line) => line.slice(3).split(' -> ').pop().trim())
    : []
)

const posts = loadPosts({ drafts: 'include' })
if (!posts.length) {
  console.log('还没有任何文章。用 pnpm new "标题" 创建第一篇。')
  process.exit(0)
}

const rows = posts.map((post) => {
  const file = `docs/${post.file}`
  const commit = inRepo ? git(['log', '-1', '--format=%h %cs', '--', file]) : ''
  return {
    status: post.draft ? '草稿' : '已发布',
    date: post.date || '—',
    title: post.title,
    tags: post.tags.length ? post.tags.map((tag) => `#${tag}`).join(' ') : '—',
    words: String(post.words),
    commit: commit || '未提交',
    dirty: dirty.has(file),
    draft: post.draft,
    noDate: !post.date,
  }
})

const headers = ['状态', '日期', '标题', '标签', '字数', '最后提交']
const widths = headers.map((header, index) => {
  const key = ['status', 'date', 'title', 'tags', 'words', 'commit'][index]
  return Math.max(displayWidth(header), ...rows.map((row) => displayWidth(row[key])))
})

console.log('\ndeadream 文章状态\n')
console.log(headers.map((header, index) => pad(header, widths[index])).join('  '))
console.log(widths.map((width) => '─'.repeat(width)).join('  '))
for (const row of rows) {
  const line = [row.status, row.date, row.title, row.tags, row.words, row.commit]
    .map((cell, index) => pad(cell, widths[index]))
    .join('  ')
  console.log(`${line}${row.dirty ? '  *' : ''}`)
}

const published = rows.filter((row) => !row.draft).length
const drafts = rows.length - published
const dirtyCount = rows.filter((row) => row.dirty).length
console.log(`\n已发布 ${published} · 草稿 ${drafts}${dirtyCount ? ` · 未提交改动 ${dirtyCount}（*）` : ''}`)

const hints = []
if (rows.some((row) => row.noDate)) hints.push('有文章缺少 date，列表顺序会不稳定，请补上 frontmatter 的 date。')
if (dirtyCount) hints.push('有未提交的改动：pnpm ship')
if (drafts) hints.push(`有 ${drafts} 篇草稿：把 frontmatter 的 draft 改成 false 即会发布。`)
if (!hints.length) hints.push('一切干净：pnpm new "标题" 开写，pnpm ship 发布。')
console.log(`\n${hints.map((hint) => `· ${hint}`).join('\n')}\n`)
