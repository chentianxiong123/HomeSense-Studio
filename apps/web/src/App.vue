<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import { useLocale } from './composables/useLocale'

const route = useRoute()
const router = useRouter()
const { locale, setLocale, t } = useLocale()

const menuOpen = ref(false)

const navItems = computed(() => [
  { key: 'chat', label: t('app.chat'), route: '/chat' },
  { key: 'studio', label: t('app.studio'), route: '/studio' },
  { key: 'workspace', label: locale.value === 'zh' ? '远程' : 'Remote', route: '/workspace' },
  { key: 'assets', label: locale.value === 'zh' ? '资产' : 'Assets', route: '/assets' },
  { key: 'providers', label: locale.value === 'zh' ? '供应商' : 'Providers', route: '/providers' },
  { key: 'devices', label: locale.value === 'zh' ? '设备' : 'Devices', route: '/devices' },
  { key: 'authorizations', label: locale.value === 'zh' ? '授权' : 'Auth', route: '/authorizations' },
])

function isActive(target: string) {
  return route.path === target || route.path.startsWith(`${target}/`)
}

function navigateTo(target: string) {
  router.push(target)
  menuOpen.value = false // Auto close menu on nav
}
</script>

<template>
  <div class="app-container">
    <header class="app-header">
      <!-- Hamburger Menu Button for Mobile -->
      <button class="menu-toggle-btn" @click="menuOpen = !menuOpen" :aria-label="menuOpen ? 'Close Menu' : 'Open Menu'">
        <svg v-if="!menuOpen" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
        <svg v-else viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>

      <div class="logo" @click="navigateTo('/chat')" style="cursor: pointer;">HomeSense</div>

      <!-- Desktop Horizontal Navigation -->
      <nav class="tab-nav">
        <button
          v-for="item in navItems"
          :key="item.key"
          :class="['tab-btn', { active: isActive(item.route) }]"
          @click="navigateTo(item.route)"
        >
          {{ item.label }}
        </button>
      </nav>

      <div class="header-actions">
        <div class="locale-switch" :title="t('app.language')">
          <button :class="['locale-btn', { active: locale === 'zh' }]" @click="setLocale('zh')">中</button>
          <button :class="['locale-btn', { active: locale === 'en' }]" @click="setLocale('en')">EN</button>
        </div>
      </div>
    </header>

    <!-- Mobile Slide-out Drawer Navigation -->
    <Teleport to="body">
      <div v-if="menuOpen" class="mobile-drawer-overlay" @click="menuOpen = false">
        <nav class="mobile-drawer" @click.stop>
          <div class="drawer-header">
            <strong>HomeSense Menu</strong>
            <button class="drawer-close" @click="menuOpen = false">×</button>
          </div>
          <ul class="drawer-menu">
            <li v-for="item in navItems" :key="item.key">
              <button
                :class="['drawer-item-btn', { active: isActive(item.route) }]"
                @click="navigateTo(item.route)"
              >
                {{ item.label }}
              </button>
            </li>
          </ul>
        </nav>
      </div>
    </Teleport>

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
  --app-header-height: 80px;
  --app-safe-top: env(safe-area-inset-top, 0px);
  --app-safe-right: env(safe-area-inset-right, 0px);
  --app-safe-bottom: env(safe-area-inset-bottom, 0px);
  --app-safe-left: env(safe-area-inset-left, 0px);
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body, #app {
  height: 100%;
  min-width: 320px;
  font-family: var(--font-sans);
  background-color: var(--bg-color);
  color: var(--text-primary);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.app-container {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  height: 100dvh;
  overflow: hidden;
}

.app-header {
  display: flex;
  align-items: center;
  min-height: calc(var(--app-header-height) + var(--app-safe-top));
  padding: var(--app-safe-top) calc(48px + var(--app-safe-right)) 0 calc(48px + var(--app-safe-left));
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(48px);
  border-bottom: 1px solid rgba(229, 231, 235, 0.4);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.02);
  z-index: 100;
  gap: 16px;
}

.logo {
  font-size: 15px;
  font-weight: 900;
  margin-right: 48px;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 12px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
}

.logo::before {
  content: '';
  display: inline-block;
  width: 32px;
  height: 32px;
  background: #10b981;
  border-radius: 10px;
  box-shadow: 0 4px 12px rgba(16, 185, 129, 0.2);
  mask: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>') center / 18px no-repeat;
  -webkit-mask: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>') center / 18px no-repeat;
}

.menu-toggle-btn {
  display: none;
}

.tab-nav {
  display: flex;
  gap: 12px;
  min-width: 0;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  scrollbar-width: none;
}

.tab-nav::-webkit-scrollbar {
  display: none;
}

.tab-btn {
  position: relative;
  padding: 0 20px;
  height: 44px;
  border: none;
  border-radius: 12px;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 15px;
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
  bottom: 4px;
  left: 20px;
  right: 20px;
  height: 3px;
  background: linear-gradient(90deg, #10b981, #34d399);
  border-radius: 3px;
}

.header-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
}

.locale-switch {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.05);
}

.locale-btn {
  min-width: 40px;
  height: 28px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 13px;
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

.app-main {
  flex: 1;
  min-height: 0;
  overflow: auto;
  position: relative;
  -webkit-overflow-scrolling: touch;
}

/* Slide Drawer Styles */
.mobile-drawer-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.3);
  z-index: 1000;
  backdrop-filter: blur(4px);
  animation: fadeIn 0.2s ease;
}

.mobile-drawer {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  width: 280px;
  background: #fff;
  box-shadow: 24px 0 70px rgba(15, 23, 42, 0.15);
  display: flex;
  flex-direction: column;
  padding: 24px;
  animation: slideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.drawer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid rgba(229, 231, 235, 0.5);
  padding-bottom: 16px;
  margin-bottom: 24px;
}

.drawer-header strong {
  font-size: 16px;
  font-weight: 900;
  color: var(--text-primary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.drawer-close {
  background: transparent;
  border: 0;
  font-size: 28px;
  color: var(--text-tertiary);
  cursor: pointer;
  line-height: 1;
}

.drawer-menu {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.drawer-item-btn {
  width: 100%;
  height: 48px;
  padding: 0 16px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 15px;
  font-weight: 800;
  text-align: left;
  cursor: pointer;
  transition: all 0.2s;
}

.drawer-item-btn:hover {
  background: rgba(0, 0, 0, 0.03);
  color: var(--text-primary);
}

.drawer-item-btn.active {
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
}

@keyframes slideIn {
  from { transform: translateX(-100%); }
  to { transform: translateX(0); }
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@media (max-width: 1024px) {
  .app-header {
    padding-right: calc(24px + var(--app-safe-right));
    padding-left: calc(24px + var(--app-safe-left));
  }

  .logo {
    margin-right: 28px;
  }
}

@media (max-width: 820px) {
  :root {
    --app-header-height: 64px;
  }

  .menu-toggle-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    background: transparent;
    border: 0;
    color: var(--text-secondary);
    cursor: pointer;
    border-radius: 10px;
  }

  .menu-toggle-btn:hover {
    background: rgba(0,0,0,0.04);
  }

  .tab-nav {
    display: none;
  }

  .logo {
    margin-right: 0;
  }
}
</style>
