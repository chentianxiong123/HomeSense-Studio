<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { api, type ConnectedService } from '@/api'

const services = ref<ConnectedService[]>([])
const loading = ref(true)

onMounted(async () => {
  try {
    services.value = await api.connectedServices()
  } finally {
    loading.value = false
  }
})

async function handleLogin(serviceId: string) {
  // TODO: 实际登录流程
  alert(`登录 ${serviceId} — 后续实现`)
}

async function handleLogout(serviceId: string) {
  // TODO: 实际登出流程
  alert(`登出 ${serviceId} — 后续实现`)
}
</script>

<template>
  <div class="account-page">
    <header class="page-header">
      <h1>账号中心</h1>
      <p>管理已连接的外部服务</p>
    </header>

    <div v-if="loading" class="loading">加载中...</div>

    <div v-else class="service-grid">
      <div
        v-for="svc in services"
        :key="svc.id"
        class="service-card"
        :class="{ connected: svc.connected }"
      >
        <div class="card-top">
          <span class="service-icon">{{ svc.icon }}</span>
          <span class="status-badge" :class="svc.connected ? 'online' : 'offline'">
            {{ svc.connected ? '已连接' : '未连接' }}
          </span>
        </div>

        <h3>{{ svc.name }}</h3>
        <p class="service-desc">{{ svc.description }}</p>

        <div v-if="svc.connected && svc.meta" class="meta-row">
          <span v-for="(val, key) in svc.meta" :key="key" class="meta-chip">
            {{ key }}: {{ val }}
          </span>
        </div>

        <div class="card-actions">
          <button
            v-if="!svc.connected"
            class="btn btn-primary"
            @click="handleLogin(svc.id)"
          >
            连接
          </button>
          <template v-else>
            <button class="btn btn-secondary" @click="handleLogin(svc.id)">
              重新登录
            </button>
            <button class="btn btn-danger" @click="handleLogout(svc.id)">
              断开
            </button>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.account-page {
  max-width: 800px;
}

.page-header {
  margin-bottom: 40px;
}

.page-header h1 {
  font-size: 32px;
  font-weight: 900;
  letter-spacing: -0.04em;
}

.page-header p {
  margin-top: 8px;
  color: var(--text-secondary);
  font-size: 16px;
}

.loading {
  color: var(--text-tertiary);
  font-size: 16px;
  padding: 80px 0;
  text-align: center;
}

.service-grid {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.service-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 28px 32px;
  transition: all 0.3s;
}

.service-card:hover {
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.06);
  transform: translateY(-2px);
}

.service-card.connected {
  border-color: rgba(16, 185, 129, 0.2);
}

.card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.service-icon {
  font-size: 32px;
}

.status-badge {
  padding: 4px 14px;
  border-radius: 99px;
  font-size: 13px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.status-badge.online {
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
}

.status-badge.offline {
  background: rgba(0, 0, 0, 0.05);
  color: var(--text-tertiary);
}

.service-card h3 {
  font-size: 20px;
  font-weight: 800;
  letter-spacing: -0.02em;
  margin-bottom: 6px;
}

.service-desc {
  color: var(--text-secondary);
  font-size: 14px;
  margin-bottom: 16px;
}

.meta-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 20px;
}

.meta-chip {
  padding: 4px 12px;
  background: rgba(0, 0, 0, 0.04);
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
}

.card-actions {
  display: flex;
  gap: 10px;
}

.btn {
  padding: 10px 24px;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  border: 1px solid var(--border);
  transition: all 0.2s;
}

.btn-primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.btn-primary:hover {
  background: var(--accent-hover);
}

.btn-secondary {
  background: var(--surface);
  color: var(--text-primary);
}

.btn-secondary:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.btn-danger {
  background: transparent;
  color: #ef4444;
  border-color: rgba(239, 68, 68, 0.2);
}

.btn-danger:hover {
  background: rgba(239, 68, 68, 0.08);
}
</style>
