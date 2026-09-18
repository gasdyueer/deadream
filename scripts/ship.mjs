#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
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

const posts = staged
  .filter((change) => change.path.startsWith('docs/posts/') && change.path.endsWith('.md'))
  .map((change) => {
    const relative = change.path.replace(/^docs\//, '')
    if (change.code === 'D') {
      return { ...change, title: relative.replace(/^posts\//, '').replace(/\.md$/, '') }
    }
    return { ...change, title: parsePost(relative, git(['show', `:${change.path}`])).title }
  })

function joinTitles(titles) {
  if (titles.length <= 2) return titles.map((title) => `《${title}》`).join('、')
  return `${titles.length} 篇（${titles.slice(0, 2).map((title) => `《${title}》`).join('、')}…）`
}

function buildMessage() {
  const added = posts.filter((post) => post.code === 'A').map((post) => post.title)
  const updated = posts.filter((post) => post.code === 'M' || post.code === 'R').map((post) => post.title)
  const removed = posts.filter((post) => post.code === 'D').map((post) => post.title)
  const parts = []
  if (added.length) parts.push(`新增${joinTitles(added)}`)
  if (updated.length) parts.push(`更新${joinTitles(updated)}`)
  if (removed.length) parts.push(`删除${joinTitles(removed)}`)
  if (parts.length) return `post: ${parts.join('；')}`
  return `chore: 更新站点（${staged.length} 个文件）`
}

const message = options.message || buildMessage()
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim()
const upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { optional: true }).trim()

console.log(`待提交 ${staged.length} 个文件${posts.length ? `，其中文章 ${posts.length} 篇` : ''}：`)
for (const post of posts) console.log(`  ${post.code}  ${post.title}  (${post.path})`)
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
