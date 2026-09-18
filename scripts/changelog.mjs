#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { COLLECTIONS, loadPosts, parsePost } from '../docs/.vitepress/lib/posts.mjs'

const argv = process.argv.slice(2).flatMap((arg) =>
  arg.startsWith('--') && arg.includes('=')
    ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)]
    : [arg]
)

const options = { base: '', head: 'HEAD', site: process.env.SITE_URL || '', out: '', manifest: '' }
for (let index = 0; index < argv.length; index++) {
  const value = () => argv[++index] ?? ''
  switch (argv[index]) {
    case '--base':
      options.base = value()
      break
    case '--head':
      options.head = value()
      break
    case '--site':
      options.site = value()
      break
    case '--out':
      options.out = value()
      break
    case '--manifest':
      options.manifest = value()
      break
    case '-h':
    case '--help':
      console.log(`用法：node scripts/changelog.mjs [--base <ref>] [--head <ref>] [--site <url>] [--out <file>] [--manifest <dist/posts.json>]

输出本次提交区间内 docs/posts 的文章变更（Markdown），供 GitHub Actions 步骤摘要使用。`)
      process.exit(0)
      break
    default:
      break
  }
}

function git(args, optional = false) {
  try {
    // core.quotepath=false：否则非 ASCII 路径会被转义成 "..."，Linux/CI 上默认开启
    return execFileSync('git', ['-c', 'core.quotepath=false', ...args], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch (error) {
    if (optional) return ''
    throw error
  }
}

if (git(['rev-parse', '--is-inside-work-tree'], true) !== 'true') {
  console.error('[changelog] 不在 git 仓库中，跳过文章追踪。')
  process.exit(0)
}

const head = options.head || 'HEAD'
const base = options.base && !/^0+$/.test(options.base) ? options.base : git(['rev-parse', '--verify', '--quiet', `${head}^`], true)
const site = options.site.replace(/\/+$/, '')

/** 内容目录与分类标签都由 COLLECTIONS 决定，加分类时这里不用改 */
const CONTENT_DIRS = COLLECTIONS.map((collection) => `docs/${collection.dir}`)
const LABEL_OF = Object.fromEntries(COLLECTIONS.map((collection) => [`docs/${collection.dir}/`, collection.label]))

function collectRows() {
  const lines = base
    ? git(['diff', '--name-status', '-M', base, head, '--', ...CONTENT_DIRS], true).split('\n')
    : git(['ls-tree', '-r', '--name-only', head, '--', ...CONTENT_DIRS], true).split('\n')

  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      if (!base) return { code: 'A', oldPath: '', path: line, oldRaw: null, newRaw: git(['show', `${head}:${line}`], true) }
      const parts = line.split('\t')
      const code = parts[0][0]
      const filePath = parts[parts.length - 1]
      const oldPath = parts.length > 2 ? parts[1] : filePath
      return {
        code,
        oldPath,
        path: filePath,
        oldRaw: code === 'A' ? null : git(['show', `${base}:${oldPath}`], true),
        newRaw: code === 'D' ? null : git(['show', `${head}:${filePath}`], true),
      }
    })
    .filter((row) => row.path.endsWith('.md') && path.posix.basename(row.path) !== 'index.md')
}

