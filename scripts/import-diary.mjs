#!/usr/bin/env node
/**
 * 把 Obsidian 日记（含图片附件）导入成 docs/diary 下的文章。
 *
 *   node scripts/import-diary.mjs --source "D:/Note/social death"
 *
 * 做四件事：
 *  1. 从文件名解析日期时间（2026年3月30日星期一晚上6点41分.md / 2024-05-21.md）；
 *  2. 把 Obsidian 语法转成 Markdown：![[图]] → ![](/images/diary/x.jpg)、[[笔记|显示]] → 显示；
 *  3. 把被引用的图片压成 JPEG 写到 docs/public/images/diary/，只处理真正被引用的图；
 *  4. 写入 docs/diary/<slug>.md，带 title/date 的 frontmatter。
 *
 * 源文件只读不删。
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { DOCS_DIR } from '../docs/.vitepress/lib/posts.mjs'

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
const IMAGE_OUT_DIR = path.resolve(DOCS_DIR, '..', options.imageOut)
const URL_PREFIX = `/${options.imageOut.replace(/^docs\/public\//, '').replace(/^public\//, '')}`

const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.bmp', '.tiff']
const VIDEO_EXT = ['.mp4', '.mov', '.webm', '.mkv', '.avi', '.wmv']
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

/** 年月日 → 中文标题 */
function titleOf({ date, time }) {
  const [year, month, day] = date.split('-')
  const readable = `${year}年${Number(month)}月${Number(day)}日`
  return time ? `${readable} ${time}` : readable
}

/** 文件名片段：拉丁转小写，保留中日韩，其余换成连字符。 */
function sanitizeStem(name) {
  return path
    .basename(name, path.extname(name))
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '')
}

function walk(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name)
      return entry.isDirectory() ? walk(full) : [full]
    })
    .sort()
}

const stats = {
  entries: 0,
  skipped: [],
  unparsed: [],
  images: 0,
  reusedImages: 0,
  missingImages: [],
  videos: [],
  attachments: [],
  wikilinks: 0,
  deadLinks: 0,
  storedBytes: 0,
}

/** 源图片绝对路径 → 输出文件名 */
const imageCache = new Map()
/** 输出文件名 → 源绝对路径（检测重名） */
const imageOwners = new Map()

async function convertImage(sourceAbs, referencedAs) {
  if (imageCache.has(sourceAbs)) return imageCache.get(sourceAbs)

  const hash = createHash('sha1').update(referencedAs).digest('hex').slice(0, 8)
  let name = `${sanitizeStem(referencedAs)}.jpg`
  const owner = imageOwners.get(name)
  if (owner && owner !== sourceAbs) name = `${sanitizeStem(referencedAs)}-${hash}.jpg`

  const dest = path.join(IMAGE_OUT_DIR, name)
  const isFresh = existsSync(dest) && !options.force && statSync(dest).mtimeMs >= statSync(sourceAbs).mtimeMs
  if (isFresh) {
    stats.reusedImages++
  } else if (!options.dryRun) {
    await sharp(sourceAbs, { animated: false })
      .rotate()
      .resize({ width: options.maxWidth, height: options.maxWidth, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: options.quality, mozjpeg: true, progressive: true })
      .toFile(dest)
    stats.images++
    stats.storedBytes += statSync(dest).size
  }
  imageCache.set(sourceAbs, name)
  imageOwners.set(name, sourceAbs)
  return name
}

