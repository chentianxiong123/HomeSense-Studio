import { computed, type Ref } from 'vue'
import type { Room, UserDevice } from '@/api'

export type LayoutKey = 'desktop' | 'mobile'

export type RoomLayoutDraft = { x?: number; y?: number; w?: number; h?: number }

export type RoomPropsDraft = Record<string, unknown> & {
  desktop?: RoomLayoutDraft
  mobile?: RoomLayoutDraft
  bgColor?: string
}

export type DeviceRatio = { x?: number; y?: number }

export type DevicePropsDraft = Record<string, unknown> & {
  desktop?: DeviceRatio
  mobile?: DeviceRatio
}

export function useDevicesLayout(options: {
  rooms: Ref<Room[]>
  devices: Ref<UserDevice[]>
  isMobilePortrait: Ref<boolean>
  propNumber: (device: UserDevice | null, key: string) => number | null
}) {
  function currentLayoutKey(): LayoutKey {
    return options.isMobilePortrait.value ? 'mobile' : 'desktop'
  }

  function roomPropsRecord(room: Room): RoomPropsDraft {
    if (!room.props || typeof room.props !== 'object') room.props = {}
    return room.props as RoomPropsDraft
  }

  function getRoomLayoutSource(room: Room): RoomLayoutDraft {
    const props = roomPropsRecord(room)
    const layout = props[currentLayoutKey()]
    if (layout && typeof layout === 'object') return layout
    return props as RoomLayoutDraft
  }

  function getRoomBackground(room: Room, fallback = 'rgba(255, 255, 255, 0.45)'): string {
    const background = roomPropsRecord(room).bgColor
    return typeof background === 'string' && background.trim()
      ? background
      : fallback
  }

  const activeRooms = computed(() => {
    return options.rooms.value.filter((room) => {
      const layout = getRoomLayoutSource(room)
      return (
        typeof layout.x === 'number' &&
        typeof layout.y === 'number' &&
        typeof layout.w === 'number' &&
        typeof layout.h === 'number'
      )
    })
  })

  function getRoomLayout(room: Room): { x: number; y: number; w: number; h: number } {
    const layout = getRoomLayoutSource(room)
    return {
      x: layout.x ?? 50,
      y: layout.y ?? 50,
      w: layout.w ?? 260,
      h: layout.h ?? 200,
    }
  }

  function ensureRoomLayout(room: Room): RoomLayoutDraft {
    const props = roomPropsRecord(room)
    const key = currentLayoutKey()
    const existing = props[key]
    if (!existing || typeof existing !== 'object') {
      const layout = getRoomLayout(room)
      props[key] = { x: layout.x, y: layout.y, w: layout.w, h: layout.h }
      room.props = props
    }
    return props[key] as RoomLayoutDraft
  }

  function getRoomCardStyle(room: Room) {
    const layout = getRoomLayout(room)
    return {
      left: `${layout.x}px`,
      top: `${layout.y}px`,
      width: `${layout.w}px`,
      height: `${layout.h}px`,
      background: getRoomBackground(room),
    }
  }

  function getDeviceLayoutSource(device: UserDevice): DeviceRatio {
    const props = (device.props && typeof device.props === 'object'
      ? device.props
      : {}) as DevicePropsDraft
    if (props !== device.props) device.props = props
    const layout = props[currentLayoutKey()]
    if (layout && typeof layout === 'object') return layout
    return {} as DeviceRatio
  }

  function ensureDeviceLayout(device: UserDevice): DeviceRatio {
    const props = (device.props && typeof device.props === 'object'
      ? device.props
      : {}) as DevicePropsDraft
    if (props !== device.props) device.props = props
    const key = currentLayoutKey()
    const existing = props[key]
    if (!existing || typeof existing !== 'object') {
      props[key] = { x: 0.5, y: 0.5 }
      device.props = props
    }
    return props[key] as DeviceRatio
  }

  function getDeviceLayout(device: UserDevice): { x: number; y: number } {
    const layout = getDeviceLayoutSource(device)
    return {
      x: typeof layout.x === 'number' ? layout.x : 0.5,
      y: typeof layout.y === 'number' ? layout.y : 0.5,
    }
  }

  function findParentRoom(device: UserDevice): Room | null {
    const explicit = options.propNumber(device, 'room_id')
    if (explicit != null) {
      const room = options.rooms.value.find((entry) => entry.id === explicit)
      if (room) return room
    }
    return activeRooms.value[0] ?? options.rooms.value[0] ?? null
  }

  function getDeviceStyle(device: UserDevice) {
    const room = findParentRoom(device)
    if (!room) return { display: 'none' }
    const roomLayout = getRoomLayout(room)
    const ratio = getDeviceLayout(device)
    return {
      left: `${ratio.x * roomLayout.w}px`,
      top: `${ratio.y * roomLayout.h}px`,
    }
  }

  return {
    activeRooms,
    currentLayoutKey,
    roomPropsRecord,
    getRoomLayoutSource,
    getRoomBackground,
    getRoomLayout,
    ensureRoomLayout,
    getRoomCardStyle,
    getDeviceLayoutSource,
    ensureDeviceLayout,
    getDeviceLayout,
    findParentRoom,
    getDeviceStyle,
  }
}
