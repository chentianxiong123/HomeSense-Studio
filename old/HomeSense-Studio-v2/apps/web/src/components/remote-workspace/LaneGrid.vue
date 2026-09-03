<script setup lang="ts">
import type { ExternalIntegrationRecord } from '@/api/externalIntegrations'

type Lane = {
  key: string
  integrationName: string
  title: string
  subtitle: string
  role: string
  marker: string
  accent: string
  references: string[]
  fallbackCapabilities: string[]
  primary?: boolean
  integration?: ExternalIntegrationRecord
}

defineProps<{
  lanes: Lane[]
  error: string
  label: (zh: string, en: string) => string
  statusLabel: (record?: ExternalIntegrationRecord) => string
  statusClass: (record?: ExternalIntegrationRecord) => string
  endpointText: (record?: ExternalIntegrationRecord) => string
  canOpenEndpoint: (record?: ExternalIntegrationRecord) => boolean
  capabilityIds: (lane: Lane) => string[]
  formatAuth: (record?: ExternalIntegrationRecord) => string
}>()

const emit = defineEmits<{
  openEndpoint: [record?: ExternalIntegrationRecord]
}>()
</script>

<template>
  <p v-if="error" class="error-line">{{ error }}</p>

  <section class="lane-grid">
    <article
      v-for="lane in lanes"
      :key="lane.key"
      :class="['lane-card', { primary: lane.primary }]"
      :style="{ '--accent': lane.accent }"
    >
      <div class="lane-top">
        <span class="lane-marker">{{ lane.marker }}</span>
        <span :class="['status-chip', statusClass(lane.integration)]">
          {{ statusLabel(lane.integration) }}
        </span>
      </div>
      <h2>{{ lane.title }}</h2>
      <p class="lane-subtitle">{{ lane.subtitle }}</p>
      <p class="lane-role">{{ lane.role }}</p>

      <div class="endpoint-box">
        <span>{{ label('端点', 'Endpoint') }}</span>
        <strong>{{ endpointText(lane.integration) }}</strong>
        <button
          v-if="canOpenEndpoint(lane.integration)"
          class="open-link-btn"
          @click="emit('openEndpoint', lane.integration)"
        >
          {{ label('打开', 'Open') }}
        </button>
      </div>

      <div class="lane-block">
        <span class="block-title">{{ label('能力', 'Capabilities') }}</span>
        <div class="chip-row">
          <span v-for="capability in capabilityIds(lane).slice(0, 6)" :key="capability" class="cap-chip">
            {{ capability }}
          </span>
        </div>
      </div>

      <div class="lane-block">
        <span class="block-title">{{ label('参考', 'References') }}</span>
        <div class="chip-row">
          <span v-for="reference in lane.references" :key="reference" class="ref-chip">{{ reference }}</span>
        </div>
      </div>

      <div class="auth-line">{{ formatAuth(lane.integration) }}</div>
    </article>
  </section>
</template>
