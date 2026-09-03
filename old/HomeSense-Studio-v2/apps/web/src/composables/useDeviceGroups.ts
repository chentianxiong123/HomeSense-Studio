import { computed, ref, type Ref } from 'vue'
import { api, type UserDevice } from '@/api'

export type DeviceGroupRecord = {
  id: number
  name: string
  member_ids: number[]
}

export type BindGroupInput = {
  primary: UserDevice
  partner: UserDevice
  name?: string
}

export function useDeviceGroups(devices: Ref<UserDevice[]>) {
  const groups = ref<DeviceGroupRecord[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function load() {
    loading.value = true
    error.value = null
    try {
      const res = await api.deviceGroups.list()
      groups.value = res.groups.map((g) => ({
        id: g.id,
        name: g.name,
        member_ids: [...g.member_ids],
      }))
      syncFromGroups()
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'failed to load groups'
    } finally {
      loading.value = false
    }
  }

  function applyGroupToDevice(device: UserDevice, groupId: number, groupName: string) {
    const props: Record<string, unknown> = { ...(device.props ?? {}), group_id: groupId, group_name: groupName }
    device.props = props
  }

  function clearGroupFromDevice(device: UserDevice) {
    const props: Record<string, unknown> = { ...(device.props ?? {}) }
    delete props.group_id
    delete props.group_name
    device.props = props
  }

  function readGroupId(device: UserDevice): number | null {
    const raw = device.props?.group_id
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw
    if (typeof raw === 'string' && raw.trim() !== '') {
      const n = Number(raw)
      return Number.isFinite(n) ? n : null
    }
    return null
  }

  function readGroupName(device: UserDevice): string | undefined {
    const raw = device.props?.group_name
    return typeof raw === 'string' ? raw : undefined
  }

  function syncFromGroups() {
    const memberSet = new Map<number, { id: number; name: string }>()
    for (const g of groups.value) {
      for (const id of g.member_ids) memberSet.set(id, { id: g.id, name: g.name })
    }
    for (const d of devices.value) {
      const m = memberSet.get(d.id)
      if (m) {
        applyGroupToDevice(d, m.id, m.name)
      } else if (readGroupId(d) != null) {
        clearGroupFromDevice(d)
      }
    }
  }

  async function bindGroup(input: BindGroupInput) {
    const { primary, partner, name } = input
    const existingGid = readGroupId(primary)
    const resolvedName = name ?? readGroupName(primary) ?? `${primary.name}+${partner.name}`
    let groupId: number

    if (existingGid != null && groups.value.some((g) => g.id === existingGid)) {
      groupId = existingGid
      const res = await api.deviceGroups.update(groupId, {
        name: resolvedName,
        device_ids: [primary.id, partner.id],
      })
      const g = res.data.group
      replaceGroup({ id: g.id, name: g.name, member_ids: [...g.member_ids] })
    } else {
      const res = await api.deviceGroups.create({
        name: resolvedName,
        device_ids: [primary.id, partner.id],
      })
      const g = res.data.group
      groupId = g.id
      groups.value.unshift({ id: g.id, name: g.name, member_ids: [...g.member_ids] })
    }

    applyGroupToDevice(primary, groupId, resolvedName)
    applyGroupToDevice(partner, groupId, resolvedName)
    syncFromGroups()
  }

  async function disbandGroup(gid: number) {
    if (!groups.value.some((g) => g.id === gid)) return
    await api.deviceGroups.remove(gid)
    groups.value = groups.value.filter((g) => g.id !== gid)
    for (const d of devices.value) {
      if (readGroupId(d) === gid) clearGroupFromDevice(d)
    }
    syncFromGroups()
  }

  function replaceGroup(next: DeviceGroupRecord) {
    const idx = groups.value.findIndex((g) => g.id === next.id)
    if (idx >= 0) groups.value[idx] = next
    else groups.value.unshift(next)
  }

  const partnerCandidates = computed(() => (primary: UserDevice) => {
    const currentRoomId = primary.room_id
    return devices.value.filter(
      (d) => d.id !== primary.id && d.room_id === currentRoomId,
    )
  })

  const partnersOf = computed(() => (device: UserDevice | null | undefined) => {
    if (!device) return []
    const gid = readGroupId(device)
    if (gid == null) return []
    return devices.value.filter(
      (d) => d.id !== device.id && readGroupId(d) === gid,
    )
  })

  return {
    groups,
    loading,
    error,
    load,
    bindGroup,
    disbandGroup,
    partnerCandidates,
    partnersOf,
  }
}
