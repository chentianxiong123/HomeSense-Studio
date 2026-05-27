<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useLocale } from '@/composables/useLocale'
import { computed } from 'vue'

const router = useRouter()
const { locale } = useLocale()
const isZh = computed(() => locale.value === 'zh')

type CliId = 'mi-cli' | 'adb-cli'

function label(zh: string, en: string) {
  return isZh.value ? zh : en
}

const cards: { id: CliId; name: string; subtitle: string; icon: string; route: string }[] = [
  { id: 'mi-cli', name: 'mi-cli', subtitle: '米家扫码登录与认证', icon: '🔑', route: '/integrations/mi-cli' },
  { id: 'adb-cli', name: 'adb-cli', subtitle: 'Android ADB 电视调试', icon: '📺', route: '/integrations/adb-cli' },
]

function goTo(route: string) {
  router.push(route)
}
</script>

<template>
  <div class="integrations-page">
    <header class="page-head glass-panel">
      <div class="header-main">
        <span class="eyebrow">{{ label('CLI 集成', 'CLI Integrations') }}</span>
        <h1>{{ label('CLI 管理', 'CLI Management') }}</h1>
        <p>{{ label('扫码登录和 ADB 调试面板。', 'QR login and ADB debug panel.') }}</p>
      </div>
    </header>

    <section class="card-grid">
      <button
        v-for="card in cards"
        :key="card.id"
        class="cli-card glass-card"
        @click="goTo(card.route)"
      >
        <span class="cli-icon">{{ card.icon }}</span>
        <strong class="cli-name">{{ card.name }}</strong>
        <span class="cli-subtitle">{{ card.subtitle }}</span>
        <span class="expand-hint">→</span>
      </button>
    </section>
  </div>
</template>

<style scoped>
.integrations-page {
  height: 100%;
  overflow-y: auto;
  padding: 40px;
  background: #f7f9fa;
  display: flex;
  flex-direction: column;
  gap: 40px;
}

.glass-panel {
  border: 1px solid rgba(229, 231, 235, 0.4);
  border-radius: 32px;
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(48px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.02);
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.glass-panel:hover {
  background: rgba(255, 255, 255, 0.7);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.05);
}

.glass-card {
  border: 1px solid rgba(229, 231, 235, 0.4);
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.4);
  backdrop-filter: blur(16px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.02);
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.page-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 32px;
  padding: 48px;
}

.eyebrow {
  display: inline-block;
  color: #10b981;
  font-size: 13px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  background: rgba(16, 185, 129, 0.1);
  padding: 4px 12px;
  border-radius: 8px;
  margin-bottom: 20px;
}

h1 {
  margin: 0;
  font-size: 40px;
  font-weight: 900;
  letter-spacing: -0.05em;
  color: var(--text-primary);
  line-height: 1.1;
}

.page-head p {
  margin-top: 16px;
  color: var(--text-secondary);
  font-size: 17px;
  line-height: 1.7;
  font-weight: 600;
  max-width: 800px;
  letter-spacing: -0.01em;
}

.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 24px;
}

.cli-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 40px 32px;
  text-align: center;
  cursor: pointer;
  border: 1px solid rgba(229, 231, 235, 0.4);
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.4);
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.cli-card:hover {
  background: rgba(255, 255, 255, 0.85);
  transform: translateY(-6px);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.08);
}

.cli-icon {
  font-size: 40px;
}

.cli-name {
  font-size: 22px;
  font-weight: 900;
  color: var(--text-primary);
  letter-spacing: -0.03em;
}

.cli-subtitle {
  font-size: 15px;
  color: var(--text-tertiary);
  font-weight: 700;
  line-height: 1.6;
}

.expand-hint {
  font-size: 18px;
  color: #10b981;
  font-weight: 900;
  margin-top: 4px;
}
</style>