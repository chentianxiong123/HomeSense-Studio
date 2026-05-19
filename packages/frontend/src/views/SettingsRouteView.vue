<script setup lang="ts">
import { useRouter } from 'vue-router'
import SettingsModal from '@/components/SettingsModal.vue'

const router = useRouter()

function close() {
  router.push('/studio')
}
</script>

<template>
  <SettingsModal :show="true" @close="close" @logged-in="close" />
</template>
