import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vitepress'
import taskLists from 'markdown-it-task-lists'
import { renderFeed, renderManifest } from './lib/feed.mjs'
import { COLLECTIONS, draftFiles, loadPosts } from './lib/posts.mjs'

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

/**
 * 中文分词：MiniSearch 默认只按空白和标点切词，一段连续的汉字会整体变成一个词，
 * 于是「文件夹」能搜到（它恰好被标点独立出来），而「件夹」「建文」搜不到。
 * 这里按二元组切汉字串（CJK bigram，业界通用做法）：任意 2 字以上的子串都能命中，
 * 不需要词典，索引体积只是变大一点；拉丁字母与数字整体保留，单字片段原样保留兜底。
 * 索引与查询都用这一个函数（VitePress 会把 miniSearch.options 同时传给两边）。
 *
 * 注意：这个函数会被序列化成源码字符串发到浏览器（闭包里的东西带不过去），
 * 所以正则必须写在函数体内部。
 */
function tokenizeCJK(text: string): string[] {
  const separator = /[\n\r\p{Z}\p{P}]+/u
  const hanRun = /(\p{Script=Han}+)/u
  const hanOnly = /^\p{Script=Han}+$/u
  const tokens: string[] = []
  for (const piece of text.split(separator)) {
    for (const run of piece.split(hanRun)) {
      if (!run) continue
      if (!hanOnly.test(run)) {
        tokens.push(run)
        continue
      }
      const chars = [...run]
      if (chars.length === 1) tokens.push(chars[0])
      else for (let index = 0; index < chars.length - 1; index++) tokens.push(chars[index] + chars[index + 1])
    }
  }
  return tokens
}

export default defineConfig({
  title: siteTitle,
  description: siteDescription,
  base,
  lang: 'zh-CN',
  cleanUrls: true,
  lastUpdated: true,
  srcExclude: drafts,
  vite: {
    build: {
      // 搜索索引 chunk 有 ~2MB（含全部日记，中文二元分词的代价），vite 默认 500kB 的提醒对它没意义：
      // 这个 chunk 只在打开搜索框时才动态 import，不进首屏
      chunkSizeWarningLimit: 3000,
    },
  },
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
    config(md) {
      // 日记里的习惯清单是 GFM 任务列表语法，VitePress 默认不渲染成复选框
      md.use(taskLists, { enabled: false, label: true })
    },
  },
  themeConfig: {
    nav: [
      { text: '文章', link: '/posts/' },
      { text: '日记', link: '/diary/' },
      { text: '做片笔记', link: '/video/' },
      { text: '归档', link: '/archive' },
      { text: '标签', link: '/tags' },
      { text: 'RSS', link: '/feed.rss' },
    ],
    search: {
      provider: 'local',
      options: {
        miniSearch: {
          // 索引与查询共用的分词（VitePress 会把这里的 options 一并传给浏览器端）
          options: { tokenize: tokenizeCJK },
          searchOptions: {
            // 与 VitePress 默认一致，只是写出来方便调
            fuzzy: 0.2,
            prefix: true,
            boost: { title: 4, text: 2, titles: 1 },
          },
        },
        translations: {
          button: { buttonText: '搜索', buttonAriaLabel: '搜索' },
          modal: {
            displayDetails: '展开详情',
            resetButtonTitle: '清空',
            backButtonTitle: '返回',
            noResultsText: '没有找到结果',
            footer: {
              selectText: '选择',
              navigateText: '切换',
              closeText: '关闭',
            },
          },
        },
      },
    },
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
      message: `${COLLECTIONS.map((collection) => `${loadPosts({ collections: [collection.name] }).length} ${collection.label}`).join(' · ')} · 基于 VitePress 构建`,
      copyright: '© 2026 deadream',
    },
    socialLinks: [{ icon: 'github', link: repoUrl }],
  },
  buildEnd(siteConfig) {
    // 订阅源与清单只收「文章」分类：日记有 500+ 条，塞进 RSS 会淹掉真正的新内容
    const posts = loadPosts({ collections: ['post'] })
    mkdirSync(siteConfig.outDir, { recursive: true })
    writeFileSync(path.join(siteConfig.outDir, 'feed.rss'), renderFeed(posts, { siteUrl, title: siteTitle, description: siteDescription }))
    writeFileSync(path.join(siteConfig.outDir, 'posts.json'), renderManifest(posts, { siteUrl, title: siteTitle }))
    console.log(
      `[deadream] ${posts.length} 篇文章 → feed.rss, posts.json；${loadPosts({ collections: ['diary'] }).length} 篇日记${drafts.length ? `；${drafts.length} 篇草稿未构建` : ''}`
    )
  },
})
