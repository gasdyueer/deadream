/**
 * sitemap.xml。
 *
 * VitePress 自带的 generateSitemap 会给每个页面单独 spawn 一次 `git log` 取 lastmod
 * （node_modules/vitepress/dist/node/chunk-*.js 里的 getLastmod），而且只认磁盘上 frontmatter 里的
 * lastUpdated —— 构建期注入的那份它看不见。本机 git 进程启动约 1 秒，557 个页面就是 9 分钟，
 * 构建会一直卡在「generating sitemap...」。
 *
 * 这里用同一份 git 扫描结果（lib/last-updated.mjs）自己渲染，规则与 VitePress 保持一致：
 * 同样的 URL 归并（cleanUrls、index 归并到目录）与同样的 lastmod（ISO 时间，没有就整条 <lastmod> 不写）。
 * 区别只有一个：base 直接拼进 URL（VitePress 那份要靠 transformItems 补）。
 */

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }

/** XML 文本转义（loc 里可能有 & 或引号） */
function escapeXml(text) {
  return text.replace(/[&<>"']/g, (char) => ENTITIES[char])
}

/** 页面路径 → 站点内相对 URL：index.md 归并到目录，cleanUrls 时去掉 .md */
export function pageUrl(page, cleanUrls) {
  return page.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, cleanUrls ? '' : '.html')
}

/**
 * @param {string[]} pages 相对 docs 的页面路径（siteConfig.pages）
 * @param {{ siteUrl: string, cleanUrls: boolean, lastUpdated: Map<string, string> }} options
 */
export function renderSitemap(pages, { siteUrl, cleanUrls, lastUpdated }) {
  const urls = pages.map((page) => {
    const iso = lastUpdated.get(page)
    return [
      '  <url>',
      `    <loc>${escapeXml(`${siteUrl}/${pageUrl(page, cleanUrls)}`)}</loc>`,
      ...(iso ? [`    <lastmod>${iso}</lastmod>`] : []),
      '  </url>',
    ].join('\n')
  })

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n')
}
