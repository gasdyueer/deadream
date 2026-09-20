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
pnpm track                            # 内容状态：文章 / 日记 / 草稿 / 未提交
pnpm ship                             # 提交并推送，自动生成 commit message
pnpm upload "D:/Note/…/笔记.md"        # 导入一篇 Obsidian 笔记 → 提交 → 推送，一条命令
```

文章是 `docs/posts/` 下的 Markdown，文件名以日期开头（`docs/posts/YYYY-MM-DD-slug.md`），头部 frontmatter：

```yaml
---
title: 标题
date: 2026-09-18
tags: [工具, 博客]
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
| `draft` | 否 | `true` 时**不构建、不进列表、不出现在 RSS**——`srcExclude` 直接跳过，产物里没有它的 HTML |

`pnpm new` 的常用参数与流程：

```bash
pnpm new "给 VitePress 加 RSS" --tags 工具,博客
pnpm new "还没写完的东西" --draft   # 存成草稿，不会被发布
```

写完 `pnpm dev` 看一眼，再 `pnpm ship` 提交并推送。

## 分类

站点按目录分三类，`docs/.vitepress/lib/posts.mjs` 里的 `COLLECTIONS` 是唯一声明处（目录名 = URL 前缀，标签页与订阅源只收「文章」）：

| 分类 | 目录 | 入口 | 说明 |
| --- | --- | --- | --- |
| 文章 | `docs/posts/` | `/posts/` | 成篇的文章，进 RSS 与 `posts.json` |
| 日记 | `docs/diary/` | `/diary/` | Obsidian 日记，500+ 条，不进订阅源 |
| 做片笔记 | `docs/video/` | `/video/` | Blender / AE / MMD / MAD 拉片等 |

加一个分类：在 `COLLECTIONS` 里加一行（目录自动扫描、导航与页脚要手动加一项），追踪脚本会跟着走。

## 搜索

用 VitePress 自带的 `local` provider（浏览器端 MiniSearch，构建时把全站按标题切成 1370 个「章节」建索引）。**日记要能搜**，所以索引里含全部日记——这是刻意的，别拿 `search: false` 把日记排掉。

**中文分词是自定义的**（`config.mts` 里的 `tokenizeCJK`）。MiniSearch 默认只按空白和标点切词，一段连续汉字会整体成一个词：`创建文件夹` 能搜到，「建文」「件夹」搜不到。现在按**二元组**切汉字串（`创建文件夹` → `创建 建文 文件 件夹`），任意 2 字以上的子串都能命中，拉丁字母与数字仍整体保留。

| | 改前（默认分词） | 改后（二元组） |
| --- | --- | --- |
| 索引体积 | 1.06MB / 276KB gzip | 2.02MB / **419KB gzip** |
| 「建文」「件夹」这类子串 | 0 条 | 3 / 10 条 |
| 「文件夹」「移动平台」 | 2 / 1 条 | 16 / 16 条（第一条都是对应章节） |
| 英文词（godot / pong） | 正常 | 正常 |

索引只在**打开搜索框时**才加载，不影响首屏。其中 91% 是日记（1247/1370 段）——这是有意为之，因为日记也要能搜；想更小只能牺牲日记，别这么干。

配置项都在 `themeConfig.search.options` 里：

- `miniSearch.options.tokenize` — 分词器，**索引与查询共用**（VitePress 把这里的 options 同时传给构建端和浏览器端）
- `miniSearch.searchOptions` — 查询参数：`fuzzy`（0.2，2 字以上的词才吃容错）、`prefix`（前缀匹配）、`boost`（标题权重 4）、`combineWith`（默认 `or`，多词任中；改成 `and` 会同时要求命中所有词，长句查询会漏）
- `translations` — 搜索框文案

两个坑（改这个文件时注意）：

