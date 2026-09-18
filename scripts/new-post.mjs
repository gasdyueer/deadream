#!/usr/bin/env node
import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { POSTS_DIR } from '../docs/.vitepress/lib/posts.mjs'

const argv = process.argv.slice(2).flatMap((arg) =>
  arg.startsWith('--') && arg.includes('=')
    ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)]
    : [arg]
)

function usage(code) {
  const out = code === 0 ? console.log : console.error
  out(`用法：pnpm new "文章标题" [--tags 标签1,标签2] [--draft] [--date YYYY-MM-DD] [--slug english-slug]

示例：
  pnpm new "给 VitePress 加 RSS" --tags 工具,博客
  pnpm new "还没写完的东西" --draft
  pnpm new "VitePress 笔记" --slug vitepress-notes`)
  process.exit(code)
}

const options = { tags: [], draft: false, date: '', slug: '' }
const titleWords = []

for (let index = 0; index < argv.length; index++) {
  const arg = argv[index]
  const value = () => argv[++index] ?? ''
  switch (arg) {
    case '--tags':
      options.tags.push(...value().split(/[,，\s]+/).filter(Boolean))
      break
    case '--draft':
      options.draft = true
      break
    case '--date':
      options.date = value()
      break
    case '--slug':
      options.slug = value()
      break
    case '-h':
    case '--help':
      usage(0)
      break
    default:
      titleWords.push(arg)
  }
}

const title = titleWords.join(' ').trim()
if (!title) {
  console.error('错误：缺少文章标题。')
  usage(1)
}

const now = new Date()
const pad = (value) => String(value).padStart(2, '0')
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
const date = /^\d{4}-\d{2}-\d{2}$/.test(options.date) ? options.date : today

/** 标题转文件名片段：保留词序，中日韩字符原样保留（否则纯中文标题只剩时间戳）。 */
function deriveSlug(title) {
  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
}

const slug = options.slug || deriveSlug(title) || `post-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`

let target = path.join(POSTS_DIR, `${date}-${slug}.md`)
for (let suffix = 2; existsSync(target); suffix++) {
  target = path.join(POSTS_DIR, `${date}-${slug}-${suffix}.md`)
}

writeFileSync(
  target,
  [
    '---',
    `title: ${JSON.stringify(title)}`,
    `date: ${date}`,
    `tags: [${options.tags.join(', ')}]`,
    'description: ""',
    `draft: ${options.draft}`,
    '---',
    '',
    '',
  ].join('\n'),
  'utf8'
)

const relative = path.relative(path.resolve(POSTS_DIR, '..', '..'), target).split(path.sep).join('/')
console.log(`已创建 ${relative}${options.draft ? '（草稿：不会被构建，也不会出现在列表和 RSS 里）' : ''}`)
console.log(`
下一步：
  pnpm dev     # 本地预览，边写边看
  pnpm ship    # 提交并推送，GitHub Actions 自动构建部署
  pnpm track   # 查看所有文章状态`)
