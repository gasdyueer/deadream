import { defineLoader } from 'vitepress'
import { loadPosts, type Post } from '../lib/posts.mjs'

declare const data: Post[]
export { data }

/** 「日记」分类：docs/diary 下已发布的日记。 */
export default defineLoader({
  watch: ['diary/**/*.md'],
  load(): Post[] {
    return loadPosts({ collections: ['diary'] })
  },
})
