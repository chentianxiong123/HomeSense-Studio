import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { api, type Room, type UserDevice } from '@/api'
import type { DevicePropsDraft, RoomPropsDraft } from '@/composables/useDevicesLayout'

type LabelFn = (zh: string, en: string) => string

export function useDevicesEditor(options: {
  rooms: Ref<Room[]>
  devices: Ref<UserDevice[]>
  activeRooms: ComputedRef<Room[]>
  isEditMode: Ref<boolean>
  errorMessage: Ref<string>
  currentLayoutKey: () => 'desktop' | 'mobile'
  roomPropsRecord: (room: Room) => RoomPropsDraft
  propNumber: (device: UserDevice | null, key: string) => number | null
  getRoomSpawnLayout: () => { x: number; y: number; w: number; h: number }
  label: LabelFn
  showSuccess: (message: string) => void
}) {
  const creating = ref(false)
  const creatingDevice = ref(false)
  const saving = ref(false)
  const editingRoomId = ref<number | null>(null)
  const editingRoomName = ref('')
  const editingRoomColor = ref('')
  const editingRoomDeviceIds = ref<number[]>([])
  const deviceCreatorOpen = ref(false)
  const newDeviceName = ref('')
  const newDeviceType = ref('other')
  const newDeviceRoomId = ref<number | null>(null)

  const editingRoom = computed(() =>
    options.rooms.value.find((room) => room.id === editingRoomId.value) || null
  )

  const roomDeviceOptions = computed(() =>
    [...options.devices.value].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  )

  function nextRoomName() {
    const baseName = options.label('新房间', 'New Room')
    const usedNames = new Set(options.rooms.value.map((room) => room.name.trim()))
    if (!usedNames.has(baseName)) return baseName

    let index = 2
    while (usedNames.has(`${baseName} ${index}`)) index += 1
    return `${baseName} ${index}`
  }

  async function createRoomInView() {
    if (!options.isEditMode.value || creating.value) return

    creating.value = true
    options.errorMessage.value = ''
    try {
      const key = options.currentLayoutKey()
      const props: RoomPropsDraft = {}
      props[key] = options.getRoomSpawnLayout()

      const result = await api.rooms.create({
        name: nextRoomName(),
        props,
      })
      const room = result.data.room
      options.rooms.value = [...options.rooms.value, room]
      openRoomSettings(room)
      options.showSuccess(options.label('房间已创建', 'Room created'))
    } catch (error) {
      options.errorMessage.value = (error as Error).message || String(error)
    } finally {
      creating.value = false
    }
  }

  function nextDeviceName() {
    const baseName = options.label('新设备', 'New Device')
    const usedNames = new Set(options.devices.value.map((device) => device.name.trim()))
    if (!usedNames.has(baseName)) return baseName

    let index = 2
    while (usedNames.has(`${baseName} ${index}`)) index += 1
    return `${baseName} ${index}`
  }

  function getDeviceSpawnLayout(_room: Room | null): { x: number; y: number } {
    return { x: 0.5, y: 0.5 }
  }

  function openDeviceCreator(room?: Room | null) {
    if (!options.isEditMode.value) return
    const targetRoom = room ?? editingRoom.value ?? options.activeRooms.value[0] ?? options.rooms.value[0] ?? null
    deviceCreatorOpen.value = true
    newDeviceName.value = nextDeviceName()
    newDeviceType.value = 'other'
    newDeviceRoomId.value = targetRoom?.id ?? null
    options.errorMessage.value = ''
  }

  function closeDeviceCreator() {
    deviceCreatorOpen.value = false
    newDeviceName.value = ''
    newDeviceType.value = 'other'
    newDeviceRoomId.value = null
  }

  async function createDeviceFromDialog() {
    if (creatingDevice.value) return

    const name = newDeviceName.value.trim()
    if (!name) {
      options.errorMessage.value = options.label('设备名不能为空', 'Device name is required')
      return
    }

    const roomId = newDeviceRoomId.value
    const room = roomId == null ? null : options.rooms.value.find((entry) => entry.id === Number(roomId)) ?? null
    if (!room) {
      options.errorMessage.value = options.label('请先选择房间', 'Please select a room first')
      return
    }

    creatingDevice.value = true
    options.errorMessage.value = ''
    try {
      const key = options.currentLayoutKey()
      const props: DevicePropsDraft = {
        device_type: newDeviceType.value,
        room_id: room.id,
      }
      props[key] = getDeviceSpawnLayout(room)

      const result = await api.userDevices.create({ name, props })
      const device = result.data.device
      options.devices.value = [...options.devices.value, device]
      if (editingRoomId.value === room.id && !editingRoomDeviceIds.value.includes(device.id)) {
        editingRoomDeviceIds.value = [...editingRoomDeviceIds.value, device.id]
      }
      closeDeviceCreator()
      options.showSuccess(options.label('设备已创建', 'Device created'))
    } catch (error) {
      options.errorMessage.value = (error as Error).message || String(error)
    } finally {
      creatingDevice.value = false
    }
  }

  function roomNameForDevice(device: UserDevice): string {
    const roomId = options.propNumber(device, 'room_id')
    if (!roomId) return options.label('未绑定房间', 'Unassigned')
    return options.rooms.value.find((room) => room.id === roomId)?.name ?? options.label('未知房间', 'Unknown room')
  }

  function closeRoomSettings() {
    editingRoomId.value = null
    editingRoomName.value = ''
    editingRoomColor.value = ''
    editingRoomDeviceIds.value = []
  }

  function openRoomSettings(room: Room) {
    editingRoomId.value = room.id
    editingRoomName.value = room.name
    editingRoomColor.value = typeof options.roomPropsRecord(room).bgColor === 'string'
      ? String(options.roomPropsRecord(room).bgColor)
      : ''
    editingRoomDeviceIds.value = options.devices.value
      .filter((device) => options.propNumber(device, 'room_id') === room.id)
      .map((device) => device.id)
  }

  async function saveRoomSettings() {
    const room = editingRoom.value
    if (!room) return

    const name = editingRoomName.value.trim()
    if (!name) {
      options.errorMessage.value = options.label('房间名不能为空', 'Room name is required')
      return
    }

    saving.value = true
    options.errorMessage.value = ''
    try {
      const props = options.roomPropsRecord(room)
      room.name = name
      if (editingRoomColor.value) props.bgColor = editingRoomColor.value
      else delete props.bgColor
      room.props = props

      const selectedIds = new Set(editingRoomDeviceIds.value)
      const deviceUpdates: Array<Promise<unknown>> = []

      for (const device of options.devices.value) {
        const currentRoomId = options.propNumber(device, 'room_id')
        const shouldBeInRoom = selectedIds.has(device.id)

        if (shouldBeInRoom && currentRoomId !== room.id) {
          const nextProps = { ...device.props, room_id: room.id }
          device.props = nextProps
          deviceUpdates.push(api.userDevices.update(device.id, { props: nextProps }))
        } else if (!shouldBeInRoom && currentRoomId === room.id) {
          const nextProps = { ...device.props }
          delete nextProps.room_id
          device.props = nextProps
          deviceUpdates.push(api.userDevices.update(device.id, { props: nextProps }))
        }
      }

      await Promise.all([
        api.rooms.update(room.id, { name, props: room.props }),
        ...deviceUpdates,
      ])

      closeRoomSettings()
      options.showSuccess(options.label('房间已保存', 'Room saved'))
    } catch (error) {
      options.errorMessage.value = (error as Error).message || String(error)
    } finally {
      saving.value = false
    }
  }

  async function deleteEditingRoom() {
    const room = editingRoom.value
    if (!room) return
    if (!window.confirm(options.label(`确认删除房间「${room.name}」？`, `Delete room "${room.name}"?`))) return

    saving.value = true
    options.errorMessage.value = ''
    try {
      const deviceUpdates = options.devices.value
        .filter((device) => options.propNumber(device, 'room_id') === room.id)
        .map((device) => {
          const nextProps = { ...device.props }
          delete nextProps.room_id
          device.props = nextProps
          return api.userDevices.update(device.id, { props: nextProps })
        })

      await Promise.all(deviceUpdates)
      await api.rooms.delete(room.id)
      options.rooms.value = options.rooms.value.filter((entry) => entry.id !== room.id)
      closeRoomSettings()
      options.showSuccess(options.label('房间已删除', 'Room deleted'))
    } catch (error) {
      options.errorMessage.value = (error as Error).message || String(error)
    } finally {
      saving.value = false
    }
  }

  return {
    creating,
    creatingDevice,
    saving,
    editingRoomId,
    editingRoomName,
    editingRoomColor,
    editingRoomDeviceIds,
    editingRoom,
    roomDeviceOptions,
    deviceCreatorOpen,
    newDeviceName,
    newDeviceType,
    newDeviceRoomId,
    createRoomInView,
    openDeviceCreator,
    closeDeviceCreator,
    createDeviceFromDialog,
    roomNameForDevice,
    closeRoomSettings,
    openRoomSettings,
    saveRoomSettings,
    deleteEditingRoom,
  }
}
