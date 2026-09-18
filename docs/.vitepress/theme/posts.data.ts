import { defineLoader } from 'vitepress'
import { loadPosts, type Post } from '../lib/posts.mjs'

export type { Post }

declare const data: Post[]
export { data }

/** 全站已发布文章。草稿（frontmatter `draft: true`）既不构建，也不出现在这里。 */
export default defineLoader({
  watch: ['posts/**/*.md'],
  load(): Post[] {
    return loadPosts()
  },
})
