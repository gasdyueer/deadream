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
```

文章是 `docs/posts/` 下的 Markdown，frontmatter 见 `docs/posts/2026-09-18-writing-workflow.md`。

## 分类

站点按目录分三类，`docs/.vitepress/lib/posts.mjs` 里的 `COLLECTIONS` 是唯一声明处（目录名 = URL 前缀，标签页与订阅源只收「文章」）：

| 分类 | 目录 | 入口 | 说明 |
| --- | --- | --- | --- |
| 文章 | `docs/posts/` | `/posts/` | 成篇的文章，进 RSS 与 `posts.json` |
| 日记 | `docs/diary/` | `/diary/` | Obsidian 日记，500+ 条，不进订阅源 |
| 做片笔记 | `docs/video/` | `/video/` | Blender / AE / MMD / MAD 拉片等 |

加一个分类：在 `COLLECTIONS` 里加一行（目录自动扫描、导航与页脚要手动加一项），追踪脚本会跟着走。

## 从 Obsidian 导入

两个导入脚本共用同一套转换逻辑（`scripts/lib/import-note.mjs`），源文件只读不删：

| 命令 | 用途 | 输出 |
| --- | --- | --- |
| `pnpm import:diary` | 整库导入日记（`Diary/` 下全部 md） | `docs/diary/<日期-时间>.md` + `docs/public/images/diary/` |
| `pnpm import:posts <笔记.md>...` | 把指定笔记搬进某个分类 | `docs/<分类>/<日期-slug>.md` + `docs/public/images/<分类>/<日期-slug>/` |

```bash
pnpm import:diary
node scripts/import-diary.mjs --source "D:/Note/social death"
node scripts/import-posts.mjs "D:/Note/social death/2024暑假总结.md" --tags 总结,学习
node scripts/import-posts.mjs --collection video --tags Blender "D:/Note/social death/做片笔记/Blender小技巧.md"
node scripts/import-posts.mjs --collection video --attachments "D:/Note/另一处附件" "D:/Note/x.md"   # 附件不在默认目录时
```

转换规则：

1. **元信息**：日记从文件名解析日期时间（`2026年3月30日星期一晚上6点41分.md` → `2026-03-30` 18:41、`2024-05-21.md`、`20240119.md`）；其他笔记取 frontmatter 的 `title`/`date`（`zhihu-*` 之类的插件字段丢弃），没有就用文件名和修改时间，正文没有一级标题会自动补一个。
2. **语法**：`![[图.png|alt]]` → `![alt](/images/…)`，`![alt](库内相对路径)` → 同上，`[[笔记|显示]]` → 纯文本，`==高亮==`/`===高亮===` → **粗体**（代码块与行内代码里不动；用 markdown 的 `**` 而不是 `<mark>`，否则 `*强调*` 可能跨标签配对成交叉嵌套的 HTML，Vue 编译不过），库内死链只留文字；`> [!NOTE]` 这类 Obsidian 标注 VitePress 自己能认；视频与 `.canvas`/`.html` 附件不入库，正文里留一行「未收录」标注。
3. **图片**：只处理被引用到的图片。静图 → JPEG（最长边 1920、q82、白底、按 EXIF 转正）；**动图（GIF / APNG / 动图 WebP）→ 动图 WebP**（最长边 800、q75，帧数与循环次数原样保留），按帧数判断而不是看扩展名。日记原图 840MB → 60MB，其中 37 个动图 800MB → 59MB。附件按「笔记同级目录 → 上级 `images/` → `--attachments` 指定目录」的顺序查找，Obsidian 库里有多个附件目录时把缺的那些都传进来。
4. **幂等**：已转换且比源文件新的图片会跳过（`--force` 强制重转）；笔记重新导入会覆盖原文件（标题一致即视为同一篇），所以改了原笔记再跑一次就是一次「更新」。

`--dry-run` 可以只看结果不写盘。

订阅源（`feed.rss`）与 `posts.json` 只收「文章」分类 —— 500+ 条日记会把新内容淹掉。想改这个行为，改 `docs/.vitepress/config.mts` 里 `buildEnd` 的 `collections` 参数。

## 目录

```
docs/
  posts/                      文章（index.md 是列表页，不是文章）
  diary/                      日记（来自 Obsidian 导入）
  video/                      做片笔记
  public/images/<分类>/       各分类的图片（JPEG，由导入脚本生成）
  .vitepress/
    config.mts                站点配置；buildEnd 生成 feed.rss 与 posts.json
    lib/posts.mjs             扫描 + 解析内容、分类声明（唯一实现，脚本与站点共用）
    lib/posts.d.mts           上述模块的类型契约
    lib/feed.mjs              RSS 与已发布清单渲染
    theme/collections.data.ts 按分类加载内容，供列表与信息条使用
    theme/                    自定义主题：内容列表、标签页、内容头部信息条
scripts/
  new-post.mjs                新建文章
  import-diary.mjs            导入 Obsidian 日记库
  import-posts.mjs            把指定笔记搬进某个分类
  lib/import-note.mjs         导入共用：命名、附件查找、图片转码、语法转换
  track.mjs                   内容状态总览（按分类）
  ship.mjs                    提交并推送
  changelog.mjs               CI 用的内容变更追踪
.github/workflows/deploy.yml  构建 → 追踪 → 部署 Pages
```

## 发布链路

`pnpm ship` → push 到 `main` → Actions 构建 → 部署 Pages。

每次运行会把「本次推送新增/更新/删除/发布/转为草稿的内容」写进 Actions 运行摘要，同时打在步骤日志里（表格含「分类」列，区分文章与日记）：

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