/** 在日记文件所在目录和附件目录里找图，找不到返回 null。 */
function findImage(referencedAs, entryDir) {
  for (const dir of [entryDir, IMAGES_SRC]) {
    const candidate = path.join(dir, referencedAs)
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

async function transformBody(raw, entryDir) {
  // 嵌入与本地图片引用先异步解析（图片要压缩转码），再整体替换
  const replacements = new Map()

  /** 把库内图片转成站点图片；失败时返回 null */
  const storeImage = async (target, alt) => {
    const source = findImage(target, entryDir)
    if (!source) {
      stats.missingImages.push(target)
      return null
    }
    const name = await convertImage(source, target)
    return `![${alt ?? ''}](${URL_PREFIX}/${encodeURI(name)})`
  }

  for (const match of raw.matchAll(/!\[\[([^\]]+)\]\]/g)) {
    const token = match[0]
    if (replacements.has(token)) continue
    const parts = match[1].split('|').map((part) => part.trim())
    const target = parts[0]
    const display = parts.slice(1).find((part) => part && !/^\d+x\d+$/.test(part))
    const ext = path.extname(target).toLowerCase()

    if (IMAGE_EXT.includes(ext)) {
      replacements.set(token, (await storeImage(target, display)) ?? `> （原图缺失：${target}）`)
    } else if (VIDEO_EXT.includes(ext)) {
      stats.videos.push(target)
      replacements.set(token, `> （视频未收录：${target}）`)
    } else {
      stats.attachments.push(target)
      replacements.set(token, `> （附件未收录：${target}）`)
    }
  }

  // ![alt](库内相对路径)：Obsidian 里偶尔用标准 Markdown 语法引用附件
  for (const match of raw.matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)) {
    const token = match[0]
    if (replacements.has(token)) continue
    const [, alt, rawTarget] = match
    if (/^(https?:|data:|mailto:|#|\/)/i.test(rawTarget)) continue
    const target = decodeURIComponent(rawTarget)
    if (IMAGE_EXT.includes(path.extname(target).toLowerCase())) {
      replacements.set(token, (await storeImage(target, alt)) ?? `> （原图缺失：${target}）`)
    } else {
      stats.attachments.push(target)
      replacements.set(token, `> （附件未收录：${target}）`)
    }
  }

  let out = raw
  for (const [token, replacement] of replacements) out = out.split(token).join(replacement)

  // [[笔记|显示名]] / [[笔记]] → 纯文本（站点上没有对应页面，不做死链）
  out = out.replace(/\[\[([^\]]+)\]\]/g, (match, inner) => {
    stats.wikilinks++
    const [target, display] = inner.split('|')
    return (display ?? path.basename(target.trim()).replace(/\.[a-z0-9]+$/i, '')).trim()
  })

  // [文字](笔记.canvas) 之类的库内链接 → 只留文字
  out = out.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (match, text, target) => {
    if (/^(https?:|mailto:|#|\/)/i.test(target)) return match
    stats.deadLinks++
    return text
  })

  return out
}

async function main() {
  if (!existsSync(DIARY_SRC)) {
    console.error(`找不到日记目录：${DIARY_SRC}`)
    process.exit(1)
  }
  if (!options.dryRun) mkdirSync(IMAGE_OUT_DIR, { recursive: true })

  const files = walk(DIARY_SRC).filter((file) => file.endsWith('.md'))
  const usedSlugs = new Set()

  for (const file of files) {
    const base = path.basename(file)
    if (SKIP_FILES.includes(base)) {
      stats.skipped.push(base)
      continue
    }

    const parsed = parseFileName(base)
    if (!parsed) {
      stats.unparsed.push(path.relative(DIARY_SRC, file))
      continue
    }

    const slugBase = parsed.time ? `${parsed.date}-${parsed.time.replace(':', '')}` : parsed.date
    let slug = slugBase
    for (let suffix = 2; usedSlugs.has(slug); suffix++) slug = `${slugBase}-${suffix}`
    usedSlugs.add(slug)

    const body = await transformBody(readFileSync(file, 'utf8'), path.dirname(file))
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
    stats.entries++
  }

  console.log(`
日记导入${options.dryRun ? '（dry-run，未写入）' : '完成'}
  条目      ${stats.entries}
  跳过      ${stats.skipped.length}${stats.skipped.length ? `（${stats.skipped.join('、')}）` : ''}
  文件名异常 ${stats.unparsed.length}${stats.unparsed.length ? `\n            ${stats.unparsed.join('\n            ')}` : ''}
  图片      新转换 ${stats.images}、复用 ${stats.reusedImages}，共写入 ${(stats.storedBytes / 1048576).toFixed(1)}MB
  缺失图片  ${stats.missingImages.length}${stats.missingImages.length ? `\n            ${[...new Set(stats.missingImages)].join('\n            ')}` : ''}
  视频未收录 ${stats.videos.length}${stats.videos.length ? `（${[...new Set(stats.videos)].join('、')}）` : ''}
  其他附件  ${stats.attachments.length}${stats.attachments.length ? `（${[...new Set(stats.attachments)].join('、')}）` : ''}
  双链转文本 ${stats.wikilinks}，库内死链转文本 ${stats.deadLinks}
`)
}

await main()
