/**
 * posts.mjs 的类型契约。运行时实现留在同名的 .mjs，这里只描述对外接口。
 */

/** 内容分类名；必须与 posts.mjs 里的 COLLECTIONS 保持一致 */
export type CollectionName = 'post' | 'diary' | 'video'

/** 一个分类：目录名即 URL 前缀 */
export interface Collection {
  name: CollectionName
  dir: string
  label: string
}

/** 一篇文章的元信息（由 parsePost 生成）。 */
export interface Post {
  /** 标题 */
  title: string
  /** 站点内路径（不含 base），如 /posts/hello、/diary/2025-01-01-2335 */
  url: string
  /** 相对 docs 的路径，如 posts/hello.md */
  file: string
  /** 所属分类 */
  collection: CollectionName
  /** 分类显示名 */
  collectionLabel: string
  /** YYYY-MM-DD */
  date: string
  /** YYYY-MM-DD，未填写时等于 date */
  updated: string
  /** 摘要 */
  description: string
  /** 标签 */
  tags: string[]
  /** 是否为草稿（草稿不构建、不列表） */
  draft: boolean
  /** 字数（中日韩字符 + 拉丁词） */
  words: number
  /** 预计阅读分钟 */
  minutes: number
  /** 正文内容哈希，用于追踪「仅正文更新」 */
  hash: string
}

export declare const DOCS_DIR: string
export declare const POSTS_DIRNAME: string
export declare const DIARY_DIRNAME: string
export declare const POSTS_DIR: string
export declare const COLLECTIONS: Collection[]

export declare function listPostFiles(): string[]
export declare function stripMarkdown(markdown: string): string
export declare function measure(text: string): { words: number; minutes: number }
export declare function parsePost(file: string, raw: string): Post
export declare function loadPosts(options?: { drafts?: 'exclude' | 'include' | 'only'; collections?: CollectionName[] }): Post[]
export declare function draftFiles(): string[]
export declare function groupByTag(posts: Post[]): { tag: string; posts: Post[] }[]
