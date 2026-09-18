const XML_ESCAPES = { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }

/** 转义 XML 文本节点与属性值。 */
export function escapeXml(value) {
  return String(value).replace(/[<>&'"]/g, (char) => XML_ESCAPES[char])
}

/**
 * 生成 RSS 2.0。
 * @param {import('./posts.mjs').Post[]} posts
 * @param {{ siteUrl: string, title: string, description: string, language?: string }} options
 */
export function renderFeed(posts, { siteUrl, title, description, language = 'zh-CN' }) {
  const items = posts
    .map((post) => {
      const link = `${siteUrl}${post.url}`
      const lines = [
        '    <item>',
        `      <title>${escapeXml(post.title)}</title>`,
        `      <link>${link}</link>`,
        `      <guid isPermaLink="true">${link}</guid>`,
      ]
      if (post.date) lines.push(`      <pubDate>${new Date(`${post.date}T00:00:00Z`).toUTCString()}</pubDate>`)
      lines.push(`      <description>${escapeXml(post.description)}</description>`)
      for (const tag of post.tags) lines.push(`      <category>${escapeXml(tag)}</category>`)
      lines.push('    </item>')
      return lines.join('\n')
    })
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(title)}</title>
    <link>${siteUrl}/</link>
    <description>${escapeXml(description)}</description>
    <language>${language}</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <generator>VitePress</generator>
    <atom:link href="${siteUrl}/feed.rss" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>
`
}

/**
 * 生成已发布文章清单（归档、外部追踪、CI 校验共用）。
 * @param {import('./posts.mjs').Post[]} posts
 * @param {{ siteUrl: string, title: string }} options
 */
export function renderManifest(posts, { siteUrl, title }) {
  return `${JSON.stringify(
    {
      site: title,
      siteUrl,
      generatedAt: new Date().toISOString(),
      count: posts.length,
      posts: posts.map((post) => ({
        title: post.title,
        url: `${siteUrl}${post.url}`,
        path: post.file,
        date: post.date,
        updated: post.updated,
        tags: post.tags,
        words: post.words,
        minutes: post.minutes,
        hash: post.hash,
      })),
    },
    null,
    2
  )}\n`
}
