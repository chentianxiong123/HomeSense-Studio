import { serviceRegistry, type ServiceSchema } from '../registry/index.js'

interface ChannelManifest {
  name: string
  kind: string
  display_name: string
  description: string
  endpoint_env?: string
  fields: Record<string, { description: string; required: boolean; default?: unknown }>
}

const CHANNEL_MANIFESTS: ChannelManifest[] = [
  {
    name: 'channel.wechat.send',
    kind: 'channel',
    display_name: '微信 Bot 发送',
    description: '向微信 Bot/机器人 Webhook 发送一条消息（占位，未绑定真实 token）',
    endpoint_env: 'WECHAT_BOT_WEBHOOK',
    fields: {
      text: { description: '消息正文', required: true },
      mentioned_list: { description: '@ 成员列表', required: false },
      msg_type: { description: 'text/markdown/news', required: false, default: 'text' },
    },
  },
  {
    name: 'channel.qq.send',
    kind: 'channel',
    display_name: 'QQ Bot 发送',
    description: '向 QQ Bot（go-cqhttp / NapCat 等）发送消息（占位）',
    endpoint_env: 'QQ_BOT_ENDPOINT',
    fields: {
      text: { description: '消息正文', required: true },
      target_type: { description: 'private/group', required: false, default: 'private' },
      target_id: { description: '接收者 QQ 号或群号', required: true },
    },
  },
  {
    name: 'channel.feishu.send',
    kind: 'channel',
    display_name: '飞书自定义机器人',
    description: '向飞书群 Webhook 发送消息（占位，webhook 由环境变量配置）',
    endpoint_env: 'FEISHU_BOT_WEBHOOK',
    fields: {
      text: { description: '消息正文', required: true },
      msg_type: { description: 'text/interactive/post', required: false, default: 'text' },
      card: { description: 'interactive 卡片 JSON', required: false },
    },
  },
]

export interface ChannelSendResult {
  protocol: 'channel'
  channel: string
  status: 'planned' | 'sent'
  endpoint?: string
  request: Record<string, unknown>
  response?: unknown
  sent_at: string
}

async function sendViaChannel(
  manifest: ChannelManifest,
  params: Record<string, unknown>,
): Promise<ChannelSendResult> {
  const endpoint = manifest.endpoint_env ? process.env[manifest.endpoint_env] : undefined
  const request = { channel: manifest.name, params }

  if (!endpoint) {
    return {
      protocol: 'channel',
      channel: manifest.name,
      status: 'planned',
      endpoint: undefined,
      request,
      sent_at: new Date().toISOString(),
    }
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })

  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(`Channel ${manifest.name} failed: ${response.status} ${JSON.stringify(body)}`)
  }

  return {
    protocol: 'channel',
    channel: manifest.name,
    status: 'sent',
    endpoint,
    request,
    response: body,
    sent_at: new Date().toISOString(),
  }
}

export function registerChannels(): ChannelManifest[] {
  for (const manifest of CHANNEL_MANIFESTS) {
    const schema: ServiceSchema = {
      description: manifest.description || manifest.display_name,
      fields: manifest.fields,
    }
    serviceRegistry.register(
      manifest.name,
      async (params) => sendViaChannel(manifest, params),
      schema,
    )
  }
  return CHANNEL_MANIFESTS
}

export const channelRegistry = {
  register: registerChannels,
  list: () => CHANNEL_MANIFESTS,
}
