import type { Router } from 'vue-router'

export function setupPageGuard(router: Router) {
  router.beforeEach(async (_, __, next) => {
    next()
  })
}
