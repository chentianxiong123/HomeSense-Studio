<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useLocale } from '@/composables/useLocale'

const router = useRouter()
const { locale } = useLocale()
const isZh = computed(() => locale.value === 'zh')

function label(zh: string, en: string) {
  return isZh.value ? zh : en
}

const primaryModules = computed(() => [
  {
    key: 'chat',
    title: label('对话', 'Chat'),
    subtitle: label('随性交流、设备控制、运行过程卡片。', 'Natural assistant, device control, and runtime cards.'),
    route: '/chat',
    marker: 'AI',
    accent: '#0f766e',
  },
  {
    key: 'studio',
    title: label('工作流', 'Workflows'),
    subtitle: label('固化成功路径，编排可复用的自动化。', 'Solidify successful paths into reusable automation.'),
    route: '/studio',
    marker: 'WF',
    accent: '#2563eb',
  },
  {
    key: 'workspace',
    title: label('工作台', 'Workspace'),
    subtitle: label('NAS 本机、终端、文件、网络入口和串流网关。', 'NAS local shell, files, network access, and streaming gateway.'),
    route: '/workspace',
    marker: 'NAS',
    accent: '#dc2626',
  },
])

const secondaryModules = computed(() => [
  {
    key: 'devices',
    title: label('设备', 'Devices'),
    subtitle: label('真实设备、在线状态、房间和能力。', 'Real devices, online state, rooms, and capabilities.'),
    route: '/devices',
    marker: 'DEV',
  },
  {
    key: 'assets',
    title: label('资产', 'Assets'),
    subtitle: label('Skills、记忆、经验路径、清单和未来 MCP。', 'Skills, memory, experience paths, manifests, and future MCP.'),
    route: '/assets',
    marker: 'AST',
  },
  {
    key: 'providers',
    title: label('供应商', 'Providers'),
    subtitle: label('LLM、嵌入、重排序和视觉模型接入点。', 'LLM, embeddings, rerankers, and vision providers.'),
    route: '/providers',
    marker: 'LLM',
  },
  {
    key: 'integrations',
    title: label('集成', 'Integrations'),
    subtitle: label('米家、ADB、Bilibili、外部服务和账号入口。', 'Mi Home, ADB, Bilibili, external services, and account entry points.'),
    route: '/integrations',
    marker: 'INT',
  },
])
</script>

<template>
  <main class="app-home">
    <section class="home-hero">
      <div>
        <span class="home-eyebrow">{{ label('家庭中枢', 'Home Hub') }}</span>
        <h1>HomeSense Studio</h1>
        <p>
          {{
            label(
              '一套 Vue 同时服务 Web 和未来 App：聊天是随性入口，工作流是固化入口，工作台是 NAS 网关入口。',
              'One Vue surface for web and future app: Chat is the flexible entry, Workflows are the durable entry, Workspace is the NAS gateway entry.',
            )
          }}
        </p>
      </div>
      <button class="hero-action" @click="router.push('/chat')">
        {{ label('进入对话', 'Open Chat') }}
      </button>
    </section>

    <section class="primary-grid">
      <button
        v-for="item in primaryModules"
        :key="item.key"
        class="primary-module"
        :style="{ '--accent': item.accent }"
        @click="router.push(item.route)"
      >
        <span class="module-marker">{{ item.marker }}</span>
        <strong>{{ item.title }}</strong>
        <small>{{ item.subtitle }}</small>
      </button>
    </section>

    <section class="secondary-grid">
      <button
        v-for="item in secondaryModules"
        :key="item.key"
        class="secondary-module"
        @click="router.push(item.route)"
      >
        <span>{{ item.marker }}</span>
        <div>
          <strong>{{ item.title }}</strong>
          <small>{{ item.subtitle }}</small>
        </div>
      </button>
    </section>
  </main>
</template>

<style scoped>
.app-home {
  min-height: 100%;
  padding: 40px;
  background: #f7f9fa;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.home-hero {
  min-height: 220px;
  padding: 34px;
  border: 1px solid rgba(226, 232, 240, 0.88);
  border-radius: 24px;
  background: #fff;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.035);
}

.home-eyebrow {
  display: inline-flex;
  margin-bottom: 14px;
  padding: 4px 10px;
  border-radius: 8px;
  background: rgba(15, 118, 110, 0.08);
  color: #0f766e;
  font-size: 12px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.home-hero h1 {
  margin: 0;
  color: var(--text-primary);
  font-size: 40px;
  font-weight: 950;
  line-height: 1.05;
}

.home-hero p {
  max-width: 720px;
  margin: 16px 0 0;
  color: var(--text-secondary);
  font-size: 15px;
  font-weight: 700;
  line-height: 1.7;
}

.hero-action {
  height: 44px;
  padding: 0 18px;
  border: 1px solid #0f766e;
  border-radius: 12px;
  background: #0f766e;
  color: #fff;
  font-size: 13px;
  font-weight: 900;
  cursor: pointer;
  white-space: nowrap;
}

.primary-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

.primary-module {
  min-height: 188px;
  padding: 24px;
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: 20px;
  background: #fff;
  text-align: left;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 14px;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.03);
}

.primary-module:hover {
  border-color: color-mix(in srgb, var(--accent) 32%, white);
}

.module-marker {
  width: 52px;
  height: 38px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--accent) 11%, white);
  color: var(--accent);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 950;
}

.primary-module strong {
  color: var(--text-primary);
  font-size: 23px;
  font-weight: 950;
}

.primary-module small,
.secondary-module small {
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.55;
}

.secondary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.secondary-module {
  min-height: 118px;
  padding: 18px;
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.82);
  text-align: left;
  cursor: pointer;
  display: flex;
  gap: 14px;
}

.secondary-module span {
  width: 42px;
  height: 32px;
  border-radius: 9px;
  background: rgba(15, 23, 42, 0.06);
  color: #334155;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 950;
  flex: 0 0 auto;
}

.secondary-module div {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.secondary-module strong {
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 950;
}

@media (max-width: 1000px) {
  .primary-grid,
  .secondary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .app-home {
    padding: 18px;
    gap: 14px;
  }

  .home-hero {
    min-height: auto;
    padding: 24px;
    border-radius: 18px;
    flex-direction: column;
    align-items: stretch;
  }

  .home-hero h1 {
    font-size: 30px;
  }

  .hero-action {
    width: 100%;
  }

  .primary-grid,
  .secondary-grid {
    grid-template-columns: 1fr;
  }

  .primary-module {
    min-height: 142px;
    border-radius: 18px;
  }

  .secondary-module {
    min-height: 96px;
  }
}
</style>
