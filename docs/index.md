---
layout: home

hero:
  name: deadream
  text: 写点什么
  tagline: 一个用来存放想法、代码与笔记的地方。
  actions:
    - theme: brand
      text: 开始阅读
      link: /posts/
    - theme: alt
      text: 归档
      link: /archive

features:
  - title: 一篇 Markdown 就是一篇博客
    details: 文章放进 docs/posts，文件名带日期，frontmatter 里写标题、标签、摘要。
  - title: push 即发布
    details: 推到 main 分支后，GitHub Actions 自动构建并部署到 GitHub Pages。
  - title: 变更可追踪
    details: 每次部署都会生成文章变更清单，站点同时输出 posts.json 全量已发布清单。
---

## 最新文章

<PostList :limit="5" />
