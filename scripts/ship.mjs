#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { COLLECTIONS, parsePost } from '../docs/.vitepress/lib/posts.mjs'
import { pushHint, pushWithRetry } from './lib/git-push.mjs'
import { formatUntagged, untagged } from './lib/tags.mjs'

const argv = process.argv.slice(2).flatMap((arg) =>
  arg.startsWith('--') && arg.includes('=')
    ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)]
    : [arg]
)

const options = { message: '', push: true, dryRun: false, allowUntagged: false }
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
    case '--allow-untagged':
      options.allowUntagged = true
      break
    case '-h':
    case '--help':
      console.log(`用法：pnpm ship [-m "提交信息"] [--no-push] [--dry-run] [--allow-untagged]

自动 git add -A，根据本次改动的文章生成 commit message，提交并推送。
本次改动的文章缺 frontmatter tags 时直接退出，不给提交；--allow-untagged 是唯一的放行口。`)
      process.exit(0)
      break
    default:
      break
  }
}

/** 跑一条 git；不抛错也不退出，把成败与输出交回调用方 */
function runGit(args) {
  try {
    return {
      ok: true,
      stdout: execFileSync('git', ['-c', 'core.quotepath=false', ...args], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
      output: '',
    }
  } catch (error) {
    // 优先 stderr（git 的诊断都在这），退而求其次 stdout、最后才是 execFileSync 的 "Command failed" 文案
    const detail = String(error.stderr ?? '').trim() || String(error.stdout ?? '').trim() || String(error.message ?? '').trim()
    return { ok: false, stdout: '', output: detail }
  }
}

function git(args, { optional = false } = {}) {
  const result = runGit(args)
  if (result.ok) return result.stdout
  if (optional) return ''
  console.error(`git ${args.join(' ')} 失败：${result.output}`)
  process.exit(1)
}

// 不在仓库里时下面第一条 git add 就会带着 git 自己的报错退出，不必先单跑一次 rev-parse

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

/** 内容目录与分类标签都由 COLLECTIONS 决定，加分类时这里不用改 */
const CONTENT_DIRS = COLLECTIONS.map((collection) => `docs/${collection.dir}/`)
const LABEL_BY_NAME = new Map(COLLECTIONS.map((collection) => [collection.name, collection.label]))
const COLLECTION_BY_DIR = new Map(COLLECTIONS.map((collection) => [`docs/${collection.dir}/`, collection.name]))

const content = staged
  .filter((change) => CONTENT_DIRS.some((dir) => change.path.startsWith(dir)) && change.path.endsWith('.md'))
  .filter((change) => path.basename(change.path) !== 'index.md')
  .map((change) => {
    const relative = change.path.replace(/^docs\//, '')
    const prefix = CONTENT_DIRS.find((dir) => change.path.startsWith(dir))
    const collection = COLLECTION_BY_DIR.get(prefix) ?? 'post'
    const abs = path.join(process.cwd(), change.path)
    // 刚 git add -A 过，工作区内容即暂存内容；删除的取 HEAD（此刻 HEAD 还是提交前的状态），
    // 两边都拿不到就退回文件名
    const raw =
      change.code === 'D'
        ? git(['show', `HEAD:${change.path}`], { optional: true })
        : existsSync(abs)
          ? readFileSync(abs, 'utf8')
          : git(['show', `:${change.path}`])
    const parsed = raw ? parsePost(relative, raw) : null
    return {
      ...change,
      collection,
      title: parsed?.title ?? path.basename(relative, '.md'),
      tags: parsed?.tags ?? [],
    }
  })

// 标签是硬要求（README「标签」）：标签页与列表页都靠它聚合，缺标签的内容等于没进站点
const missingTags = untagged(content)
if (missingTags.length && !options.allowUntagged) {
  console.error(
    formatUntagged(missingTags, {
      fix: '补上 frontmatter 的 tags 后重跑 pnpm ship；确实不要标签就加 --allow-untagged。',
    })
  )
  process.exit(1)
}

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
  for (const { name: collection } of COLLECTIONS) {
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

  // 只有一类内容时不必重复说明分类；多类都动了才带前缀
  const scope = collections.size === 1 ? [...collections][0] : 'content'
  const mixed = collections.size > 1
  const body = segments.map((segment) => `${mixed ? (LABEL_BY_NAME.get(segment.collection) ?? '') : ''}${segment.text}`).join('；')
  return `${scope}: ${body}`
}

const message = options.message || buildMessage()
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim()
const upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { optional: true }).trim()

console.log(`待提交 ${staged.length} 个文件${content.length ? `，其中内容 ${content.length} 篇` : ''}：`)
for (const item of content.slice(0, 10)) {
  console.log(`  ${item.code}  ${LABEL_BY_NAME.get(item.collection) ?? '文章'}  ${item.title}`)
}
if (content.length > 10) console.log(`  …另有 ${content.length - 10} 篇`)
console.log(`\n提交信息：${message}`)
console.log(`分支：${branch}${upstream ? ` → ${upstream}` : '（尚无上游）'}`)

if (options.dryRun) {
  console.log('\n--dry-run：未提交、未推送。')
  process.exit(0)
}

const committed = git(['commit', '-m', message])
// git commit 会打印 `[main 2fa14bd] 提交信息`，直接取；取不到再问一次 rev-parse
const hash = /\[[^\]]+ ([0-9a-f]{7,40})\]/.exec(committed)?.[1] ?? git(['rev-parse', '--short', 'HEAD']).trim()
console.log(`\n已提交 ${hash}`)

if (!options.push) {
  console.log('--no-push：未推送。')
  process.exit(0)
}

// push 失败先自己救一次：网络被掐时用本机代理重试，见 lib/git-push.mjs
const pushArgs = upstream ? ['push'] : ['push', '-u', 'origin', branch]
const pushed = await pushWithRetry({ run: (extra) => runGit([...extra, ...pushArgs]) })
if (!pushed.ok) {
  console.error(`\ngit ${pushArgs.join(' ')} 失败：${pushed.output}`)
  const hint = pushHint(pushed)
  if (hint) console.error(`\n${hint}`)
  process.exit(1)
}
console.log(pushed.proxy ? `已推送（网络失败后经 ${pushed.proxy} 重试成功）。` : '已推送。')

if (branch !== 'main') {
  console.log(`\n注意：当前分支不是 main，.github/workflows/deploy.yml 只监听 main，这次推送不会触发部署。`)
} else {
  console.log(`
追踪这次部署：
  gh run watch
  gh run list --limit 3`)
}
