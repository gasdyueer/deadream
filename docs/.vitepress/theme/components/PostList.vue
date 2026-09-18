<script setup lang="ts">
import { computed } from 'vue'
import { withBase } from 'vitepress'
import { data as collections, type CollectionName, type Post } from '../collections.data'

const props = withDefaults(
  defineProps<{
    /** 分类：文章 / 日记 / 做片笔记 */
    collection?: CollectionName
    /** 最多显示几篇，0 表示全部 */
    limit?: number
    /** 只显示包含该标签的内容 */
    tag?: string
    /** 排序依据：发布日期或最后更新日期 */
    sort?: 'date' | 'updated'
    /** 按年份分组（归档视图） */
    groupByYear?: boolean
    /** 是否显示摘要与标签 */
    detailed?: boolean
    /** 隐藏日期列（日记标题里已含日期） */
    hideDate?: boolean
  }>(),
  { collection: 'post', limit: 0, tag: '', sort: 'date', groupByYear: false, detailed: true, hideDate: false }
)

const source = computed<Post[]>(() => collections.find((item) => item.name === props.collection)?.posts ?? [])

const visible = computed<Post[]>(() => {
  const key = props.sort === 'updated' ? 'updated' : 'date'
  const list = props.tag ? source.value.filter((post) => post.tags.includes(props.tag as string)) : [...source.value]
  list.sort((a, b) => (b[key] || b.date).localeCompare(a[key] || a.date) || a.title.localeCompare(b.title))
  return props.limit > 0 ? list.slice(0, props.limit) : list
})

const groups = computed(() => {
  const buckets = new Map<string, Post[]>()
  for (const post of visible.value) {
    const year = post.date.slice(0, 4) || '未标日期'
    const bucket = buckets.get(year)
    if (bucket) bucket.push(post)
    else buckets.set(year, [post])
  }
  return [...buckets.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([year, items]) => ({ year, items }))
})
</script>

<template>
  <p v-if="!visible.length" class="post-empty">暂无内容。</p>

  <template v-else-if="groupByYear">
    <section v-for="group in groups" :key="group.year" class="post-group">
      <h2 :id="`year-${group.year}`" class="post-group-title">
        {{ group.year }}
        <span class="post-group-count">{{ group.items.length }}</span>
      </h2>
      <ul class="post-list post-list-compact">
        <li v-for="post in group.items" :key="post.url">
          <time v-if="!hideDate" class="post-date" :datetime="post.date">{{ post.date.slice(5) }}</time>
          <a class="post-link" :href="withBase(post.url)">{{ post.title }}</a>
          <span v-if="post.updated !== post.date" class="post-updated">更新 {{ post.updated }}</span>
          <span class="post-tags">
            <a
              v-for="tag in post.collection === 'diary' ? [] : post.tags"
              :key="tag"
              class="post-tag"
              :href="withBase(`/tags#${encodeURIComponent(tag)}`)"
              >#{{ tag }}</a
            >
          </span>
        </li>
      </ul>
    </section>
  </template>

  <ul v-else class="post-list" :class="{ 'post-list-detailed': detailed }">
    <li v-for="post in visible" :key="post.url">
      <a class="post-link" :href="withBase(post.url)">{{ post.title }}</a>
      <p v-if="detailed" class="post-desc">{{ post.description }}</p>
      <p v-if="detailed" class="post-meta-line">
        <time v-if="!hideDate" :datetime="post.date">{{ post.date }}</time>
        <span v-if="post.updated !== post.date">· 更新 {{ post.updated }}</span>
        <span>· {{ post.minutes }} 分钟</span>
        <template v-if="post.collection !== 'diary'">
          <a v-for="tag in post.tags" :key="tag" class="post-tag" :href="withBase(`/tags#${encodeURIComponent(tag)}`)">#{{ tag }}</a>
        </template>
      </p>
    </li>
  </ul>
</template>
