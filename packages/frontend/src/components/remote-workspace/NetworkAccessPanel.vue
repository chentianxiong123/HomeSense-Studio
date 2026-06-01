<script setup lang="ts">
type NetworkAccessSpec = {
  key: string
  title: string
  subtitle: string
  status: string
  endpoint: string
  capabilities: string[]
}

defineProps<{
  specs: NetworkAccessSpec[]
  registered: boolean
  label: (zh: string, en: string) => string
}>()

const emit = defineEmits<{
  refresh: []
  register: []
}>()
</script>

<template>
  <section class="runtime-panel network-access-panel">
    <div class="runtime-head">
      <div>
        <span class="eyebrow inline">{{ label('网络入口', 'Network Access') }}</span>
        <h2>{{ label('公网与内网穿透入口', 'Public and Tunnel Access') }}</h2>
      </div>
      <div class="runtime-actions">
        <button class="secondary-btn" @click="emit('refresh')">
          {{ label('刷新登记', 'Refresh Registry') }}
        </button>
        <button class="primary-btn" @click="emit('register')">
          {{ label('登记外部入口', 'Register Entry') }}
        </button>
      </div>
    </div>
    <div class="network-grid">
      <article v-for="item in specs" :key="item.key" class="network-card">
        <div class="network-card-head">
          <div>
            <span>{{ item.status }}</span>
            <h3>{{ item.title }}</h3>
          </div>
          <strong>{{ item.key }}</strong>
        </div>
        <p>{{ item.subtitle }}</p>
        <code>{{ item.endpoint }}</code>
        <div class="chip-row">
          <span v-for="capability in item.capabilities" :key="capability" class="cap-chip">
            {{ capability }}
          </span>
        </div>
      </article>
    </div>
    <p class="info-line">
      {{
        registered
          ? label('网络入口已在外部能力登记处出现，后续可以接具体穿透适配器。', 'Network access is registered; concrete tunnel adapters can be wired later.')
          : label('这里先放接入位置，不启动任何公网服务；后续按工具逐个接入。', 'This is only the entry position for now; no public service is started until adapters are wired.')
      }}
    </p>
  </section>
</template>