const changes = collectRows().map((row) => {
  const relative = (target) => target.replace(/^docs\//, '')
  const prefix = Object.keys(LABEL_OF).find((dir) => row.path.startsWith(dir)) ?? 'docs/posts/'
  return {
    code: row.code,
    collection: prefix,
    oldPost: row.oldRaw ? parsePost(relative(row.oldPath), row.oldRaw) : null,
    newPost: row.newRaw ? parsePost(relative(row.path), row.newRaw) : null,
  }
})

function label(change) {
  if (change.code === 'D') return '🗑️ 删除'
  if (change.code === 'A') return '🆕 新增'
  if (change.code === 'R' || change.code === 'C') return '🔀 重命名'
  if (change.oldPost && change.newPost) {
    if (change.oldPost.draft !== change.newPost.draft) return change.newPost.draft ? '📥 转为草稿' : '🚀 发布'
    if (change.oldPost.hash === change.newPost.hash) return '🏷️ 元信息'
  }
  return '✏️ 更新'
}

const cell = (value) => String(value).replace(/\|/g, '\\|')

function renderChanges() {
  if (!changes.length) return '_本次推送没有内容变更。_\n'

  const counts = new Map()
  const rows = changes.map((change) => {
    const status = label(change)
    counts.set(status, (counts.get(status) ?? 0) + 1)
    const post = change.newPost ?? change.oldPost
    const link = site && post && change.code !== 'D' && !post.draft ? `[打开](${site}${post.url})` : '—'
    const kind = LABEL_OF[change.collection] ?? '文章'
    return `| ${status} | ${kind} | ${cell(post?.title ?? '—')} | ${post?.date || '—'} | ${cell(post?.tags.join(' ')) || '—'} | ${link} |`
  })

  return [
    `**${[...counts].map(([status, count]) => `${status} ${count}`).join(' · ')}**`,
    '',
    '| 状态 | 分类 | 标题 | 日期 | 标签 | 链接 |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n')
}

function renderOthers() {
  const lines = base ? git(['diff', '--name-only', base, head], true) : git(['ls-tree', '-r', '--name-only', head], true)
  const files = lines
    .split('\n')
    .map((line) => line.trim())
    .filter((file) => file && !CONTENT_DIRS.some((dir) => file.startsWith(`${dir}/`)))
  if (!files.length) return ''
  const shown = files.slice(0, 15)
  return [
    '',
    '<details>',
    `<summary>其他改动（${files.length} 个文件）</summary>`,
    '',
    ...shown.map((file) => `- \`${file}\``),
    files.length > shown.length ? `- …另有 ${files.length - shown.length} 个` : '',
    '',
    '</details>',
    '',
  ]
    .filter((line) => line !== '')
    .join('\n')
}

function renderManifest() {
  if (!options.manifest || !existsSync(options.manifest)) return ''
  const manifest = JSON.parse(readFileSync(options.manifest, 'utf8'))
  const others = COLLECTIONS.filter((collection) => collection.name !== 'post')
    .map((collection) => `${collection.label} ${loadPosts({ collections: [collection.name] }).length}`)
    .join(' · ')
  const drafts = changes.filter((change) => change.newPost?.draft).length
  return [
    '',
    `### 站点内容（文章 ${manifest.count} 篇${others ? ` · ${others}` : ''}${drafts ? `，本次涉及 ${drafts} 篇草稿` : ''}）`,
    '',
    '订阅源与 posts.json 只收「文章」分类，其他分类不参与。',
    '',
    '| 日期 | 标题 | 标签 | 字数 |',
    '| --- | --- | --- | --- |',
    ...manifest.posts.map((post) => `| ${post.date || '—'} | ${cell(post.title)} | ${cell(post.tags.join(' ')) || '—'} | ${post.words} |`),
    '',
  ].join('\n')
}

const headShort = git(['rev-parse', '--short', head], true) || head
const range = base ? `${base.slice(0, 7)}...${headShort}` : `全部（${headShort}）`
const markdown = [`## 📚 文章追踪`, '', `> 区间 \`${range}\``, '', renderChanges(), renderOthers(), renderManifest()].join('\n')

// 摘要文件给 GitHub UI 看，stdout 给 `gh run view --log` 看（CI 里两者都要）
if (options.out) appendFileSync(options.out, `${markdown}\n`, 'utf8')
process.stdout.write(`${markdown}\n`)

console.log(`[changelog] 区间 ${range}：${changes.length} 处文章变更${options.out ? `，已写入 ${options.out}` : ''}`)
