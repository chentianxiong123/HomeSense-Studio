import { Controller, Get, Post, Param } from '@nestjs/common'

interface ConnectedService {
  id: string
  name: string
  icon: string
  description: string
  connected: boolean
  meta?: Record<string, string>
}

// In-memory mock state — no database
const services: ConnectedService[] = [
  {
    id: 'xiaomi',
    name: '小米账号',
    icon: '🏠',
    description: '小米智能家居设备管理、米家账号认证',
    connected: false,
  },
  {
    id: 'bilibili',
    name: '哔哩哔哩',
    icon: '📺',
    description: 'Bilibili 音乐、视频资源接入',
    connected: false,
  },
]

@Controller('connected-services')
export class ConnectedServicesController {
  @Get()
  list() {
    return services
  }

  @Post(':id/login')
  login(@Param('id') id: string) {
    const svc = services.find((s) => s.id === id)
    if (!svc) return { error: 'not found' }
    svc.connected = true
    svc.meta = { user_id: `mock_${id}_123` }
    return svc
  }

  @Post(':id/logout')
  logout(@Param('id') id: string) {
    const svc = services.find((s) => s.id === id)
    if (!svc) return { error: 'not found' }
    svc.connected = false
    svc.meta = undefined
    return svc
  }
}
