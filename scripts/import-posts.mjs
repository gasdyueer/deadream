#!/usr/bin/env node
/**
 * 把指定的 Obsidian 笔记搬成「文章」分类的内容。
 *
 *   node scripts/import-posts.mjs "D:/Note/social death/2024暑假总结.md" --tags 总结
 *
 * 与 import-diary.mjs 共用同一套转换逻辑（scripts/lib/import-note.mjs）：
 * 转换 Obsidian 语法、把被引用的图片压成 JPEG 放进 docs/public/images/posts/<slug>/，
 * 写出 docs/posts/<date>-<slug>.md。源文件只读不删。
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import { COLLECTIONS, DOCS_DIR } from '../docs/.vitepress/lib/posts.mjs'
import { createImageStore, createStats, slugify, transformBody } from './lib/import-note.mjs'
import { shipImport } from './lib/ship-run.mjs'

const argv = process.argv.slice(2).flatMap((arg) =>
  arg.startsWith('--') && arg.includes('=')
    ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)]
    : [arg]
)

const options = {
  collection: 'post',
  attachments: [],
  tags: [],
  date: '',
  slug: '',
  maxWidth: 1920,
  quality: 82,
  force: false,
  dryRun: false,
  ship: false,
}
const files = []
for (let index = 0; index < argv.length; index++) {
  const value = () => argv[++index] ?? ''
  switch (argv[index]) {
    case '--collection':
      options.collection = value()
      break
    case '--attachments':
      options.attachments.push(...value().split(path.delimiter).filter(Boolean))
      break
    case '--tags':
      options.tags.push(...value().split(/[,，\s]+/).filter(Boolean))
      break
    case '--date':
      options.date = value()
      break
    case '--slug':
      options.slug = value()
      break
    case '--max-width':
      options.maxWidth = Number(value())
      break
    case '--quality':
      options.quality = Number(value())
      break
    case '--force':
      options.force = true
      break
    case '--dry-run':
      options.dryRun = true
      break
    case '--ship':
      options.ship = true
      break
    case '-h':
    case '--help':
      console.log(`用法：node scripts/import-posts.mjs <笔记.md>... [--collection post|diary|video] [--attachments <附件目录>] [--tags a,b] [--date YYYY-MM-DD] [--slug x] [--dry-run] [--ship]

  --collection   导入到哪个分类（默认 post），目录与图片目录由 COLLECTIONS 决定
  --attachments  额外附件目录，可重复；默认还会找笔记同级与上级的 images/ 以及笔记同级目录
  --date         覆盖日期，默认取 frontmatter.date 或文件修改时间
  --slug         覆盖文件名片段，单文件时才有意义
  --ship         导入后接着跑一遍 scripts/ship.mjs：提交并推送（pnpm upload 就是这个）`)
      process.exit(0)
      break
    default:
      if (argv[index].startsWith('--')) break
      files.push(argv[index])
  }
}

if (!files.length) {
  console.error('请给出要导入的 Markdown 文件路径。')
  process.exit(1)
}

const collection = COLLECTIONS.find((item) => item.name === options.collection)
if (!collection) {
  console.error(`未知分类：${options.collection}（可用：${COLLECTIONS.map((item) => item.name).join(' / ')}）`)
  process.exit(1)
}

const OUT_DIR = path.join(DOCS_DIR, collection.dir)
const IMAGE_ROOT = path.join(DOCS_DIR, 'public', 'images', collection.dir)
const PLUGIN_KEYS = ['zhihu-title', 'zhihu-topics', 'zhihu-link', 'zhihu-created-at']

/** 文件修改时间的本地日期 */
function fileDate(file) {
  const stat = statSync(file)
  const pad = (value) => String(value).padStart(2, '0')
  return `${stat.mtime.getFullYear()}-${pad(stat.mtime.getMonth() + 1)}-${pad(stat.mtime.getDate())}`
}

const stats = createStats()

