import { defineLoader } from 'vitepress'
import { groupByTag, loadPosts, type Post } from '../lib/posts.mjs'

/** 一个标签及其下的文章 */
export interface TagGroup {
  tag: string
  posts: Post[]
}

declare const data: TagGroup[]
export { data }

/** 标签聚合（只看「文章」分类，日记自成一类不参与打标）。 */
export default defineLoader({
  watch: ['posts/**/*.md'],
  load(): TagGroup[] {
    return groupByTag(loadPosts({ collections: ['post'] }))
  },
})
