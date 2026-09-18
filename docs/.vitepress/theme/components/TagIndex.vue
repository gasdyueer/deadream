<script setup lang="ts">
import { computed } from 'vue'
import { withBase } from 'vitepress'
import { data as groups } from '../tags.data'

const total = computed(() => groups.reduce((sum, group) => sum + group.posts.length, 0))
</script>

<template>
  <p v-if="!groups.length" class="post-empty">还没有标签。</p>
  <template v-else>
    <p class="tag-summary">{{ groups.length }} 个标签 · {{ total }} 篇文章</p>
    <div class="tag-cloud">
      <a v-for="group in groups" :key="group.tag" class="post-tag" :href="withBase(`/tags#${encodeURIComponent(group.tag)}`)">
        #{{ group.tag }} <span class="tag-count">{{ group.posts.length }}</span>
      </a>
    </div>
    <section v-for="group in groups" :key="group.tag" class="tag-section">
      <h2 :id="group.tag" class="tag-title">#{{ group.tag }}</h2>
      <ul class="post-list post-list-compact">
        <li v-for="post in group.posts" :key="post.url">
          <time class="post-date" :datetime="post.date">{{ post.date }}</time>
          <a class="post-link" :href="withBase(post.url)">{{ post.title }}</a>
        </li>
      </ul>
    </section>
  </template>
</template>
