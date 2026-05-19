import { createRouter, createWebHistory } from 'vue-router'
import ChatView from '@/views/ChatView.vue'
import StudioView from '@/views/StudioView.vue'
import AssetDetailView from '@/views/AssetDetailView.vue'
import SettingsRouteView from '@/views/SettingsRouteView.vue'
import DevicesView from '@/views/DevicesView.vue'
import IntegrationsView from '@/views/IntegrationsView.vue'
import MiTestView from '@/views/MiTestView.vue'
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
    { path: '/devices', name: 'devices', component: DevicesView },
    { path: '/integrations', name: 'integrations', component: IntegrationsView },
    { path: '/mi-test', name: 'mi-test', component: MiTestView },
    { path: '/mi', redirect: '/integrations' },
    { path: '/studio/workflows/:id/overview', name: 'studio-workflow-overview', component: WorkflowOverviewView },
    { path: '/studio/workflows/:id/editor', name: 'studio-workflow-editor', component: StudioView },
    { path: '/studio/workflows/:id/runs', name: 'studio-workflow-runs', component: WorkflowRunsView },
    {
      path: '/studio/skills/:name/overview',
      name: 'studio-skill-overview',
      component: AssetDetailView,
      meta: { assetKind: 'skill', assetTab: 'overview' },
    },
    {
      path: '/studio/skills/:name/prompt',
      name: 'studio-skill-prompt',
      component: AssetDetailView,
      meta: { assetKind: 'skill', assetTab: 'prompt' },
    },
    {
      path: '/studio/manifests/:id/overview',
      name: 'studio-manifest-overview',
      component: AssetDetailView,
      meta: { assetKind: 'manifest', assetTab: 'overview' },
    },
    {
      path: '/studio/plans/:id/overview',
      name: 'studio-plan-overview',
      component: AssetDetailView,
      meta: { assetKind: 'plan', assetTab: 'overview' },
    },
    {
      path: '/studio/agents/:target/overview',
      name: 'studio-agent-overview',
      component: AssetDetailView,
      meta: { assetKind: 'agent', assetTab: 'overview' },
    },
    { path: '/settings', name: 'settings', component: SettingsRouteView },
  ],
})

router.afterEach((to) => {
  if (typeof window === 'undefined') return
  if (!shouldRememberRoute(to.path)) return
  window.localStorage.setItem(LAST_ROUTE_STORAGE_KEY, to.path)
})
