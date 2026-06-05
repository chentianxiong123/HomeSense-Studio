import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import AccountCenter from './views/AccountCenter.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/accounts' },
    { path: '/accounts', name: 'accounts', component: AccountCenter },
  ],
})

const app = createApp(App)
app.use(router)
app.mount('#app')
