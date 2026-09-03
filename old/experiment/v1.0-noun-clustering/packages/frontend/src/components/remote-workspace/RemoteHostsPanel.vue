<script setup lang="ts">
import type { RemoteWorkspaceTarget, RemoteWorkspaceTargetProbe } from '@/api/remoteWorkspace'

defineProps<{
  targets: RemoteWorkspaceTarget[]
  probes: Record<string, RemoteWorkspaceTargetProbe>
  actionLoading: boolean
  error: string
  message: string
  showForm: boolean
  targetLabel: string
  targetEndpoint: string
  targetRoot: string
  targetAuthMode: string
  label: (zh: string, en: string) => string
  canOpenTarget: (target: RemoteWorkspaceTarget) => boolean
}>()

const emit = defineEmits<{
  refreshTargets: []
  toggleForm: []
  registerTarget: []
  probeTarget: [target: RemoteWorkspaceTarget]
  removeTarget: [target: RemoteWorkspaceTarget]
  openTarget: [target: RemoteWorkspaceTarget]
  'update:targetLabel': [value: string]
  'update:targetEndpoint': [value: string]
  'update:targetRoot': [value: string]
  'update:targetAuthMode': [value: string]
}>()
</script>

<template>
  <section class="runtime-panel">
    <div class="runtime-head">
      <div>
        <span class="eyebrow inline">{{ label('目标', 'Targets') }}</span>
        <h2>{{ label('工作区目标登记', 'Workspace Targets') }}</h2>
      </div>
      <div class="runtime-actions">
        <button class="secondary-btn" @click="emit('refreshTargets')">
          {{ label('刷新目标', 'Refresh Targets') }}
        </button>
        <button class="primary-btn" @click="emit('toggleForm')">
          {{ showForm ? label('收起', 'Close') : label('登记目标', 'Register Target') }}
        </button>
      </div>
    </div>

    <p v-if="error" class="error-line">{{ error }}</p>
    <p v-if="message" class="info-line">{{ message }}</p>

    <div v-if="showForm" class="target-form">
      <label>
        <span>{{ label('名称', 'Label') }}</span>
        <input
          :value="targetLabel"
          :placeholder="label('例如 客厅 NAS', 'e.g. Living Room NAS')"
          @input="emit('update:targetLabel', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <label>
        <span>{{ label('端点', 'Endpoint') }}</span>
        <input
          :value="targetEndpoint"
          placeholder="ssh://user@host:22"
          @input="emit('update:targetEndpoint', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <label>
        <span>{{ label('工作目录', 'Workspace Root') }}</span>
        <input
          :value="targetRoot"
          :placeholder="label('例如 /srv/workspace', 'e.g. /srv/workspace')"
          @input="emit('update:targetRoot', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <label>
        <span>{{ label('认证', 'Auth') }}</span>
        <select
          :value="targetAuthMode"
          @change="emit('update:targetAuthMode', ($event.target as HTMLSelectElement).value)"
        >
          <option value="ssh_key_or_agent">ssh_key_or_agent</option>
          <option value="service_session_or_reverse_proxy">service_session_or_reverse_proxy</option>
          <option value="service_password_or_reverse_proxy">service_password_or_reverse_proxy</option>
        </select>
      </label>
      <button
        class="primary-btn"
        :disabled="actionLoading || !targetLabel.trim() || !targetEndpoint.trim()"
        @click="emit('registerTarget')"
      >
        {{ actionLoading ? label('登记中', 'Registering') : label('保存目标', 'Save Target') }}
      </button>
    </div>

    <div v-if="targets.length > 0" class="target-grid">
      <article v-for="target in targets" :key="target.id" class="target-card">
        <div class="target-top">
          <div>
            <span class="target-kind">{{ target.kind }}</span>
            <h3>{{ target.label }}</h3>
          </div>
          <span :class="['status-chip', target.status === 'ready' ? 'enabled' : target.status === 'registered' ? 'pending' : 'missing']">
            {{ target.status }}
          </span>
        </div>
        <strong>{{ target.endpoint }}</strong>
        <small v-if="target.workspace_root">{{ target.workspace_root }}</small>
        <small>{{ target.auth.mode }} · {{ target.auth.owner }}</small>
        <div class="chip-row">
          <span v-for="capability in target.capabilities.slice(0, 5)" :key="capability" class="cap-chip">
            {{ capability }}
          </span>
        </div>
        <div class="target-actions">
          <button
            class="open-link-btn"
            :disabled="!canOpenTarget(target)"
            @click="emit('openTarget', target)"
          >
            {{ label('打开', 'Open') }}
          </button>
          <button
            class="open-link-btn"
            :disabled="actionLoading"
            @click="emit('probeTarget', target)"
          >
            {{ label('探测', 'Probe') }}
          </button>
          <button
            v-if="target.source !== 'sidecar'"
            class="open-link-btn danger-inline"
            :disabled="actionLoading"
            @click="emit('removeTarget', target)"
          >
            {{ label('移除', 'Remove') }}
          </button>
        </div>
        <div v-if="probes[target.id]" class="target-probe">
          <small>
            {{ probes[target.id].reachable ? label('探测通过', 'Probe passed') : label('探测失败', 'Probe failed') }}
          </small>
          <code v-if="probes[target.id].command">{{ probes[target.id].command }}</code>
          <small v-if="probes[target.id].output">{{ probes[target.id].output }}</small>
          <small v-if="probes[target.id].error">{{ probes[target.id].error }}</small>
        </div>
      </article>
    </div>
    <div v-else class="empty-line">{{ label('还没有工作区目标。', 'No workspace targets yet.') }}</div>
  </section>
</template>