1. 分词函数会被**序列化成源码字符串**发到浏览器（`new Function` 复活），闭包里的变量带不过去——正则必须写在函数体内部。
2. 自定义函数只在 `miniSearch.options` 里写一次就够；写进 `searchOptions` 反而多余。

按页面排除搜索：frontmatter 加 `search: false`（VitePress 内部就是 `env.frontmatter?.search === false ? "" : html`）。

## 从 Obsidian 导入

两个导入脚本共用同一套转换逻辑（`scripts/lib/import-note.mjs`），源文件只读不删：

| 命令 | 用途 | 输出 |
| --- | --- | --- |
| `pnpm import:diary` | 整库导入日记（`Diary/` 下全部 md） | `docs/diary/<日期-时间>.md` + `docs/public/images/diary/` |
| `pnpm import:posts <笔记.md>...` | 把指定笔记搬进某个分类 | `docs/<分类>/<日期-slug>.md` + `docs/public/images/<分类>/<日期-slug>/` |
| `pnpm upload <笔记.md>...` | 同上，导入完顺带提交并推送（= `import:posts --ship`） | 同上一行，另加一次 commit + push |

```bash
pnpm import:diary
node scripts/import-diary.mjs --source "D:/Note/social death"
node scripts/import-posts.mjs "D:/Note/social death/2024暑假总结.md" --tags 总结,学习
node scripts/import-posts.mjs --collection video --tags Blender "D:/Note/social death/做片笔记/Blender小技巧.md"
node scripts/import-posts.mjs --collection video --attachments "D:/Note/另一处附件" "D:/Note/x.md"   # 附件不在默认目录时
```

### 上传一篇笔记

导入 + 提交 + 推送本来是三步，`pnpm upload` 一条命令做完（先 `--dry-run` 看一眼要写成什么，再真发）：

```bash
pnpm upload "D:/Note/social death/随笔/为什么我讨厌看AI漫剧.md" --dry-run   # ~1s，只打印计划，不写盘不提交
pnpm upload "D:/Note/social death/随笔/为什么我讨厌看AI漫剧.md"             # 导入 → 提交 → 推送
pnpm upload "D:/Note/social death/2024暑假总结.md" --tags 总结,学习          # 参数与 import:posts 完全一致
pnpm upload --collection video --tags Blender "D:/Note/social death/做片笔记/Blender小技巧.md"
pnpm import:diary --ship                                                    # 整库日记也可以导入完直接发
```

`--ship` 只是把 `scripts/ship.mjs` 当子进程再跑一遍（`scripts/lib/ship-run.mjs`）：commit message、暂存范围、push 失败后的代理重试都还是 `ship` 那一套，不重复实现；ship 失败会以它的退出码结束，不会用「导入完成」掩盖「没发出去」。

这条流程**不跑本地全量构建**——构建是 CI 的事，导入报告（缺失图片、动图张数、未收录附件）才是导入本身会踩的坑，而且只要约 1 秒；全量构建本机 14~20 秒，本地跑它只是把 CI 已经要做的事再做一遍。整条 `pnpm upload`（导入 + 提交 + 推送）实测 11.9 秒，其中 push 的网络往返占大头。改到图片管线、附件查找这类地方时再 `pnpm build` 本地确认。

转换规则：