async function main() {
  const summaries = []

  for (const file of files) {
    if (!existsSync(file)) {
      console.error(`找不到文件：${file}`)
      process.exit(1)
    }

    const parsed = matter(readFileSync(file, 'utf8'))
    const title = String(parsed.data.title ?? parsed.data['zhihu-title'] ?? path.basename(file, '.md')).trim()
    const date = /^\d{4}-\d{2}-\d{2}$/.test(options.date) ? options.date : String(parsed.data.date ?? '').slice(0, 10) || fileDate(file)
    const tags = options.tags.length
      ? options.tags
      : Array.isArray(parsed.data.tags)
        ? parsed.data.tags.map(String)
        : []
    const slug = options.slug || slugify(title) || `note-${Date.now()}`

    let stem = `${date}-${slug}`
    const target = () => path.join(OUT_DIR, `${stem}.md`)
    // 重新导入同一篇笔记时覆盖原文件（标题一致即视为同一篇），否则另起一个文件名
    const sameNote = existsSync(target()) && readFileSync(target(), 'utf8').split('\n').slice(0, 6).includes(`title: ${JSON.stringify(title)}`)
    if (!sameNote) {
      for (let suffix = 2; existsSync(target()); suffix++) stem = `${date}-${slug}-${suffix}`
    }

    const noteDir = path.dirname(path.resolve(file))
    const parentDir = path.dirname(noteDir)
    const sourceDirs = [
      ...new Set([
        ...options.attachments.map((dir) => path.resolve(dir)),
        path.join(noteDir, 'images'),
        path.join(parentDir, 'images'),
        noteDir,
      ]),
    ]

    const store = createImageStore({
      outDir: path.join(IMAGE_ROOT, stem),
      urlPrefix: `/images/${collection.dir}/${encodeURI(stem)}`,
      sourceDirs,
      maxWidth: options.maxWidth,
      quality: options.quality,
      force: options.force,
      dryRun: options.dryRun,
      stats,
    })

    const body = (await transformBody(parsed.content, { store, entryDir: noteDir, stats }))
      .replace(/^\s*\n/, '')
      .replace(/\s+$/, '')
    // 文章需要一个一级标题；笔记本身没有就补上
    const content = /^#\s+/m.test(body) ? body : `# ${title}\n\n${body}`
    const document = [
      '---',
      `title: ${JSON.stringify(title)}`,
      `date: ${date}`,
      `tags: [${tags.join(', ')}]`,
      '---',
      '',
      content,
      '',
    ].join('\n')

    if (!options.dryRun) {
      mkdirSync(OUT_DIR, { recursive: true })
      writeFileSync(path.join(OUT_DIR, `${stem}.md`), document, 'utf8')
    }
    const dropped = Object.keys(parsed.data).filter((key) => PLUGIN_KEYS.includes(key))
    summaries.push({
      file: path.basename(file),
      target: `docs/${collection.dir}/${stem}.md`,
      action: sameNote ? '覆盖' : '新增',
      title,
      date,
      tags,
      dropped,
    })
  }

  for (const item of summaries) {
    console.log(`${item.file}\n  ${item.action} ${item.target}\n    标题 ${item.title} · 日期 ${item.date} · 标签 ${item.tags.join(' ') || '—'}${item.dropped.length ? ` · 丢弃 ${item.dropped.join(' ')}` : ''}`)
  }
  console.log(`
文章导入${options.dryRun ? '（dry-run，未写入）' : '完成'}
  分类      ${collection.label}（docs/${collection.dir}）
  文章      ${summaries.length}
  图片      新转换 ${stats.images}（其中动图 ${stats.animated}，存为动图 WebP）、复用 ${stats.reusedImages}，共写入 ${(stats.storedBytes / 1048576).toFixed(1)}MB
  缺失图片  ${stats.missingImages.length}${stats.missingImages.length ? `\n            ${[...new Set(stats.missingImages)].join('\n            ')}` : ''}
  视频未收录 ${stats.videos.length}${stats.videos.length ? `（${[...new Set(stats.videos)].join('、')}）` : ''}
  其他附件  ${stats.attachments.length}${stats.attachments.length ? `（${[...new Set(stats.attachments)].join('、')}）` : ''}
  双链转文本 ${stats.wikilinks}，库内死链转文本 ${stats.deadLinks}
`)
}

await main()

if (options.ship) {
  if (options.dryRun) console.log('--ship：dry-run，未提交未推送。')
  else shipImport()
}
