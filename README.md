# deadream

基于 VitePress 的博客，部署在 GitHub Pages。

## 本地

```bash
pnpm install
pnpm dev            # http://localhost:5173
```

## 写作

```bash
pnpm new "文章标题" --tags 工具,博客   # 生成 docs/posts/YYYY-MM-DD-slug.md
pnpm dev                              # 边写边看
pnpm track                            # 所有文章状态：已发布 / 草稿 / 未提交
pnpm ship                             # 提交并推送，自动生成 commit message
```

文章是 `docs/posts/` 下的 Markdown，frontmatter 见 `docs/posts/2026-09-18-writing-workflow.md`。

## 目录

```
docs/
  posts/                      文章（index.md 是列表页，不是文章）
  .vitepress/
    config.mts                站点配置；buildEnd 生成 feed.rss 与 posts.json
    lib/posts.mjs             扫描 + 解析文章（唯一实现，脚本与站点共用）
    lib/posts.d.mts           上述模块的类型契约
    lib/feed.mjs              RSS 与已发布清单渲染
    theme/                    自定义主题：文章列表、标签页、文章头部信息条
scripts/
  new-post.mjs                新建文章
  track.mjs                   文章状态总览
  ship.mjs                    提交并推送
  changelog.mjs               CI 用的文章变更追踪
.github/workflows/deploy.yml  构建 → 追踪 → 部署 Pages
```

## 发布链路

`pnpm ship` → push 到 `main` → Actions 构建 → 部署 Pages。

每次运行会把「本次推送新增/更新/删除/发布/转为草稿的文章」写进 Actions 运行摘要，同时打在步骤日志里：

```bash
gh run list --limit 5
gh run view <run-id>                        # 摘要里就是文章变更表
gh run view <run-id> --log | grep -A20 '文章追踪'
```

站点同时输出两份机器可读文件：

- `/posts.json` — 已发布文章清单（标题、日期、标签、字数、正文 `hash`）
- `/feed.rss` — RSS 2.0

草稿（frontmatter `draft: true`）通过 `srcExclude` 排除，构建产物里没有它的 HTML。

## 换仓库名 / 自定义域名

改 `.github/workflows/deploy.yml` 里的 `SITE_URL` 与 `BASE_PATH` 两个 env，以及 `docs/.vitepress/config.mts` 里 `repoUrl`、`themeConfig.footer.copyright`。
