import { defineLoader } from 'vitepress'
import { groupByTag, loadPosts, type Post } from '../lib/posts.mjs'

/** 一个标签及其下的文章 */
export interface TagGroup {
  tag: string
  posts: Post[]
}

declare const data: TagGroup[]
export { data }

/** 标签聚合，供标签页使用（在 Node 端算好，组件不引入任何 node 模块）。 */
export default defineLoader({
  watch: ['posts/**/*.md'],
  load(): TagGroup[] {
    return groupByTag(loadPosts())
  },
})
