import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vitepress'
import { renderFeed, renderManifest } from './lib/feed.mjs'
import { draftFiles, loadPosts } from './lib/posts.mjs'

/** 站点根地址（含 base，无尾斜杠），CI 通过 SITE_URL 注入 */
const siteUrl = (process.env.SITE_URL || 'https://gasdyueer.github.io/deadream').replace(/\/+$/, '')
/** 部署路径，GitHub Pages 项目站点为 /<repo>/，本地为 / */
const base = process.env.BASE_PATH || '/'
/** base 去斜杠后的形式，用于手工拼接绝对 URL */
const basePath = base.replace(/^\/|\/$/g, '')
const siteTitle = 'deadream'
const siteDescription = '一个用来存放想法、代码与笔记的地方。'
const repoUrl = 'https://github.com/gasdyueer/deadream'

const drafts = draftFiles()

export default defineConfig({
  title: siteTitle,
  description: siteDescription,
  base,
  lang: 'zh-CN',
  cleanUrls: true,
  lastUpdated: true,
  srcExclude: drafts,
  sitemap: {
    // hostname 只到源站；VitePress 用 new URL(page, hostname) 拼接，base 会被吃掉，所以靠 transformItems 补回来
    hostname: new URL(siteUrl).origin,
    transformItems: (items) =>
      items.map((item) => ({ ...item, url: `/${[basePath, item.url.replace(/^\//, '')].filter(Boolean).join('/')}` })),
  },
  head: [
    ['link', { rel: 'alternate', type: 'application/rss+xml', title: `${siteTitle} RSS`, href: `${siteUrl}/feed.rss` }],
    ['meta', { name: 'theme-color', content: '#3451b2' }],
    ['meta', { name: 'author', content: 'deadream' }],
  ],
  markdown: {
    lineNumbers: false,
  },
  themeConfig: {
    nav: [
      { text: '文章', link: '/posts/' },
      { text: '归档', link: '/archive' },
      { text: '标签', link: '/tags' },
      { text: 'RSS', link: '/feed.rss' },
    ],
    search: { provider: 'local' },
    outline: { level: [2, 3], label: '本页目录' },
    lastUpdated: { text: '最后更新' },
    docFooter: { prev: '上一篇', next: '下一篇' },
    darkModeSwitchLabel: '外观',
    lightModeSwitchTitle: '切换到浅色模式',
    darkModeSwitchTitle: '切换到深色模式',
    sidebarMenuLabel: '菜单',
    returnToTopLabel: '回到顶部',
    externalLinkIcon: true,
    footer: {
      message: `共 ${loadPosts().length} 篇文章 · 基于 VitePress 构建`,
      copyright: '© 2026 deadream',
    },
    socialLinks: [{ icon: 'github', link: repoUrl }],
  },
  buildEnd(siteConfig) {
    const posts = loadPosts()
    mkdirSync(siteConfig.outDir, { recursive: true })
    writeFileSync(path.join(siteConfig.outDir, 'feed.rss'), renderFeed(posts, { siteUrl, title: siteTitle, description: siteDescription }))
    writeFileSync(path.join(siteConfig.outDir, 'posts.json'), renderManifest(posts, { siteUrl, title: siteTitle }))
    console.log(`[deadream] ${posts.length} 篇已发布文章 → feed.rss, posts.json${drafts.length ? `（${drafts.length} 篇草稿未构建）` : ''}`)
  },
})