1. **元信息**：日记从文件名解析日期时间（`2026年3月30日星期一晚上6点41分.md` → `2026-03-30` 18:41、`2024-05-21.md`、`20240119.md`）；其他笔记取 frontmatter 的 `title`/`date`（`zhihu-*` 之类的插件字段丢弃），没有就用文件名和修改时间，正文没有一级标题会自动补一个。
2. **语法**：`![[图.png|alt]]` → `![alt](/images/…)`，`![alt](库内相对路径)` → 同上，`[[笔记|显示]]` → 纯文本，`==高亮==`/`===高亮===` → **粗体**（代码块与行内代码里不动；用 markdown 的 `**` 而不是 `<mark>`，否则 `*强调*` 可能跨标签配对成交叉嵌套的 HTML，Vue 编译不过），库内死链只留文字；`> [!NOTE]` 这类 Obsidian 标注 VitePress 自己能认；视频与 `.canvas`/`.html` 附件不入库，正文里留一行「未收录」标注。
3. **图片**：只处理被引用到的图片。静图 → JPEG（最长边 1920、q82、白底、按 EXIF 转正）；**动图（GIF / APNG / 动图 WebP）→ 动图 WebP**（最长边 800、q75，帧数与循环次数原样保留），按帧数判断而不是看扩展名。日记原图 840MB → 60MB，其中 37 个动图 800MB → 59MB。附件按「笔记同级目录 → 上级 `images/` → `--attachments` 指定目录」的顺序查找，Obsidian 库里有多个附件目录时把缺的那些都传进来。
4. **幂等**：已转换且比源文件新的图片会跳过（`--force` 强制重转）；笔记重新导入会覆盖原文件（标题一致即视为同一篇），所以改了原笔记再跑一次就是一次「更新」。

`--dry-run` 可以只看结果不写盘。

手工丢进 `docs/public/images/<分类>/` 的图片不过这条管线，尤其是截屏动图，单张能到 8MB。这类图用 `pnpm shrink:images` 就地重压：

```bash
pnpm shrink:images --dry-run     # 只看能省多少
pnpm shrink:images               # 就地替换，文件名与格式不变
```

只碰 ≥512KB 的**动图**（帧数与循环次数原样保留），而且重压后必须小 10% 以上才替换，所以同一套参数重复运行不会把已经压过的图反复压。2026-09 那次：≥512KB 的动图 27 个，18 个达标，34.85MB → 30.53MB（最大的 8.32MB → 7.06MB）。静图不动 —— 它们是导入管线的产物（最长边 1920 / q82），再压没有收益。

订阅源（`feed.rss`）与 `posts.json` 只收「文章」分类 —— 500+ 条日记会把新内容淹掉。想改这个行为，改 `docs/.vitepress/config.mts` 里 `buildEnd` 的 `collections` 参数。

## 构建

本地 `pnpm build` 常年要 5 分钟以上、而且根本跑不完，原因都出在 VitePress 的「每个页面 spawn 一次 `git`」上。本机 git 进程启动约 1 秒（`git --version` 连跑 20 次要 19 秒 —— 杀软实时扫描那类问题），557 个页面就直接放大成分钟级；CI 上 git 快得多，所以这是本地特有的坑。

| 环节 | VitePress 默认 | 现在 |
| --- | --- | --- |
| 页脚「最后更新」 | 每页一次 `git log -1 --pretty="%ai" <文件>`（`getGitTimestamp`） | 一条 `git log --name-only` 扫全库拿「文件 → 最后提交时间」，再由 Vite 插件把 `lastUpdated: <ISO>` 注入 md 的 frontmatter（`lib/last-updated.mjs`）。VitePress 见 frontmatter 里是 Date 就直接用、不再 spawn |
| `sitemap.xml` | 每页再一次（`getLastmod`），而且只读**磁盘上**的 frontmatter，构造期注入的那份它看不见 | 不用 VitePress 的 sitemap，在 `buildEnd` 里用同一份扫描结果自己渲染（`lib/sitemap.mjs`），URL 规则与 lastmod 口径保持一致 |

取值不变：改造前后逐页比对 561 个页面，557 个页脚时间完全一致，另外 4 个（首页、404、两篇未提交的新文章）两边都不显示。本地全量构建 5 分 36 秒（还没跑完，卡在 sitemap 的 git 循环里）→ **13.75 秒**。

页面自己写了 frontmatter `lastUpdated` 的，插件不覆盖；写 `lastUpdated: false` 就是不显示。

图片默认加 `loading="lazy"`（`markdown.image.lazyLoading`）：做片笔记那种一页 50+ 张动图的笔记，不加会首屏就把几十 MB 拉下来 —— 实测加上之后首屏只取 18/55 张。

