#!/usr/bin/env node
/**
 * 把站点里过大的图片重新压小 —— 主要针对动图。
 *
 *   node scripts/shrink-images.mjs --dry-run     # 只看能省多少，不写盘
 *   node scripts/shrink-images.mjs               # 就地替换，文件名与格式不变
 *
 * 为什么需要它：静图由导入管线压到最长边 1920 / q82，动图压到 800 / q75
 * （scripts/lib/import-note.mjs），但手工塞进 docs/public/images 的截屏动图不过这条路，
 * 单张能到 8MB。这里按同样口径再过一遍：动图保住帧数与循环次数，只降质量。
 *
 * 两条保护：
 *   1. 只碰 >= --min（默认 512KB）的文件；
 *   2. 重压后必须比原来小至少 10%（--force 可放开）才替换，所以同一套参数重复运行
 *      不会把已经压过的图反复压。
 * 静态图不动：它们已经是管线的产物，再压没有收益（实测超 256KB 的静图总共才 4.9MB）。
 */
import { copyFileSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const argv = process.argv.slice(2).flatMap((arg) =>
  arg.startsWith('--') && arg.includes('=')
    ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)]
    : [arg]
)

const options = {
  min: 512,
  quality: 60,
  effort: 4,
  width: 0,
  gain: 0.9,
  force: false,
  dryRun: false,
  dirs: [],
}
for (let index = 0; index < argv.length; index++) {
  const value = () => argv[++index] ?? ''
  switch (argv[index]) {
    case '--min':
      options.min = Number(value())
      break
    case '--quality':
      options.quality = Number(value())
      break
    case '--effort':
      options.effort = Number(value())
      break
    case '--width':
      options.width = Number(value())
      break
    case '--force':
      options.force = true
      break
    case '--dry-run':
      options.dryRun = true
      break
    case '-h':
    case '--help':
      console.log(`用法：node scripts/shrink-images.mjs [目录...] [选项]

  --min <KB>      只处理大于该体积的文件（默认 512）
  --quality <n>   动图重压质量（默认 60，导入管线是 75）
  --effort <n>    压缩力度 0-6（默认 4，越大越慢越小）
  --width <n>     同时限制宽度，0 表示不改（默认 0）
  --force         跳过「必须小 10%」的保护，强制替换
  --dry-run       只算不写`)
      process.exit(0)
      break
    default:
      if (!argv[index].startsWith('--')) options.dirs.push(argv[index])
  }
}

const dirs = options.dirs.length ? options.dirs : ['docs/public/images']

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(full) : [full]
  })
}

const files = dirs.flatMap((dir) => walk(dir)).sort()
const minBytes = options.min * 1024
const mb = (bytes) => `${(bytes / 1048576).toFixed(2)}MB`

const shrunk = []
const skipped = { small: 0, static: 0, noGain: 0 }
let before = 0
let after = 0

for (const file of files) {
  const size = statSync(file).size
  if (size < minBytes) {
    skipped.small++
    continue
  }

  // 先把源文件读进内存再交给 sharp：libvips 是惰性读的，直接按路径读会留着句柄，
  // Windows 下随后替换同名文件就会 EPERM / UNKNOWN
  const input = readFileSync(file)

  let meta
  try {
    meta = await sharp(input, { animated: true, limitInputPixels: false }).metadata()
  } catch (error) {
    console.warn(`跳过（读不了）：${file} — ${error.message}`)
    continue
  }
  if ((meta.pages ?? 1) <= 1) {
    skipped.static++
    continue
  }

  const temp = `${file}.shrink.webp`
  let pipeline = sharp(input, { animated: true, limitInputPixels: false })
  if (options.width) {
    pipeline = pipeline.resize({ width: options.width, withoutEnlargement: true })
  }
  await pipeline
    .webp({ quality: options.quality, effort: options.effort, loop: meta.loop ?? 0 })
    .toFile(temp)

  const next = statSync(temp).size
  const keep = options.force ? next < size : next <= size * options.gain
  if (keep) {
    if (options.dryRun) rmSync(temp, { force: true })
    else {
      try {
        renameSync(temp, file)
      } catch {
        // 目标文件被占用时 rename 会失败，退化成覆盖写 + 删临时文件
        copyFileSync(temp, file)
        rmSync(temp, { force: true })
      }
    }
    before += size
    after += next
    shrunk.push({ file, size, next, frames: meta.pages })
  } else {
    rmSync(temp, { force: true })
    skipped.noGain++
    shrunk.push({ file, size, next, frames: meta.pages, kept: true })
  }
}

for (const row of shrunk) {
  const delta = row.kept ? '保留原图' : `-${(100 - (row.next / row.size) * 100).toFixed(0)}%`
  console.log(`${mb(row.size).padStart(8)} → ${mb(row.next).padStart(8)}  ${delta.padEnd(9)} ${row.frames} 帧  ${path.relative('.', row.file)}`)
}

console.log(`
图片瘦身${options.dryRun ? '（dry-run，未写入）' : '完成'}
  替换        ${shrunk.filter((row) => !row.kept).length} 个，${mb(before)} → ${mb(after)}
  未达标      ${skipped.noGain} 个（压不小 ${(100 - options.gain * 100).toFixed(0)}% 以上）
  静态跳过    ${skipped.static} 个
  体积不足    ${skipped.small} 个（< ${options.min}KB）
`)
