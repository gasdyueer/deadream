/**
 * posts.mjs 的类型契约。运行时实现留在同名的 .mjs，这里只描述对外接口。
 */

/** 一篇文章的元信息（由 parsePost 生成）。 */
export interface Post {
  /** 标题 */
  title: string
  /** 站点内路径（不含 base），如 /posts/hello */
  url: string
  /** 相对 docs 的路径，如 posts/hello.md */
  file: string
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
export declare const POSTS_DIR: string

export declare function listPostFiles(): string[]
export declare function stripMarkdown(markdown: string): string
export declare function measure(text: string): { words: number; minutes: number }
export declare function parsePost(file: string, raw: string): Post
export declare function loadPosts(options?: { drafts?: 'exclude' | 'include' | 'only' }): Post[]
export declare function draftFiles(): string[]
export declare function groupByTag(posts: Post[]): { tag: string; posts: Post[] }[]