## 目录

```
docs/
  posts/                      文章（index.md 是列表页，不是文章）
  diary/                      日记（来自 Obsidian 导入）
  video/                      做片笔记
  public/images/<分类>/       各分类的图片（JPEG，由导入脚本生成）
  .vitepress/
    config.mts                站点配置；buildEnd 生成 feed.rss / posts.json / sitemap.xml
    lib/posts.mjs             扫描 + 解析内容、分类声明（唯一实现，脚本与站点共用）
    lib/posts.d.mts           上述模块的类型契约
    lib/feed.mjs              RSS 与已发布清单渲染
    lib/last-updated.mjs      一次 git 扫描 + 构建期注入 frontmatter.lastUpdated
    lib/sitemap.mjs           sitemap.xml 渲染
    theme/collections.data.ts 按分类加载内容，供列表与信息条使用
    theme/                    自定义主题：内容列表、标签页、内容头部信息条
scripts/
  new-post.mjs                新建文章
  import-diary.mjs            导入 Obsidian 日记库
  import-posts.mjs            把指定笔记搬进某个分类
  shrink-images.mjs           重压过大的动图
  lib/import-note.mjs         导入共用：命名、附件查找、图片转码、语法转换
  lib/git-push.mjs            push 网络失败后走代理重试一次
  lib/ship-run.mjs            导入脚本 --ship 的收尾：跑一遍 ship.mjs
  track.mjs                   内容状态总览（按分类）
  ship.mjs                    提交并推送
  changelog.mjs               CI 用的内容变更追踪
.github/workflows/deploy.yml  构建 → 追踪 → 部署 Pages
```

## 发布链路

`pnpm ship` → push 到 `main` → Actions 构建 → 部署 Pages。`.github/workflows/deploy.yml` 每次运行做四件事：安装依赖并 `pnpm build`；生成 `feed.rss` 与 `posts.json`；把本次推送的文章变更写进运行摘要；上传产物并部署到 GitHub Pages。

`git push` 遇到**网络类**失败（`SSL_ERROR_SYSCALL`、`RPC failed`、`Connection reset` 之类）会自动用本机代理再试一次：依次看环境变量 `HTTPS_PROXY`、Windows 系统代理、`127.0.0.1:7890`（都先探测端口通不通），重试时顺手把 `http.version` 降到 HTTP/1.1 —— 大 pack 在 HTTP/2 下更容易 `RPC failed`；再失败就把能直接复制的命令打出来，退出码仍是 1。认证失败、非快进这类业务失败不重试，重试也不会变好。实现见 `scripts/lib/git-push.mjs`。

每次运行会把「本次推送新增/更新/删除/发布/转为草稿的内容」写进 Actions 运行摘要，同时打在步骤日志里（表格含「分类」列，区分文章与日记）：

```bash
gh run list --limit 5                        # 最近几次部署
gh run watch                                 # 盯着当前这次
gh run view <run-id>                         # 摘要里就是文章变更表
gh run view <run-id> --log | grep -A20 '文章追踪'
```

站点同时输出两份机器可读文件：

- `/posts.json` — 已发布文章清单（标题、日期、标签、字数、正文 `hash`）
- `/feed.rss` — RSS 2.0

`posts.json` 里的 `hash` 只由正文算出来：只改标题、标签、日期时它不变，正文动了才变。CI 的文章变更表据此区分「🏷️ 元信息」与「✏️ 更新」，不用点进 diff 也知道这次动了什么：

```bash
curl -s <站点地址>/posts.json | jq '.count'   # 线上已发布篇数
```

## 换仓库名 / 自定义域名

改 `.github/workflows/deploy.yml` 里的 `SITE_URL` 与 `BASE_PATH` 两个 env，以及 `docs/.vitepress/config.mts` 里 `repoUrl`、`themeConfig.footer.copyright`。
