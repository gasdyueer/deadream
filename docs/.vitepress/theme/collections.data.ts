import { defineLoader } from 'vitepress'
import { COLLECTIONS, loadPosts, type Collection, type CollectionName, type Post } from '../lib/posts.mjs'

export type { CollectionName, Post }

/** 一个分类，以及它下面已发布的内容 */
export interface CollectionData extends Collection {
  posts: Post[]
}

declare const data: CollectionData[]
export { data }

/**
 * 全部分类及其内容。草稿（frontmatter `draft: true`）既不构建，也不出现在这里。
 * 列表组件按 `collection` 取值，文章头部信息条则跨分类查找当前页。
 */
export default defineLoader({
  watch: COLLECTIONS.map((collection) => `${collection.dir}/**/*.md`),
  load(): CollectionData[] {
    return COLLECTIONS.map((collection) => ({
      ...collection,
      posts: loadPosts({ collections: [collection.name] }),
    }))
  },
})
