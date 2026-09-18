<script setup lang="ts">
import { computed } from 'vue'
import { useData, withBase } from 'vitepress'
import { data as posts } from '../posts.data'
import { data as diary } from '../diary.data'
import type { Post } from '../posts.data'

const { page } = useData()

/** 当前页面若是一篇文章或日记，取出它的元信息 */
const post = computed<Post | undefined>(() =>
  [...posts, ...diary].find((item) => item.file === page.value.relativePath)
)
</script>

<template>
  <div v-if="post" class="post-meta-bar">
    <span class="post-meta-item">
      <span class="post-meta-label">{{ post.collection === 'diary' ? '写于' : '发布于' }}</span>
      <time :datetime="post.date">{{ post.date }}</time>
    </span>
    <span v-if="post.updated !== post.date" class="post-meta-item">
      <span class="post-meta-label">更新于</span>
      <time :datetime="post.updated">{{ post.updated }}</time>
    </span>
    <span class="post-meta-item">{{ post.words }} 字 · 约 {{ post.minutes }} 分钟</span>
    <span class="post-meta-item">
      <a class="post-tag" :href="withBase(post.collection === 'diary' ? '/diary/' : '/posts/')">{{ post.collectionLabel }}</a>
    </span>
    <span v-if="post.tags.length && post.collection !== 'diary'" class="post-meta-tags">
      <a v-for="tag in post.tags" :key="tag" class="post-tag" :href="withBase(`/tags#${encodeURIComponent(tag)}`)">#{{ tag }}</a>
    </span>
  </div>
</template>
