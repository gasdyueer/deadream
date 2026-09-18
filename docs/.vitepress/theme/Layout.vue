<script setup lang="ts">
import DefaultTheme from 'vitepress/theme'
import PostMeta from './components/PostMeta.vue'

const { Layout: DefaultLayout } = DefaultTheme
</script>

<template>
  <DefaultLayout>
    <template #doc-before>
      <PostMeta />
    </template>
  </DefaultLayout>
</template>
