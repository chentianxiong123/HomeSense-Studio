import { createRouter, createWebHistory } from 'vue-router'
import ChatView from '@/views/ChatView.vue'
import StudioView from '@/views/StudioView.vue'
import AssetDetailView from '@/views/AssetDetailView.vue'
import WorkflowRunsView from '@/views/WorkflowRunsView.vue'
import DevicesView from '@/views/DevicesView.vue'
import DeviceDetailView from '@/views/DeviceDetailView.vue'
import RoomDetailView from '@/views/RoomDetailView.vue'
import LLMView from '@/views/LLMView.vue'
import AuthorizationsView from '@/views/AuthorizationsView.vue'
import RemoteWorkspaceView from '@/views/RemoteWorkspaceView.vue'
import MediaWorkbenchView from '@/views/MediaWorkbenchView.vue'
import StorageWorkbenchView from '@/views/StorageWorkbenchView.vue'
import MiCliDetailView from '@/views/MiCliDetailView.vue'
import AssetsView from '@/views/AssetsView.vue'
import StudioHomeView from '@/views/StudioHomeView.vue'
import WorkflowOverviewView from '@/views/WorkflowOverviewView.vue'
import SessionView from '@/views/SessionView.vue'
import AdbStreamSessionView from '@/views/AdbStreamSessionView.vue'
import AdbFilesSessionView from '@/views/AdbFilesSessionView.vue'
import DeviceFilesSessionView from '@/views/DeviceFilesSessionView.vue'
import StreamingControllerView from '@/views/StreamingControllerView.vue'
import StreamingControlMonitorView from '@/views/StreamingControlMonitorView.vue'
import StreamingSessionView from '@/views/StreamingSessionView.vue'
import { APP_DEFAULT_ROUTE, LAST_ROUTE_STORAGE_KEY, normalizeRememberedRoute, shouldRememberRoute } from './navigation'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      redirect: () => {
        if (typeof window === 'undefined') return APP_DEFAULT_ROUTE
        return normalizeRememberedRoute(window.localStorage.getItem(LAST_ROUTE_STORAGE_KEY))
      },
    },
    { path: '/chat', name: 'chat', component: ChatView },
    { path: '/studio', name: 'studio-home', component: StudioHomeView },
    { path: '/media', name: 'media-workbench', component: MediaWorkbenchView },
    { path: '/storage', name: 'storage-workbench', component: StorageWorkbenchView },
    { path: '/streaming', redirect: '/authorizations?local=streaming' },
    { path: '/sessions/streaming', name: 'streaming-session', component: StreamingSessionView, meta: { fullscreen: true } },
    { path: '/streaming/control/:sessionId', name: 'streaming-controller', component: StreamingControllerView, meta: { fullscreen: true } },
    { path: '/streaming/monitor/:sessionId', name: 'streaming-control-monitor', component: StreamingControlMonitorView, meta: { fullscreen: true } },
    { path: '/workspace', name: 'remote-workspace', component: RemoteWorkspaceView },
    { path: '/sessions/adb-stream', name: 'adb-stream-session', component: AdbStreamSessionView, meta: { fullscreen: true } },
    { path: '/sessions/adb-files', name: 'adb-files-session', component: AdbFilesSessionView, meta: { fullscreen: true } },
    { path: '/sessions/device-files', name: 'device-files-session', component: DeviceFilesSessionView, meta: { fullscreen: true } },
    { path: '/sessions/:id', name: 'session', component: SessionView, meta: { fullscreen: true } },
    { path: '/assets', name: 'assets-home', component: AssetsView },
    { path: '/devices', name: 'devices', component: DevicesView },
    { path: '/devices/rooms/:id', name: 'room-detail', component: RoomDetailView, meta: { fullscreen: true } },
    { path: '/providers', name: 'llm-models', component: LLMView },
    { path: '/devices/:id', name: 'device-detail', component: DeviceDetailView },
    { path: '/authorizations', name: 'authorizations', component: AuthorizationsView },
    { path: '/authorizations/mi-cli', name: 'authorizations-mi-cli', component: MiCliDetailView },
    { path: '/integrations', redirect: '/authorizations' },
    { path: '/integrations/sources', redirect: '/authorizations' },
    { path: '/integrations/mi-cli', redirect: '/authorizations/mi-cli' },
    { path: '/mi', redirect: '/authorizations' },
    { path: '/studio/workflows/:id/overview', name: 'studio-workflow-overview', component: WorkflowOverviewView },
    { path: '/studio/workflows/:id/editor', name: 'studio-workflow-editor', component: StudioView },
    { path: '/studio/workflows/:id/runs', name: 'studio-workflow-runs', component: WorkflowRunsView },
    {
      path: '/assets/device-skills/:id/overview',
      name: 'asset-device-skill-overview',
      component: AssetDetailView,
      meta: { assetKind: 'device_skill', assetTab: 'overview' },
    },
    {
      path: '/assets/skills/:name/overview',
      name: 'asset-skill-overview',
      component: AssetDetailView,
      meta: { assetKind: 'skill', assetTab: 'overview' },
    },
    {
      path: '/assets/skills/:name/sections',
      name: 'asset-skill-sections',
      component: AssetDetailView,
      meta: { assetKind: 'skill', assetTab: 'sections' },
    },
    {
      path: '/assets/skills/:name/prompt',
      name: 'asset-skill-prompt',
      component: AssetDetailView,
      meta: { assetKind: 'skill', assetTab: 'prompt' },
    },
    {
      path: '/assets/manifests/:id/overview',
      name: 'asset-manifest-overview',
      component: AssetDetailView,
      meta: { assetKind: 'manifest', assetTab: 'overview' },
    },
    {
      path: '/assets/plans/:id/overview',
      name: 'asset-plan-overview',
      component: AssetDetailView,
      meta: { assetKind: 'plan', assetTab: 'overview' },
    },
    {
      path: '/assets/memory/:id/overview',
      name: 'asset-memory-overview',
      component: AssetDetailView,
      meta: { assetKind: 'memory', assetTab: 'overview' },
    },
    {
      path: '/assets/mcp/:id/overview',
      name: 'asset-mcp-overview',
      component: AssetDetailView,
      meta: { assetKind: 'mcp', assetTab: 'overview' },
    },
    {
      path: '/assets/agents/:target/overview',
      name: 'asset-agent-overview',
      component: AssetDetailView,
      meta: { assetKind: 'agent', assetTab: 'overview' },
    },
    // Redirect old /studio/ asset routes for backwards compatibility
    { path: '/studio/skills/:name/:tab', redirect: (to) => `/assets/skills/${to.params.name}/${to.params.tab}` },
    { path: '/studio/manifests/:id/:tab', redirect: (to) => `/assets/manifests/${to.params.id}/${to.params.tab}` },
    { path: '/studio/plans/:id/:tab', redirect: (to) => `/assets/plans/${to.params.id}/${to.params.tab}` },
    { path: '/studio/agents/:target/:tab', redirect: (to) => `/assets/agents/${to.params.target}/${to.params.tab}` },
  ],
})

router.afterEach((to) => {
  if (typeof window === 'undefined') return
  if (!shouldRememberRoute(to.path)) return
  window.localStorage.setItem(LAST_ROUTE_STORAGE_KEY, to.path)
})
