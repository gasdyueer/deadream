#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parsePost } from '../docs/.vitepress/lib/posts.mjs'

const argv = process.argv.slice(2).flatMap((arg) =>
  arg.startsWith('--') && arg.includes('=')
    ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)]
    : [arg]
)

const options = { message: '', push: true, dryRun: false }
for (let index = 0; index < argv.length; index++) {
  const value = () => argv[++index] ?? ''
  switch (argv[index]) {
    case '-m':
    case '--message':
      options.message = value()
      break
    case '--no-push':
      options.push = false
      break
    case '--dry-run':
      options.dryRun = true
      break
    case '-h':
    case '--help':
      console.log(`用法：pnpm ship [-m "提交信息"] [--no-push] [--dry-run]

自动 git add -A，根据本次改动的文章生成 commit message，提交并推送。`)
      process.exit(0)
      break
    default:
      break
  }
}

function git(args, { optional = false } = {}) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    if (optional) return ''
    console.error(`git ${args.join(' ')} 失败：${String(error.stderr ?? error.message).trim()}`)
    process.exit(1)
  }
}

if (git(['rev-parse', '--is-inside-work-tree'], { optional: true }).trim() !== 'true') {
  console.error('当前目录不是 git 仓库。')
  process.exit(1)
}

git(['add', '-A'])
const staged = git(['diff', '--cached', '--name-status', '-M'])
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const [code, ...paths] = line.split('\t')
    return { code: code[0], from: paths.length > 1 ? paths[0] : '', path: paths[paths.length - 1] }
  })

if (!staged.length) {
  console.log('没有需要提交的改动。')
  process.exit(0)
}

/** 内容目录：文章与日记 */
const CONTENT_DIRS = ['docs/posts/', 'docs/diary/']
const COLLECTION_LABEL = { post: '文章', diary: '日记' }

const content = staged
  .filter((change) => CONTENT_DIRS.some((dir) => change.path.startsWith(dir)) && change.path.endsWith('.md'))
  .filter((change) => path.basename(change.path) !== 'index.md')
  .map((change) => {
    const relative = change.path.replace(/^docs\//, '')
    const collection = relative.startsWith('diary/') ? 'diary' : 'post'
    // 刚执行过 git add -A，工作区内容即暂存内容；删除的文件没有内容可读
    if (change.code === 'D') return { ...change, collection, title: path.basename(relative, '.md') }
    const abs = path.join(process.cwd(), change.path)
    const raw = existsSync(abs) ? readFileSync(abs, 'utf8') : git(['show', `:${change.path}`])
    return { ...change, collection, title: parsePost(relative, raw).title }
  })

/**
 * 标题列表 → 文案片段。数量多时退化成计数，此时前面留一个空格，
 * 好让「新增《A》」和「新增 12 篇」读起来都对。
 */
function formatTitles(titles) {
  if (titles.length <= 3) return titles.map((title) => `《${title}》`).join('、')
  return ` ${titles.length} 篇（${titles.slice(0, 2).map((title) => `《${title}》`).join('、')}…）`
}

function buildMessage() {
  const segments = []
  const collections = new Set()
  for (const collection of ['post', 'diary']) {
    const pick = (codes) =>
      content.filter((change) => change.collection === collection && codes.includes(change.code)).map((change) => change.title)
    const parts = []
    const added = pick(['A'])
    const updated = pick(['M', 'R'])
    const removed = pick(['D'])
    if (added.length) parts.push(`新增${formatTitles(added)}`)
    if (updated.length) parts.push(`更新${formatTitles(updated)}`)
    if (removed.length) parts.push(`删除${formatTitles(removed)}`)
    if (!parts.length) continue
    collections.add(collection)
    segments.push({ collection, text: parts.join('；') })
  }
  if (!segments.length) return `chore: 更新站点（${staged.length} 个文件）`

  // 只有一类内容时不必重复说明分类；两类都动了才带前缀
  const scope = collections.size === 1 ? [...collections][0] : 'content'
  const mixed = collections.size > 1
  const body = segments.map((segment) => `${mixed ? COLLECTION_LABEL[segment.collection] : ''}${segment.text}`).join('；')
  return `${scope}: ${body}`
}

const message = options.message || buildMessage()
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim()
const upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { optional: true }).trim()

console.log(`待提交 ${staged.length} 个文件${content.length ? `，其中内容 ${content.length} 篇` : ''}：`)
for (const item of content.slice(0, 10)) {
  console.log(`  ${item.code}  ${COLLECTION_LABEL[item.collection]}  ${item.title}`)
}
if (content.length > 10) console.log(`  …另有 ${content.length - 10} 篇`)
console.log(`\n提交信息：${message}`)
console.log(`分支：${branch}${upstream ? ` → ${upstream}` : '（尚无上游）'}`)

if (options.dryRun) {
  console.log('\n--dry-run：未提交、未推送。')
  process.exit(0)
}

git(['commit', '-m', message])
console.log(`\n已提交 ${git(['rev-parse', '--short', 'HEAD']).trim()}`)

if (!options.push) {
  console.log('--no-push：未推送。')
  process.exit(0)
}

git(upstream ? ['push'] : ['push', '-u', 'origin', branch])
console.log('已推送。')

if (branch !== 'main') {
  console.log(`\n注意：当前分支不是 main，.github/workflows/deploy.yml 只监听 main，这次推送不会触发部署。`)
} else {
  console.log(`
追踪这次部署：
  gh run watch
  gh run list --limit 3`)
}
