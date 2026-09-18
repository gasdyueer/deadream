/**
 * Obsidian 笔记导入的公共部分：命名、附件查找、图片转码、正文语法转换。
 * 被 import-diary.mjs（整库导入）和 import-posts.mjs（指定文件搬成文章）共用。
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

export const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.bmp', '.tiff']
export const VIDEO_EXT = ['.mp4', '.mov', '.webm', '.mkv', '.avi', '.wmv']

/** 可能带动画的格式：这些要按多帧读，动图转成动图 WebP */
const ANIMATABLE_EXT = ['.gif', '.webp', '.avif', '.png']
/** 动图输出上限：原 GIF 动辄 1600px 宽、几十 MB，缩到 800 宽约为原体积的 8% */
const ANIMATED_MAX_WIDTH = 800
const ANIMATED_QUALITY = 75

/** 统计信息，导入脚本负责打印 */
export function createStats() {
  return {
    images: 0,
    animated: 0,
    reusedImages: 0,
    missingImages: [],
    videos: [],
    attachments: [],
    wikilinks: 0,
    deadLinks: 0,
    storedBytes: 0,
  }
}

/** 标题 → 文件名片段：保留词序与中日韩字符，拉丁转小写，词边界换连字符。 */
export function slugify(title) {
  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/([a-z])(\d)/g, '$1-$2')
    .replace(/(\d)([a-z])/g, '$1-$2')
    .replace(/([a-z0-9])([\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af])/g, '$1-$2')
    .replace(/([\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af])([a-z0-9])/g, '$1-$2')
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '')
}

/**
 * 附件名 → 输出名片段（不含目录）。
 * 规则必须保持稳定：已导入的日记图片按这套命名落了盘，改了会让引用漂移。
 */
export function sanitizeStem(name) {
  return path
    .basename(name, path.extname(name))
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '')
}

/** 递归列出目录下所有文件 */
export function walk(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name)
      return entry.isDirectory() ? walk(full) : [full]
    })
    .sort()
}

/**
 * 图片仓库：把库内图片压成 JPEG 写到站点目录，返回站点内 URL。
 * @param {{ outDir: string, urlPrefix: string, sourceDirs: string[], maxWidth: number, quality: number, force: boolean, dryRun: boolean, stats: object }} options
 */
export function createImageStore({ outDir, urlPrefix, sourceDirs, maxWidth, quality, force, dryRun, stats }) {
  /** 源文件绝对路径 → URL */
  const cache = new Map()
  /** 输出文件名 → 源绝对路径（检测重名） */
  const owners = new Map()

  return {
    /** 在笔记所在目录和附件目录里找图 */
    find(target, entryDir) {
      for (const dir of [entryDir, ...sourceDirs]) {
        const candidate = path.join(dir, target)
        if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
      }
      return null
    },

    /** 转换并返回 URL；找不到源文件返回 null */
    async store(target, entryDir) {
      const source = this.find(target, entryDir)
      if (!source) {
        stats.missingImages.push(target)
        return null
      }
      if (cache.has(source)) return cache.get(source)

      // 动图必须整段读（默认只读第一帧，会静默丢动画），所以先看元数据
      const ext = path.extname(target).toLowerCase()
      const meta = ANIMATABLE_EXT.includes(ext)
        ? await sharp(source, { animated: true, limitInputPixels: false }).metadata()
        : await sharp(source).metadata()
      const isAnimated = (meta.pages ?? 1) > 1

      const stem = sanitizeStem(target) || 'image'
      const hash = createHash('sha1').update(target).digest('hex').slice(0, 8)
      const suffix = isAnimated ? '.webp' : '.jpg'
      let name = `${stem}${suffix}`
      const owner = owners.get(name)
      if (owner && owner !== source) name = `${stem}-${hash}${suffix}`

      // 早期版本把动图转成了静态 jpg，这里顺手清掉旧产物
      const stale = path.join(outDir, `${stem}.jpg`)
      if (isAnimated && existsSync(stale) && !owners.has(`${stem}.jpg`)) rmSync(stale, { force: true })

      const dest = path.join(outDir, name)
      const isFresh = existsSync(dest) && !force && statSync(dest).mtimeMs >= statSync(source).mtimeMs
      if (isFresh) {
        stats.reusedImages++
      } else if (!dryRun) {
        mkdirSync(outDir, { recursive: true })
        if (isAnimated) {
          await sharp(source, { animated: true, limitInputPixels: false })
            .resize({ width: ANIMATED_MAX_WIDTH, height: ANIMATED_MAX_WIDTH, fit: 'inside', withoutEnlargement: true })
            .webp({ quality: ANIMATED_QUALITY, effort: 3, loop: meta.loop ?? 0 })
            .toFile(dest)
          stats.animated++
        } else {
          await sharp(source, { animated: false })
            .rotate()
            .resize({ width: maxWidth, height: maxWidth, fit: 'inside', withoutEnlargement: true })
            .flatten({ background: '#ffffff' })
            .jpeg({ quality, mozjpeg: true, progressive: true })
            .toFile(dest)
        }
        stats.images++
        stats.storedBytes += statSync(dest).size
      }

      const url = `${urlPrefix}/${encodeURI(name)}`
      cache.set(source, url)
      owners.set(name, source)
      return url
    },
  }
}

/**
 * 正文转换：![[图]] / ![alt](相对路径) → 站点图片；![[视频]]、附件 → 一行说明；[[双链]]、库内死链 → 纯文本。
 * @param {string} raw
 * @param {{ store: object, entryDir: string, stats: object }} context
 */
export async function transformBody(raw, { store, entryDir, stats }) {
  const replacements = new Map()

  for (const match of raw.matchAll(/!\[\[([^\]]+)\]\]/g)) {
    const token = match[0]
    if (replacements.has(token)) continue
    const parts = match[1].split('|').map((part) => part.trim())
    const target = parts[0]
    const display = parts.slice(1).find((part) => part && !/^\d+x\d+$/.test(part))
    const ext = path.extname(target).toLowerCase()

    if (IMAGE_EXT.includes(ext)) {
      const url = await store.store(target, entryDir)
      replacements.set(token, url ? `![${display ?? ''}](${url})` : `> （原图缺失：${target}）`)
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
      const url = await store.store(target, entryDir)
      replacements.set(token, url ? `![${alt}](${url})` : `> （原图缺失：${target}）`)
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

  // ==高亮== → <mark>（markdown-it 不认识这个语法，不转换就会原样显示）；代码里跳过
  out = out
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((segment, index) => (index % 2 ? segment : segment.replace(/==([^=\n]+?)==/g, '<mark>$1</mark>')))
    .join('')

  return out
}
