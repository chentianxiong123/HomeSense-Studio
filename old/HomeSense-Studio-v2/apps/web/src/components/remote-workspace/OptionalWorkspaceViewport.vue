<script setup lang="ts">
import type { RemoteWorkspaceStatus } from '@/api/remoteWorkspace'

defineProps<{
  status: RemoteWorkspaceStatus | null
  openUrl: string
  canShowFrame: boolean
  label: (zh: string, en: string) => string
}>()

const emit = defineEmits<{
  open: []
}>()
</script>

<template>
  <div class="workspace-shell optional-viewport-shell">
    <div class="shell-head">
      <div class="shell-title">
        <span>{{ label('可选浏览器工作台', 'Optional Browser Workspace') }}</span>
        <small>{{ status?.endpoint.reachable ? label('真实 code-server 入口', 'Real code-server entry') : label('本机文件和终端已优先可用', 'Local files and terminal are available first') }}</small>
      </div>
      <button
        class="open-link-btn"
        :disabled="!status?.endpoint.reachable || !openUrl"
        @click="emit('open')"
      >
        {{ label('打开', 'Open') }}
      </button>
    </div>
    <div v-if="canShowFrame" class="workspace-frame-wrap">
      <iframe
        class="workspace-frame"
        :src="openUrl"
        :title="label('code-server 工作台', 'code-server workspace')"
        loading="lazy"
        referrerpolicy="no-referrer"
      />
    </div>
    <div v-else class="shell-body">
      <span class="prompt">#</span>
      <span>
        {{
          status?.endpoint.reachable
            ? label('工作台已可达，但浏览器内嵌可能被远端响应头限制。可点击右上角打开真实页面。', 'The workspace is reachable, but browser embedding may be blocked by remote headers. Open the real page with the button above.')
            : label('等待可选工作台可达；这里不会塞虚拟终端。', 'Waiting for the optional workspace to become reachable; no fake terminal is shown here.')
        }}
      </span>
    </div>
  </div>
</template>
