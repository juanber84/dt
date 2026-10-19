<script setup>
import { computed } from 'vue';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

/** Markdown del coach, saneado (lo escribe un modelo: nada de HTML suyo sin limpiar). */
const props = defineProps({ source: { type: String, default: '' } });

const html = computed(() =>
  DOMPurify.sanitize(marked.parse(props.source, { gfm: true, breaks: true, async: false })),
);
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -->
  <div class="markdown" v-html="html" />
</template>

<style scoped>
.markdown {
  line-height: 1.55;
  overflow-wrap: anywhere;
}

.markdown :deep(> :first-child) {
  margin-top: 0;
}

.markdown :deep(> :last-child) {
  margin-bottom: 0;
}

.markdown :deep(p),
.markdown :deep(ul),
.markdown :deep(ol),
.markdown :deep(table),
.markdown :deep(pre),
.markdown :deep(blockquote) {
  margin: 0 0 10px;
}

.markdown :deep(ul),
.markdown :deep(ol) {
  padding-left: 20px;
}

.markdown :deep(li + li) {
  margin-top: 3px;
}

.markdown :deep(h1),
.markdown :deep(h2),
.markdown :deep(h3),
.markdown :deep(h4) {
  margin: 14px 0 6px;
  font-size: 14px;
  font-weight: 650;
}

.markdown :deep(strong) {
  font-weight: 650;
}

.markdown :deep(code) {
  font-family: var(--mono);
  font-size: 12px;
  padding: 1px 5px;
  border-radius: 5px;
  background: var(--surface-2);
}

.markdown :deep(pre) {
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  overflow-x: auto;
}

.markdown :deep(pre code) {
  padding: 0;
  background: none;
}

.markdown :deep(table) {
  display: block;
  max-width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.markdown :deep(th),
.markdown :deep(td) {
  padding: 5px 10px;
  border-bottom: 1px solid var(--grid);
  text-align: left;
}

.markdown :deep(th) {
  font-weight: 600;
  color: var(--text-2);
}

.markdown :deep(blockquote) {
  padding-left: 12px;
  border-left: 3px solid var(--border-strong);
  color: var(--text-2);
}

.markdown :deep(a) {
  text-decoration: underline;
}
</style>
