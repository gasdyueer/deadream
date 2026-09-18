<script setup lang="ts">
import { computed } from 'vue'
import { useData, withBase } from 'vitepress'
import { data as collections, type Post } from '../collections.data'

const { page } = useData()

/** 当前页面若属于某个分类，取出它的元信息 */
const entry = computed<Post | undefined>(() =>
  collections.flatMap((group) => group.posts).find((item) => item.file === page.value.relativePath)
)
</script>

<template>
  <div v-if="entry" class="post-meta-bar">
    <span class="post-meta-item">
      <span class="post-meta-label">{{ entry.collection === 'diary' ? '写于' : '发布于' }}</span>
      <time :datetime="entry.date">{{ entry.date }}</time>
    </span>
    <span v-if="entry.updated !== entry.date" class="post-meta-item">
      <span class="post-meta-label">更新于</span>
      <time :datetime="entry.updated">{{ entry.updated }}</time>
    </span>
    <span class="post-meta-item">{{ entry.words }} 字 · 约 {{ entry.minutes }} 分钟</span>
    <span class="post-meta-item">
      <a class="post-tag" :href="withBase(entry.url.split('/').slice(0, 2).join('/') + '/')">{{ entry.collectionLabel }}</a>
    </span>
    <span v-if="entry.tags.length && entry.collection !== 'diary'" class="post-meta-tags">
      <a v-for="tag in entry.tags" :key="tag" class="post-tag" :href="withBase(`/tags#${encodeURIComponent(tag)}`)">#{{ tag }}</a>
    </span>
  </div>
</template>
