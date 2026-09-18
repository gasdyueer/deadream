import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import Layout from './Layout.vue'
import PostList from './components/PostList.vue'
import PostMeta from './components/PostMeta.vue'
import TagIndex from './components/TagIndex.vue'
import './style.css'

export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ app }) {
    app.component('PostList', PostList)
    app.component('PostMeta', PostMeta)
    app.component('TagIndex', TagIndex)
  },
} satisfies Theme
