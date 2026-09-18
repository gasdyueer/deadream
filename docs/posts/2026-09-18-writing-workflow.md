---
title: 写作与发布流程
date: 2026-09-18
tags: [指南, 工具]
description: 这个仓库的日常用法：新建文章、本地预览、提交发布、以及每次部署后在哪里追踪变更。
---

# 写作与发布流程

仓库里所有自动化都围绕两件事：**把文章传上去**，和**知道传上去了什么**。

## 一篇文章长什么样

文章就是 `docs/posts/` 下的一个 Markdown 文件，文件名以日期开头：

```
docs/posts/2026-09-18-hello-deadream.md
```

头部 frontmatter：

```yaml
---
title: 标题
date: 2026-09-18
tags: [指南, 工具]
description: 一句话摘要，会显示在列表页和 RSS 里。
draft: false
---

# 标题

正文。
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `title` | 是 | 列表、RSS、`<title>` 都用它 |
| `date` | 是 | `YYYY-MM-DD`，列表和归档按它排序 |
| `tags` | 否 | 数组或逗号分隔字符串 |
| `description` | 否 | 不写就自动截取正文前 160 字 |
| `updated` | 否 | 填了就在归档页的「最近更新」里按它排序 |
| `draft` | 否 | `true` 时**不构建、不进列表、不出现在 RSS** |

草稿是真正的排除：VitePress 通过 `srcExclude` 跳过这些文件，构建产物里根本没有它的 HTML。

## 日常命令

```bash
pnpm install        # 首次
pnpm dev            # 本地预览 http://localhost:5173
pnpm new "文章标题"  # 新建文章，自动生成日期文件名和 frontmatter
pnpm track          # 看所有文章的状态：已发布 / 草稿 / 未提交
pnpm ship           # 提交并推送，自动生成 commit message
```

`pnpm new` 的常用参数：

```bash
pnpm new "给 VitePress 加 RSS" --tags 工具,博客
pnpm new "还没写完的东西" --draft   # 存成草稿，不会被发布
```

写完 `pnpm dev` 看一眼，然后：

```bash
pnpm ship
```

这一步会 `git add -A`，根据本次改动的文章自动拼出 commit message（例如 `post: 新增《给 VitePress 加 RSS》`），提交并推送到 `main`。

## 部署与追踪

推送到 `main` 会触发 `.github/workflows/deploy.yml`：

1. 安装依赖、`pnpm build`；
2. 生成 `feed.rss` 和 `posts.json`；
3. 把本次推送的文章变更（新增 / 更新 / 删除 / 发布 / 转为草稿）写进 Actions 运行摘要；
4. 上传产物并部署到 GitHub Pages。

所以「我这次到底发了什么」有两个地方可以看：

- **Actions 运行摘要**：`gh run list` 找到那次运行，`gh run view <id>` 看文章变更表。
- **站点上的 `posts.json`**：所有已发布文章的清单（标题、日期、标签、字数、正文哈希），可以直接 diff 出「哪篇文章的正文变了」。

```bash
gh run list --limit 5          # 最近几次部署
gh run watch                   # 盯着当前这次
curl -s <站点地址>/posts.json | jq '.count'
```

## 改动正文和改动元信息是两回事

`posts.json` 里每篇文章都有一个 `hash`，它只由正文计算。所以：

- 只改标题、标签、日期 → `hash` 不变；
- 正文动了 → `hash` 变。

CI 的文章变更表会据此区分「🏷️ 元信息」和「✏️ 更新」，不用点进 diff 也能看出这次动了什么。

