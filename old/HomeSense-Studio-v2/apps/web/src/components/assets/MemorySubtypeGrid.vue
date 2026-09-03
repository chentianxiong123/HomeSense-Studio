<script setup lang="ts">
type MemorySubtype = {
  key: string
  title: string
  status: string
  count: number | null
  source: string
  description: string
  retrieval: string
}

defineProps<{
  items: MemorySubtype[]
  label: (zh: string, en: string) => string
}>()
</script>

<template>
  <div class="memory-subtypes">
    <article
      v-for="item in items"
      :key="item.key"
      class="memory-subtype-card"
    >
      <div class="memory-subtype-head">
        <span>{{ item.status }}</span>
        <strong>{{ item.count === null ? label('待接入', 'Pending') : item.count }}</strong>
      </div>
      <h3>{{ item.title }}</h3>
      <small>{{ item.source }}</small>
      <p>{{ item.description }}</p>
      <div class="retrieval-line">
        <span>{{ label('召回方式', 'Retrieval') }}</span>
        <p>{{ item.retrieval }}</p>
      </div>
    </article>
  </div>
</template>

<style scoped>
.memory-subtypes {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 14px;
}

.memory-subtype-card {
  min-height: 260px;
  padding: 18px;
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: 8px;
  background: #ffffff;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.memory-subtype-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.memory-subtype-head span {
  width: fit-content;
  padding: 3px 8px;
  border-radius: 6px;
  background: rgba(37, 99, 235, 0.1);
  color: #1d4ed8;
  font-size: 12px;
  font-weight: 900;
}

.memory-subtype-head strong {
  color: #2563eb;
  font-size: 18px;
  font-weight: 950;
}

.memory-subtype-card h3 {
  margin: 0;
  color: var(--text-primary);
  font-size: 17px;
  font-weight: 900;
  line-height: 1.3;
}

.memory-subtype-card small {
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 900;
}

.memory-subtype-card p {
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 700;
  line-height: 1.7;
}

.retrieval-line {
  margin-top: auto;
  padding-top: 12px;
  border-top: 1px solid rgba(226, 232, 240, 0.9);
}

.retrieval-line span {
  display: block;
  margin-bottom: 6px;
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 900;
}

.retrieval-line p {
  font-size: 13px;
}

@media (max-width: 1280px) {
  .memory-subtypes {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .memory-subtypes {
    grid-template-columns: 1fr;
  }
}
</style>
