<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import type { StudioDetailTab } from '@/features/studio/detailNavigation'

withDefaults(defineProps<{
  title: string
  description?: string
  backLabel: string
  backRoute?: string
  tabs?: StudioDetailTab[]
  loading?: boolean
  loadingLabel?: string
}>(), {
  description: '',
  backRoute: '/studio',
  tabs: () => [],
  loading: false,
  loadingLabel: 'Loading…',
})

const route = useRoute()
const router = useRouter()
</script>

<template>
  <div class="studio-detail-shell">
    <header class="detail-header glass-panel">
      <div class="detail-head-main">
        <button class="back-btn" @click="router.push(backRoute)">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
          {{ backLabel }}
        </button>
        <div class="detail-copy">
          <span class="eyebrow" v-if="tabs.length > 0">{{ tabs.find(t => t.route === route.path)?.label || 'Overview' }}</span>
          <h2>{{ title }}</h2>
          <p v-if="description">{{ description }}</p>
        </div>
      </div>
      <slot name="header-actions" />
    </header>

    <nav v-if="tabs.length > 0" class="detail-tabs glass-panel">
      <button
        v-for="tab in tabs"
        :key="tab.route"
        :class="['tab-btn', { active: route.path === tab.route }]"
        @click="router.push(tab.route)"
      >
        {{ tab.label }}
      </button>
    </nav>

    <section v-if="loading" class="detail-loading glass-panel">
      <div class="loading-content">
        <div class="spinner"></div>
        <span>{{ loadingLabel }}</span>
      </div>
    </section>
    <section v-else class="detail-body">
      <slot />
    </section>
  </div>
</template>

<style scoped>
.studio-detail-shell {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 48px;
  gap: 40px;
  background: #f7f9fa;
  overflow-y: auto;
}

.glass-panel {
  border: 1px solid rgba(229, 231, 235, 0.4);
  border-radius: 40px;
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(48px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.02);
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.detail-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 32px;
  padding: 56px 64px;
}

.detail-header:hover {
  background: rgba(255, 255, 255, 0.7);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.05);
  transform: translateY(-2px);
}

.detail-head-main {
  display: flex;
  flex-direction: column;
  gap: 32px;
  min-width: 0;
}

.eyebrow {
  display: inline-block;
  color: #10b981;
  font-size: 14px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  background: rgba(16, 185, 129, 0.1);
  padding: 6px 16px;
  border-radius: 10px;
  margin-bottom: 24px;
}

.detail-copy h2 {
  margin: 0;
  font-size: 48px;
  font-weight: 900;
  color: var(--text-primary);
  letter-spacing: -0.06em;
  line-height: 1;
  background: linear-gradient(135deg, #1e293b 0%, #64748b 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.detail-copy p {
  margin: 20px 0 0;
  color: var(--text-secondary);
  font-size: 18px;
  line-height: 1.7;
  font-weight: 700;
  opacity: 0.8;
  letter-spacing: -0.015em;
  max-width: 900px;
}

.back-btn {
  height: 44px;
  padding: 0 24px;
  border: 1px solid rgba(229, 231, 235, 0.8);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.8);
  color: #10b981;
  font-size: 14px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  cursor: pointer;
  align-self: flex-start;
  display: flex;
  align-items: center;
  gap: 12px;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 2px 6px rgba(0,0,0,0.02);
}

.back-btn:hover {
  background: #fff;
  border-color: #10b981;
  transform: translateX(-8px);
  box-shadow: 0 12px 32px rgba(16, 185, 129, 0.15);
}

.detail-tabs {
  display: flex;
  gap: 12px;
  padding: 10px;
  border-radius: 24px;
  width: fit-content;
}

.tab-btn {
  height: 48px;
  padding: 0 28px;
  border: 1px solid transparent;
  border-radius: 16px;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 16px;
  font-weight: 900;
  cursor: pointer;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.tab-btn:hover {
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.6);
}

.tab-btn.active {
  background: #fff;
  color: #10b981;
  border-color: rgba(16, 185, 129, 0.2);
  box-shadow: 0 12px 32px rgba(16, 185, 129, 0.12);
}

.detail-loading,
.detail-body {
  flex: 1;
  min-height: 0;
}

.detail-loading {
  display: flex;
  align-items: center;
  justify-content: center;
}

.loading-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
}

.spinner {
  width: 32px;
  height: 32px;
  border: 4px solid rgba(16, 185, 129, 0.1);
  border-top-color: #10b981;
  border-radius: 50%;
  animation: spin 1s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.detail-loading span {
  color: var(--text-tertiary);
  font-weight: 900;
  font-size: 15px;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  opacity: 0.5;
}

</style>
