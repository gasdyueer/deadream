#!/usr/bin/env node
/**
 * 把 Obsidian 日记整库导入成 docs/diary 下的内容。
 *
 *   node scripts/import-diary.mjs --source "D:/Note/social death"
 *
 * 从文件名解析日期时间，转换 Obsidian 语法，把被引用的图片压成 JPEG，写出 docs/diary/<slug>.md。
 * 源文件只读不删。重复执行是幂等的（已转换且比源文件新的图片会跳过）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { DOCS_DIR } from '../docs/.vitepress/lib/posts.mjs'
import { createImageStore, createStats, transformBody, walk } from './lib/import-note.mjs'

const argv = process.argv.slice(2).flatMap((arg) =>
  arg.startsWith('--') && arg.includes('=')
    ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)]
    : [arg]
)

const options = {
  source: 'D:/Note/social death',
  out: 'docs/diary',
  imageOut: 'docs/public/images/diary',
  maxWidth: 1920,
  quality: 82,
  force: false,
  dryRun: false,
}
for (let index = 0; index < argv.length; index++) {
  const value = () => argv[++index] ?? ''
  switch (argv[index]) {
    case '--source':
      options.source = value()
      break
    case '--out':
      options.out = value()
      break
    case '--image-out':
      options.imageOut = value()
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
    case '-h':
    case '--help':
      console.log(`用法：node scripts/import-diary.mjs [--source <Obsidian 库目录>] [--out docs/diary] [--image-out docs/public/images/diary]
       [--max-width 1920] [--quality 82] [--force] [--dry-run]`)
      process.exit(0)
      break
    default:
      break
  }
}

const DIARY_SRC = path.join(options.source, 'Diary')
const IMAGES_SRC = path.join(options.source, 'images')
const OUT_DIR = path.resolve(DOCS_DIR, '..', options.out)
const URL_PREFIX = `/${options.imageOut.replace(/^docs\/public\//, '').replace(/^public\//, '')}`
const SKIP_FILES = ['record template.md']

/** 中文时段 + 小时 → 24 小时制。凌晨12点=00，中午12点=12，晚上11点=23。 */
function to24Hour(period, hour) {
  const value = Number(hour)
  switch (period) {
    case '凌晨':
    case '早上':
    case '上午':
      return value === 12 ? 0 : value
    case '中午':
    case '下午':
      return value === 12 ? 12 : value + 12
    case '晚上':
      return value === 12 ? 0 : value + 12
    default:
      return value
  }
}

/** 从文件名解析 { date: 'YYYY-MM-DD', time: 'HH:MM' | '' }。 */
function parseFileName(base) {
  const stem = base.replace(/\.md$/i, '')
  const pad = (value) => String(value).padStart(2, '0')

  const dashed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(stem)
  if (dashed) return { date: `${dashed[1]}-${dashed[2]}-${dashed[3]}`, time: '' }

  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(stem)
  if (compact) return { date: `${compact[1]}-${compact[2]}-${compact[3]}`, time: '' }

  const cn = /^(\d{4})年(\d{1,2})月(\d{1,2})日.*?(凌晨|早上|上午|中午|下午|晚上)?(\d{1,2})点(?:(\d{1,2})分)?$/.exec(stem)
  if (!cn) return null
  return {
    date: `${cn[1]}-${pad(cn[2])}-${pad(cn[3])}`,
    time: `${pad(to24Hour(cn[4], cn[5]))}:${pad(cn[6] ?? 0)}`,
  }
}

/** 年月日 + 时间 → 中文标题 */
function titleOf({ date, time }) {
  const [year, month, day] = date.split('-')
  const readable = `${year}年${Number(month)}月${Number(day)}日`
  return time ? `${readable} ${time}` : readable
}

const stats = createStats()
const store = createImageStore({
  outDir: path.resolve(DOCS_DIR, '..', options.imageOut),
  urlPrefix: URL_PREFIX,
  sourceDirs: [IMAGES_SRC],
  maxWidth: options.maxWidth,
  quality: options.quality,
  force: options.force,
  dryRun: options.dryRun,
  stats,
})

async function main() {
  if (!existsSync(DIARY_SRC)) {
    console.error(`找不到日记目录：${DIARY_SRC}`)
    process.exit(1)
  }

  const files = walk(DIARY_SRC).filter((file) => file.endsWith('.md'))
  const usedSlugs = new Set()
  const skipped = []
  const unparsed = []
  let entries = 0

  for (const file of files) {
    const base = path.basename(file)
    if (SKIP_FILES.includes(base)) {
      skipped.push(base)
      continue
    }

    const parsed = parseFileName(base)
    if (!parsed) {
      unparsed.push(path.relative(DIARY_SRC, file))
      continue
    }

    const slugBase = parsed.time ? `${parsed.date}-${parsed.time.replace(':', '')}` : parsed.date
    let slug = slugBase
    for (let suffix = 2; usedSlugs.has(slug); suffix++) slug = `${slugBase}-${suffix}`
    usedSlugs.add(slug)

    const body = await transformBody(readFileSync(file, 'utf8'), { store, entryDir: path.dirname(file), stats })
    const document = [
      '---',
      `title: ${JSON.stringify(titleOf(parsed))}`,
      `date: ${parsed.date}`,
      'tags: [日记]',
      '---',
      '',
      body.replace(/^\s*\n/, '').replace(/\s+$/, ''),
      '',
    ].join('\n')

    if (!options.dryRun) {
      mkdirSync(OUT_DIR, { recursive: true })
      writeFileSync(path.join(OUT_DIR, `${slug}.md`), document, 'utf8')
    }
    entries++
  }

  console.log(`
日记导入${options.dryRun ? '（dry-run，未写入）' : '完成'}
  条目      ${entries}
  跳过      ${skipped.length}${skipped.length ? `（${skipped.join('、')}）` : ''}
  文件名异常 ${unparsed.length}${unparsed.length ? `\n            ${unparsed.join('\n            ')}` : ''}
  图片      新转换 ${stats.images}（其中动图 ${stats.animated}，存为动图 WebP）、复用 ${stats.reusedImages}，共写入 ${(stats.storedBytes / 1048576).toFixed(1)}MB
  缺失图片  ${stats.missingImages.length}${stats.missingImages.length ? `\n            ${[...new Set(stats.missingImages)].join('\n            ')}` : ''}
  视频未收录 ${stats.videos.length}${stats.videos.length ? `（${[...new Set(stats.videos)].join('、')}）` : ''}
  其他附件  ${stats.attachments.length}${stats.attachments.length ? `（${[...new Set(stats.attachments)].join('、')}）` : ''}
  双链转文本 ${stats.wikilinks}，库内死链转文本 ${stats.deadLinks}
`)
}

await main()
