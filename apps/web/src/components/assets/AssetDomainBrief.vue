<script setup lang="ts">
defineProps<{
  role: string
  llmUsage: string
  nextStep: string
  label: (zh: string, en: string) => string
}>()
</script>

<template>
  <div class="asset-domain-brief">
    <article>
      <span>{{ label('定位', 'Role') }}</span>
      <p>{{ role }}</p>
    </article>
    <article>
      <span>{{ label('LLM 如何使用', 'LLM Usage') }}</span>
      <p>{{ llmUsage }}</p>
    </article>
    <article>
      <span>{{ label('下一步', 'Next') }}</span>
      <p>{{ nextStep }}</p>
    </article>
  </div>
</template>

<style scoped>
.asset-domain-brief {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

article {
  min-height: 150px;
  padding: 18px;
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: 8px;
  background: #f8fafc;
}

article span {
  display: block;
  margin-bottom: 12px;
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 900;
}

article p {
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 700;
  line-height: 1.7;
}

@media (max-width: 760px) {
  .asset-domain-brief {
    grid-template-columns: 1fr;
  }
}
</style>
