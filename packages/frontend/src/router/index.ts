import { createRouter, createWebHistory } from 'vue-router'
import ChatView from '@/views/ChatView.vue'
import StudioView from '@/views/StudioView.vue'
import AssetDetailView from '@/views/AssetDetailView.vue'
import SettingsRouteView from '@/views/SettingsRouteView.vue'
import DevicesView from '@/views/DevicesView.vue'
import DeviceDetailView from '@/views/DeviceDetailView.vue'
import LLMView from '@/views/LLMView.vue'
import IntegrationsView from '@/views/IntegrationsView.vue'
import MiCliDetailView from '@/views/MiCliDetailView.vue'
import AdbCliDetailView from '@/views/AdbCliDetailView.vue'
import MiTestView from '@/views/MiTestView.vue'
import AssetsView from '@/views/AssetsView.vue'
import StudioHomeView from '@/views/StudioHomeView.vue'
import WorkflowOverviewView from '@/views/WorkflowOverviewView.vue'
import WorkflowRunsView from '@/views/WorkflowRunsView.vue'
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
    { path: '/assets', name: 'assets-home', component: AssetsView },
    { path: '/devices', name: 'devices', component: DevicesView },
    { path: '/providers', name: 'llm-models', component: LLMView },
    { path: '/devices/:id', name: 'device-detail', component: DeviceDetailView },
    { path: '/integrations', name: 'integrations', component: IntegrationsView },
    { path: '/integrations/mi-cli', name: 'integrations-mi-cli', component: MiCliDetailView },
    { path: '/integrations/adb-cli', name: 'integrations-adb-cli', component: AdbCliDetailView },
    { path: '/mi-test', name: 'mi-test', component: MiTestView },
    { path: '/mi', redirect: '/integrations' },
    { path: '/studio/workflows/:id/overview', name: 'studio-workflow-overview', component: WorkflowOverviewView },
    { path: '/studio/workflows/:id/editor', name: 'studio-workflow-editor', component: StudioView },
    { path: '/studio/workflows/:id/runs', name: 'studio-workflow-runs', component: WorkflowRunsView },
    {
      path: '/assets/skills/:name/overview',
      name: 'asset-skill-overview',
      component: AssetDetailView,
      meta: { assetKind: 'skill', assetTab: 'overview' },
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
    { path: '/settings', name: 'settings', component: SettingsRouteView },
  ],
})

router.afterEach((to) => {
  if (typeof window === 'undefined') return
  if (!shouldRememberRoute(to.path)) return
  window.localStorage.setItem(LAST_ROUTE_STORAGE_KEY, to.path)
})
