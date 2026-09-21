/**
 * 标签是硬要求，这里是唯一的判定与文案来源。
 *
 * 列表页、标签页（docs/tags.md 只收「文章」分类）与订阅源都按标签聚合，
 * 没有标签的文章在站点里等于检索不到自己，所以三个入口各拦一道：
 * scripts/new-post.mjs（非草稿）、scripts/import-posts.mjs、scripts/ship.mjs（提交前）。
 */
import { loadPosts } from '../../docs/.vitepress/lib/posts.mjs'

/** 没有标签的条目（`{ path, title, tags }`） */
export function untagged(entries) {
  return entries.filter((entry) => !entry.tags.length)
}

/** 现有标签池：提示复用，别每篇造一个新词。传 collections 就只看这几个分类 */
export function knownTags(collections) {
  const tags = new Set(loadPosts({ drafts: 'include', collections }).flatMap((post) => post.tags))
  return [...tags].sort((a, b) => a.localeCompare(b, 'zh'))
}

/** 「该怎么写标签」的公共两行：现有词表 + 粒度规则 */
export function tagHints(collections) {
  return [
    `现有标签：${knownTags(collections).join('  ')}`,
    '标签优先复用已有词；2–4 个，宽泛题材 + 具体对象成对（例：游戏 + CS2），别拿一次性的名字当标签。',
  ].join('\n')
}

/** 缺标签的报错块：标题行 + 文件清单 + tagHints + 一行修法（调用方给） */
export function formatUntagged(entries, { collections, fix }) {
  return [
    `${entries.length} 篇内容缺少标签：`,
    ...entries.map((entry) => `  ${entry.path}（${entry.title}）`),
    '',
    tagHints(collections),
    fix,
  ].join('\n')
}
