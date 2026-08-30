import assert from 'node:assert/strict'

import '../packages/backend/dist/modules/service-registry/index.js'
import { agentAdapterRegistry } from '../packages/backend/dist/modules/agent-adapter/index.js'
import { channelRegistry } from '../packages/backend/dist/modules/channels/index.js'
import { manifestRegistry } from '../packages/backend/dist/modules/manifest-registry/index.js'

agentAdapterRegistry.initialize()
channelRegistry.register()

const manifests = manifestRegistry.listByKind('channel')
const channelsById = new Map(manifests.map((manifest) => [manifest.id, manifest]))

assert.equal(
  channelsById.get('channel.channel.wechat.send')?.display_name,
  '微信 Bot 发送',
  'WeChat channel manifest should expose the friendly display name.',
)

assert.equal(
  channelsById.get('channel.channel.qq.send')?.display_name,
  'QQ Bot 发送',
  'QQ channel manifest should expose the friendly display name.',
)

assert.equal(
  channelsById.get('channel.channel.feishu.send')?.display_name,
  '飞书自定义机器人',
  'Feishu channel manifest should expose the friendly display name.',
)

for (const manifest of manifests) {
  assert.ok(
    !manifest.display_name.startsWith('channel.'),
    `Channel manifest ${manifest.id} leaked a technical display name: ${manifest.display_name}`,
  )
}

console.log(`Channel manifest projection check passed for ${manifests.length} channel manifest(s).`)
