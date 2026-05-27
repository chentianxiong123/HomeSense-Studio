<script setup lang="ts">
import { computed } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import { useLocale } from './composables/useLocale'

const route = useRoute()
const router = useRouter()
const { locale, setLocale, t } = useLocale()

const navItems = computed(() => [
  { key: 'chat', label: t('app.chat'), route: '/chat' },
  { key: 'studio', label: t('app.studio'), route: '/studio' },
  { key: 'assets', label: locale.value === 'zh' ? '资产' : 'Assets', route: '/assets' },
  { key: 'providers', label: locale.value === 'zh' ? '供应商' : 'Providers', route: '/providers' },
  { key: 'devices', label: locale.value === 'zh' ? '设备' : 'Devices', route: '/devices' },
  { key: 'integrations', label: locale.value === 'zh' ? '集成' : 'Integrations', route: '/integrations' },
])

function isActive(target: string) {
  return route.path === target || route.path.startsWith(`${target}/`)
}
</script>

<template>
  <div class="app-container">
    <header class="app-header">
      <div class="logo">HomeSense Studio</div>
      <nav class="tab-nav">
        <button
          v-for="item in navItems"
          :key="item.key"
          :class="['tab-btn', { active: isActive(item.route) }]"
          @click="router.push(item.route)"
        >
          {{ item.label }}
        </button>
      </nav>
      <div class="header-actions">
        <div class="locale-switch" :title="t('app.language')">
          <button :class="['locale-btn', { active: locale === 'zh' }]" @click="setLocale('zh')">中</button>
          <button :class="['locale-btn', { active: locale === 'en' }]" @click="setLocale('en')">EN</button>
        </div>
        <button class="settings-btn" @click="router.push('/settings')">{{ t('app.settings') }}</button>
      </div>
    </header>
    <main class="app-main">
      <RouterView />
    </main>
  </div>
</template>

<style>
:root {
  --primary-color: #10a37f;
  --primary-hover: #0e906f;
  --bg-color: #f7f9fa;
  --surface-color: #ffffff;
  --border-color: #e5e7eb;
  --text-primary: #1e293b;
  --text-secondary: #64748b;
  --text-tertiary: #94a3b8;
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 16px;
  --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
  --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
  --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body, #app {
  height: 100%;
  font-family: var(--font-sans);
  background-color: var(--bg-color);
  color: var(--text-primary);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.app-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.app-header {
  display: flex;
  align-items: center;
  height: 80px;
  padding: 0 48px;
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(48px);
  border-bottom: 1px solid rgba(229, 231, 235, 0.4);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.02);
  z-index: 100;
}

.logo {
  font-size: 15px;
  font-weight: 900;
  margin-right: 80px;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 16px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
}

.logo::before {
  content: '';
  display: inline-block;
  width: 40px;
  height: 40px;
  background: #10b981;
  border-radius: 12px;
  box-shadow: 0 8px 20px rgba(16, 185, 129, 0.2);
  mask: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>') center / 22px no-repeat;
  -webkit-mask: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>') center / 22px no-repeat;
}

.tab-nav {
  display: flex;
  gap: 12px;
}

.tab-btn {
  position: relative;
  padding: 0 28px;
  height: 48px;
  border: none;
  border-radius: 14px;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 16px;
  font-weight: 900;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.tab-btn:hover {
  color: var(--text-primary);
  background: rgba(0, 0, 0, 0.04);
}

.tab-btn.active {
  color: #10b981;
  background: rgba(16, 185, 129, 0.1);
  box-shadow: 0 4px 16px rgba(16, 185, 129, 0.1);
}

.tab-btn.active::after {
  content: '';
  position: absolute;
  bottom: 6px;
  left: 28px;
  right: 28px;
  height: 3px;
  background: linear-gradient(90deg, #10b981, #34d399);
  border-radius: 3px;
  box-shadow: 0 0 12px rgba(16, 185, 129, 0.4);
}

.header-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 32px;
}

.locale-switch {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 6px;
  border-radius: 14px;
  background: rgba(0, 0, 0, 0.05);
}

.locale-btn {
  min-width: 48px;
  height: 32px;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 15px;
  font-weight: 900;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  text-transform: uppercase;
}

.locale-btn:hover:not(.active) {
  color: var(--text-primary);
}

.locale-btn.active {
  background: #fff;
  color: #10b981;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.settings-btn {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 24px;
  height: 48px;
  border: 1px solid rgba(229, 231, 235, 0.8);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.8);
  color: var(--text-primary);
  cursor: pointer;
  font-size: 16px;
  font-weight: 900;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.02);
}

.settings-btn:hover {
  border-color: #10b981;
  color: #10b981;
  transform: translateY(-2px);
  background: #fff;
  box-shadow: 0 12px 28px rgba(16, 185, 129, 0.12);
}


.settings-btn::before {
  content: '';
  display: inline-block;
  width: 16px;
  height: 16px;
  background-color: currentColor;
  mask: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>') center / contain no-repeat;
  -webkit-mask: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>') center / contain no-repeat;
}

.app-main {
  flex: 1;
  overflow: hidden;
  position: relative;
}

/* Base styles for modern scrollbars */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: var(--border-color);
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background: var(--text-tertiary);
}
</style>
