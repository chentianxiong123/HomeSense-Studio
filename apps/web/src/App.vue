<script setup lang="ts">
import { RouterView } from 'vue-router'
</script>

<template>
  <div class="app-shell">
    <nav class="sidebar">
      <div class="sidebar-logo">HomeSense</div>
      <router-link to="/accounts" class="nav-item">
        <span class="nav-icon">🔑</span>
        <span class="nav-label">账号中心</span>
      </router-link>
    </nav>
    <main class="main-content">
      <RouterView />
    </main>
  </div>
</template>

<style>
*,
*::before,
*::after {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

:root {
  --bg: #f5f5f7;
  --surface: #fff;
  --text-primary: #1d1d1f;
  --text-secondary: #6e6e73;
  --text-tertiary: #aeaeb2;
  --accent: #10b981;
  --accent-hover: #059669;
  --border: rgba(0, 0, 0, 0.08);
  --radius: 16px;
  --sidebar-w: 220px;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: var(--bg);
  color: var(--text-primary);
  -webkit-font-smoothing: antialiased;
}

#app {
  height: 100vh;
  overflow: hidden;
}

.app-shell {
  display: flex;
  height: 100vh;
}

.sidebar {
  width: var(--sidebar-w);
  flex-shrink: 0;
  background: var(--surface);
  border-right: 1px solid var(--border);
  padding: 24px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sidebar-logo {
  font-size: 20px;
  font-weight: 900;
  letter-spacing: -0.04em;
  color: var(--accent);
  padding: 8px 12px 24px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 12px;
  text-decoration: none;
  color: var(--text-secondary);
  font-weight: 600;
  font-size: 15px;
  transition: all 0.2s;
}

.nav-item:hover,
.nav-item.router-link-active {
  background: rgba(16, 185, 129, 0.08);
  color: var(--accent);
}

.nav-icon {
  font-size: 18px;
}

.main-content {
  flex: 1;
  overflow-y: auto;
  padding: 40px;
}
</style>
