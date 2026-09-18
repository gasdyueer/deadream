import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import matter from 'gray-matter'

/** docs 目录绝对路径 */
export const DOCS_DIR = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
/** 文章目录名（相对 docs） */
export const POSTS_DIRNAME = 'posts'
/** 文章目录绝对路径 */
export const POSTS_DIR = path.join(DOCS_DIR, POSTS_DIRNAME)

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g
const LATIN_RE = /[A-Za-z0-9][A-Za-z0-9'’_-]*/g
const DATE_PREFIX_RE = /(\d{4})-(\d{2})-(\d{2})/

/** 列出所有文章文件（相对 docs 的 posix 路径），跳过目录页 index.md 与下划线前缀的草稿目录。 */
export function listPostFiles() {
  if (!existsSync(POSTS_DIR)) return []
  return readdirSync(POSTS_DIR, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .filter((entry) => entry.name.toLowerCase() !== 'index.md' && !entry.name.startsWith('.'))
    .map((entry) =>
      path
        .relative(DOCS_DIR, path.join(entry.parentPath ?? entry.path, entry.name))
        .split(path.sep)
        .join('/')
    )
    .filter((file) => !file.split('/').some((segment) => segment.startsWith('.') || segment.startsWith('_')))
    .sort()
}

/** 把 Date / 任意日期串统一成 YYYY-MM-DD，失败时回落 fallback。 */
function normalizeDate(value, fallback = '') {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10)
  if (typeof value === 'string') {
    const matched = DATE_PREFIX_RE.exec(value.trim())
    if (matched) return `${matched[1]}-${matched[2]}-${matched[3]}`
  }
  return fallback
}

/** 去掉 Markdown 语法，得到可读纯文本。 */
export function stripMarkdown(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s+.*$/gm, ' ')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}[-*+]\s+/gm, '')
    .replace(/[*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 统计字数：中日韩字符按字，拉丁按词；阅读时长按 300 字/分、220 词/分。 */
export function measure(text) {
  const plain = stripMarkdown(text)
  const cjk = (plain.match(CJK_RE) ?? []).length
  const latin = (plain.match(LATIN_RE) ?? []).length
  return {
    words: cjk + latin,
    minutes: Math.max(1, Math.round(cjk / 300 + latin / 220)),
  }
}

/** 从原始 Markdown（含 frontmatter）解析出一篇文章。 */
export function parsePost(file, raw) {
  const { data, content } = matter(raw)
  const stem = file.replace(/\.md$/i, '')
  const titleFromFile = path
    .basename(stem)
    .replace(/^\d{4}-\d{2}-\d{2}-/, '')
    .replace(/[-_]+/g, ' ')

  const tags = Array.isArray(data.tags)
    ? data.tags.map((tag) => String(tag).trim()).filter(Boolean)
    : typeof data.tags === 'string'
      ? data.tags.split(/[,，\s]+/).map((tag) => tag.trim()).filter(Boolean)
      : []

  const date = normalizeDate(data.date, normalizeDate(file))
  const excerpt = stripMarkdown(content).slice(0, 160)

  return {
    title: String(data.title ?? titleFromFile).trim() || titleFromFile,
    url: `/${stem}`,
    file,
    date,
    updated: normalizeDate(data.updated, date),
    description: String(data.description ?? '').trim() || excerpt,
    tags,
    draft: data.draft === true,
    ...measure(content),
    hash: createHash('sha1').update(content.replace(/\r\n/g, '\n').trim()).digest('hex').slice(0, 12),
  }
}

/** 扫描 docs/posts 下的文章，按日期倒序（同日按标题）。drafts 控制草稿的去留。 */
export function loadPosts({ drafts = 'exclude' } = {}) {
  return listPostFiles()
    .map((file) => parsePost(file, readFileSync(path.join(DOCS_DIR, file), 'utf8')))
    .filter((post) => (drafts === 'include' ? true : drafts === 'only' ? post.draft : !post.draft))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.title.localeCompare(b.title))
}

/** 草稿文件列表，用于 VitePress 的 srcExclude。 */
export function draftFiles() {
  return loadPosts({ drafts: 'only' }).map((post) => post.file)
}

/** 按标签聚合：文章多的在前，同数量按标签排序。 */
export function groupByTag(posts) {
  const buckets = new Map()
  for (const post of posts) {
    for (const tag of post.tags) {
      const bucket = buckets.get(tag)
      if (bucket) bucket.push(post)
      else buckets.set(tag, [post])
    }
  }
  return [...buckets.entries()]
    .map(([tag, items]) => ({ tag, posts: items }))
    .sort((a, b) => b.posts.length - a.posts.length || a.tag.localeCompare(b.tag))
}
