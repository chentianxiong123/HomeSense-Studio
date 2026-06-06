import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'

async function bootstrap() {
  if (import.meta.env.VITE_ENABLE_MOCK_API !== '0' && !import.meta.env.VITE_API_BASE) {
    await import('./mock-server')
  }

  const app = createApp(App)
  app.use(createPinia())
  app.use(router)
  app.mount('#app')
}

void bootstrap()
