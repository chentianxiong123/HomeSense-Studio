import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import crypto from 'node:crypto'
import dgram, { type RemoteInfo, type Socket } from 'node:dgram'
import os from 'node:os'
import { cliBridge } from '../cli/cli-bridge'

const SSDP_ADDR = '239.255.255.250'
const SSDP_PORT = 1900
const DEVICE_TYPE = 'urn:schemas-upnp-org:device:MediaRenderer:1'
const AV_TRANSPORT = 'urn:schemas-upnp-org:service:AVTransport:1'
const RENDERING_CONTROL = 'urn:schemas-upnp-org:service:RenderingControl:1'
const CONNECTION_MANAGER = 'urn:schemas-upnp-org:service:ConnectionManager:1'
const SUPPORTED_PROTOCOLS = [
  'http-get:*:audio/mpeg:*',
  'http-get:*:audio/mp4:*',
  'http-get:*:audio/aac:*',
  'http-get:*:audio/wav:*',
  'http-get:*:audio/flac:*',
].join(',')

interface XiaoAiSpeaker {
  did: string
  name?: string
  model?: string
  hardware?: string
  device_id?: string
}

interface VirtualRenderer {
  udn: string
  did: string
  name: string
  model?: string
  currentUri: string
  currentMetaData: string
  state: 'NO_MEDIA_PRESENT' | 'STOPPED' | 'PLAYING' | 'PAUSED_PLAYBACK' | 'TRANSITIONING'
  volume: number
}

@Injectable()
export class VirtualDlnaService implements OnModuleInit, OnModuleDestroy {
  private readonly renderers = new Map<string, VirtualRenderer>()
  private socket: Socket | null = null
  private aliveTimer: NodeJS.Timeout | null = null
  private readonly enabled = process.env.MEDIA_VIRTUAL_DLNA !== '0'

  async onModuleInit() {
    if (!this.enabled) return
    await this.refreshRenderers()
    this.startSsdp()
  }

  onModuleDestroy() {
    this.stopSsdp()
  }

  listRenderers() {
    return {
      enabled: this.enabled,
      ssdp_running: Boolean(this.socket),
      host: this.host(),
      count: this.renderers.size,
      renderers: [...this.renderers.values()].map((renderer) => ({
        udn: renderer.udn,
        did: renderer.did,
        name: renderer.name,
        model: renderer.model,
        state: renderer.state,
        volume: renderer.volume,
        location: this.descriptionUrl(renderer.udn),
      })),
    }
  }

  async refreshRenderers() {
    const result = await cliBridge.run('mi-cli', 'speaker_list', {})
    if (result.status !== 'success') return result

    const data = (result.data ?? {}) as { speakers?: XiaoAiSpeaker[] }
    const speakers = data.speakers ?? []
    const next = new Map<string, VirtualRenderer>()
    for (const speaker of speakers) {
      if (!speaker.did) continue
      const udn = stableUuid(`homesense-xiaoai:${speaker.did}`)
      const existing = this.renderers.get(udn)
      next.set(udn, {
        udn,
        did: String(speaker.did),
        name: speaker.name || `XiaoAi ${speaker.did}`,
        model: speaker.model || speaker.hardware,
        currentUri: existing?.currentUri ?? '',
        currentMetaData: existing?.currentMetaData ?? '',
        state: existing?.state ?? 'NO_MEDIA_PRESENT',
        volume: existing?.volume ?? 50,
      })
    }
    this.renderers.clear()
    for (const [udn, renderer] of next) this.renderers.set(udn, renderer)
    this.sendAlive()
    return { status: 'success', data: this.listRenderers() }
  }

  deviceDescription(udn: string): string | null {
    const renderer = this.renderers.get(udn)
    if (!renderer) return null
    const base = this.baseUrl()
    return xml(`<?xml version="1.0" encoding="utf-8"?>
<root xmlns="urn:schemas-upnp-org:device-1-0" xmlns:dlna="urn:schemas-dlna-org:device-1-0">
  <specVersion><major>1</major><minor>0</minor></specVersion>
  <device>
    <deviceType>${DEVICE_TYPE}</deviceType>
    <friendlyName>${escapeXml(renderer.name)}</friendlyName>
    <manufacturer>HomeSense</manufacturer>
    <modelDescription>HomeSense XiaoAi Virtual DLNA Audio Renderer</modelDescription>
    <modelName>${escapeXml(renderer.model || 'XiaoAi Virtual Renderer')}</modelName>
    <UDN>uuid:${renderer.udn}</UDN>
    <dlna:X_DLNADOC>DMR-1.50</dlna:X_DLNADOC>
    <dlna:X_DLNACAP>audio-only</dlna:X_DLNACAP>
    <serviceList>
      <service><serviceType>${AV_TRANSPORT}</serviceType><serviceId>urn:upnp-org:serviceId:AVTransport</serviceId><SCPDURL>${base}/device/${renderer.udn}/AVTransport.xml</SCPDURL><controlURL>${base}/device/${renderer.udn}/AVTransport/control</controlURL><eventSubURL>${base}/device/${renderer.udn}/AVTransport/event</eventSubURL></service>
      <service><serviceType>${RENDERING_CONTROL}</serviceType><serviceId>urn:upnp-org:serviceId:RenderingControl</serviceId><SCPDURL>${base}/device/${renderer.udn}/RenderingControl.xml</SCPDURL><controlURL>${base}/device/${renderer.udn}/RenderingControl/control</controlURL><eventSubURL>${base}/device/${renderer.udn}/RenderingControl/event</eventSubURL></service>
      <service><serviceType>${CONNECTION_MANAGER}</serviceType><serviceId>urn:upnp-org:serviceId:ConnectionManager</serviceId><SCPDURL>${base}/device/${renderer.udn}/ConnectionManager.xml</SCPDURL><controlURL>${base}/device/${renderer.udn}/ConnectionManager/control</controlURL><eventSubURL>${base}/device/${renderer.udn}/ConnectionManager/event</eventSubURL></service>
    </serviceList>
  </device>
</root>`)
  }

  serviceScpd(service: string): string | null {
    if (service === 'AVTransport') return AV_TRANSPORT_SCPD
    if (service === 'RenderingControl') return RENDERING_CONTROL_SCPD
    if (service === 'ConnectionManager') return CONNECTION_MANAGER_SCPD
    return null
  }

  async handleSoap(udn: string, service: string, soapActionHeader: string, body: string): Promise<{ body: string; statusCode: number }> {
    const renderer = this.renderers.get(udn)
    if (!renderer) return { body: soapFault(401, 'Invalid renderer'), statusCode: 404 }

    const action = parseSoapAction(soapActionHeader)
    const params = parseSoapParams(body)
    if (service === 'AVTransport') return this.handleAvTransport(renderer, action, params)
    if (service === 'RenderingControl') return this.handleRenderingControl(renderer, action, params)
    if (service === 'ConnectionManager') return this.handleConnectionManager(action)
    return { body: soapFault(401, 'Invalid service'), statusCode: 500 }
  }

  private async handleAvTransport(renderer: VirtualRenderer, action: string, params: Record<string, string>) {
    if (action === 'SetAVTransportURI') {
      renderer.currentUri = params.CurrentURI || ''
      renderer.currentMetaData = params.CurrentURIMetaData || ''
      renderer.state = renderer.currentUri ? 'STOPPED' : 'NO_MEDIA_PRESENT'
      return { body: soapResponse(AV_TRANSPORT, action, {}), statusCode: 200 }
    }
    if (action === 'Play') {
      if (!renderer.currentUri) return { body: soapFault(714, 'No media present'), statusCode: 500 }
      renderer.state = 'TRANSITIONING'
      const result = await cliBridge.run('mi-cli', 'speaker_play_url', {
        did: renderer.did,
        url: renderer.currentUri,
        title: titleFromMeta(renderer.currentMetaData) || renderer.name,
      })
      renderer.state = result.status === 'success' ? 'PLAYING' : 'STOPPED'
      return result.status === 'success'
        ? { body: soapResponse(AV_TRANSPORT, action, {}), statusCode: 200 }
        : { body: soapFault(501, result.message || result.error || 'Play failed'), statusCode: 500 }
    }
    if (action === 'Pause') {
      await cliBridge.run('mi-cli', 'speaker_control', { did: renderer.did, control: 'pause' })
      renderer.state = 'PAUSED_PLAYBACK'
      return { body: soapResponse(AV_TRANSPORT, action, {}), statusCode: 200 }
    }
    if (action === 'Stop') {
      await cliBridge.run('mi-cli', 'speaker_control', { did: renderer.did, control: 'stop' })
      renderer.state = 'STOPPED'
      return { body: soapResponse(AV_TRANSPORT, action, {}), statusCode: 200 }
    }
    if (action === 'GetTransportInfo') {
      return { body: soapResponse(AV_TRANSPORT, action, { CurrentTransportState: renderer.state, CurrentTransportStatus: 'OK', CurrentSpeed: '1' }), statusCode: 200 }
    }
    if (action === 'GetPositionInfo') {
      return { body: soapResponse(AV_TRANSPORT, action, { Track: '1', TrackDuration: '00:00:00', TrackMetaData: renderer.currentMetaData, TrackURI: renderer.currentUri, RelTime: '00:00:00', AbsTime: '00:00:00', RelCount: '0', AbsCount: '0' }), statusCode: 200 }
    }
    if (action === 'GetMediaInfo') {
      return { body: soapResponse(AV_TRANSPORT, action, { NrTracks: renderer.currentUri ? '1' : '0', MediaDuration: '00:00:00', CurrentURI: renderer.currentUri, CurrentURIMetaData: renderer.currentMetaData, NextURI: '', NextURIMetaData: '', PlayMedium: 'NETWORK', RecordMedium: 'NOT_IMPLEMENTED', WriteStatus: 'NOT_IMPLEMENTED' }), statusCode: 200 }
    }
    if (action === 'GetCurrentTransportActions') {
      return { body: soapResponse(AV_TRANSPORT, action, { Actions: 'Play,Pause,Stop' }), statusCode: 200 }
    }
    return { body: soapFault(401, `Unsupported AVTransport action: ${action}`), statusCode: 500 }
  }

  private async handleRenderingControl(renderer: VirtualRenderer, action: string, params: Record<string, string>) {
    if (action === 'GetVolume') {
      return { body: soapResponse(RENDERING_CONTROL, action, { CurrentVolume: String(renderer.volume) }), statusCode: 200 }
    }
    if (action === 'SetVolume') {
      const volume = Math.min(100, Math.max(0, Number(params.DesiredVolume || renderer.volume)))
      renderer.volume = Number.isFinite(volume) ? volume : renderer.volume
      await cliBridge.run('mi-cli', 'speaker_control', { did: renderer.did, control: 'volume', volume: renderer.volume })
      return { body: soapResponse(RENDERING_CONTROL, action, {}), statusCode: 200 }
    }
    if (action === 'GetMute') return { body: soapResponse(RENDERING_CONTROL, action, { CurrentMute: '0' }), statusCode: 200 }
    if (action === 'SetMute') return { body: soapResponse(RENDERING_CONTROL, action, {}), statusCode: 200 }
    return { body: soapFault(401, `Unsupported RenderingControl action: ${action}`), statusCode: 500 }
  }

  private handleConnectionManager(action: string) {
    if (action === 'GetProtocolInfo') return { body: soapResponse(CONNECTION_MANAGER, action, { Source: '', Sink: SUPPORTED_PROTOCOLS }), statusCode: 200 }
    if (action === 'GetCurrentConnectionIDs') return { body: soapResponse(CONNECTION_MANAGER, action, { ConnectionIDs: '0' }), statusCode: 200 }
    if (action === 'GetCurrentConnectionInfo') return { body: soapResponse(CONNECTION_MANAGER, action, { RcsID: '0', AVTransportID: '0', ProtocolInfo: '', PeerConnectionManager: '', PeerConnectionID: '-1', Direction: 'Input', Status: 'OK' }), statusCode: 200 }
    return { body: soapFault(401, `Unsupported ConnectionManager action: ${action}`), statusCode: 500 }
  }

  private startSsdp() {
    if (this.socket) return
    try {
      this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
      this.socket.on('message', (message, remote) => this.handleSsdpMessage(message, remote))
      this.socket.on('error', (error) => console.warn('[media] virtual DLNA SSDP error:', error.message))
      this.socket.bind(SSDP_PORT, () => {
        try {
          this.socket?.addMembership(SSDP_ADDR)
          this.socket?.setMulticastTTL(2)
        } catch (error) {
          console.warn('[media] virtual DLNA multicast join failed:', error instanceof Error ? error.message : error)
        }
        this.sendAlive()
      })
      this.aliveTimer = setInterval(() => this.sendAlive(), 30_000)
    } catch (error) {
      console.warn('[media] virtual DLNA SSDP disabled:', error instanceof Error ? error.message : error)
      this.socket = null
    }
  }

  private stopSsdp() {
    if (this.aliveTimer) clearInterval(this.aliveTimer)
    this.aliveTimer = null
    this.sendByebye()
    this.socket?.close()
    this.socket = null
  }

  private handleSsdpMessage(message: Buffer, remote: RemoteInfo) {
    const text = message.toString('utf8')
    if (!text.includes('M-SEARCH')) return
    const st = text.split(/\r?\n/).find((line) => line.toLowerCase().startsWith('st:'))?.split(':').slice(1).join(':').trim()
    if (!st) return
    for (const renderer of this.renderers.values()) {
      for (const [target, usn] of this.searchTargets(renderer.udn)) {
        if (st === 'ssdp:all' || st === target) {
          this.socket?.send(this.msearchResponse(target, usn, renderer.udn), remote.port, remote.address)
        }
      }
    }
  }

  private sendAlive() {
    if (!this.socket) return
    for (const renderer of this.renderers.values()) {
      for (const [target, usn] of this.searchTargets(renderer.udn)) {
        this.socket.send(this.notify('ssdp:alive', target, usn, renderer.udn), SSDP_PORT, SSDP_ADDR)
      }
    }
  }

  private sendByebye() {
    if (!this.socket) return
    for (const renderer of this.renderers.values()) {
      for (const [target, usn] of this.searchTargets(renderer.udn)) {
        this.socket.send(this.notify('ssdp:byebye', target, usn, renderer.udn), SSDP_PORT, SSDP_ADDR)
      }
    }
  }

  private searchTargets(udn: string): Array<[string, string]> {
    const uuid = `uuid:${udn}`
    return [
      ['upnp:rootdevice', `${uuid}::upnp:rootdevice`],
      [uuid, uuid],
      [DEVICE_TYPE, `${uuid}::${DEVICE_TYPE}`],
      [AV_TRANSPORT, `${uuid}::${AV_TRANSPORT}`],
      [RENDERING_CONTROL, `${uuid}::${RENDERING_CONTROL}`],
      [CONNECTION_MANAGER, `${uuid}::${CONNECTION_MANAGER}`],
    ]
  }

  private msearchResponse(st: string, usn: string, udn: string): Buffer {
    return Buffer.from(`HTTP/1.1 200 OK\r\nCACHE-CONTROL: max-age=1800\r\nLOCATION: ${this.descriptionUrl(udn)}\r\nSERVER: HomeSense/1.0 UPnP/1.0\r\nST: ${st}\r\nUSN: ${usn}\r\nEXT:\r\n\r\n`)
  }

  private notify(type: 'ssdp:alive' | 'ssdp:byebye', nt: string, usn: string, udn: string): Buffer {
    const location = type === 'ssdp:alive' ? `LOCATION: ${this.descriptionUrl(udn)}\r\nCACHE-CONTROL: max-age=1800\r\n` : ''
    return Buffer.from(`NOTIFY * HTTP/1.1\r\nHOST: ${SSDP_ADDR}:${SSDP_PORT}\r\n${location}NT: ${nt}\r\nNTS: ${type}\r\nSERVER: HomeSense/1.0 UPnP/1.0\r\nUSN: ${usn}\r\n\r\n`)
  }

  private descriptionUrl(udn: string): string {
    return `${this.baseUrl()}/device/${udn}/description.xml`
  }

  private baseUrl(): string {
    return `http://${this.host()}:${process.env.PORT || 3100}/api/media/virtual-dlna`
  }

  private host(): string {
    return process.env.MEDIA_PUBLIC_HOST || findLanIpv4() || '127.0.0.1'
  }
}

function parseSoapAction(header: string): string {
  const raw = String(header || '').replaceAll('"', '')
  return raw.includes('#') ? raw.split('#').at(-1) || '' : raw
}

function parseSoapParams(body: string): Record<string, string> {
  const params: Record<string, string> = {}
  for (const match of body.matchAll(/<([A-Za-z0-9_]+)>([\s\S]*?)<\/\1>/g)) {
    params[match[1]] = unescapeXml(match[2] || '')
  }
  return params
}

function titleFromMeta(meta: string): string {
  return unescapeXml(meta.match(/<dc:title>([\s\S]*?)<\/dc:title>/)?.[1] || '')
}

function soapResponse(serviceUrn: string, action: string, params: Record<string, string>): string {
  const paramXml = Object.entries(params).map(([key, value]) => `<${key}>${escapeXml(value)}</${key}>`).join('')
  return xml(`<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action}Response xmlns:u="${serviceUrn}">${paramXml}</u:${action}Response></s:Body></s:Envelope>`)
}

function soapFault(code: number, description: string): string {
  return xml(`<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault><faultcode>s:Client</faultcode><faultstring>UPnPError</faultstring><detail><UPnPError xmlns="urn:schemas-upnp-org:control-1-0"><errorCode>${code}</errorCode><errorDescription>${escapeXml(description)}</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>`)
}

function stableUuid(seed: string): string {
  const bytes = crypto.createHash('sha1').update(seed).digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function escapeXml(value: unknown): string {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}

function unescapeXml(value: string): string {
  return value.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&amp;', '&')
}

function xml(value: string): string {
  return value
}

function findLanIpv4(): string | null {
  const candidates: string[] = []
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue
      if (entry.address.startsWith('169.254.')) continue
      if (entry.address.startsWith('198.18.') || entry.address.startsWith('198.19.')) continue
      candidates.push(entry.address)
    }
  }
  return candidates.find((address) => address.startsWith('10.') || address.startsWith('192.168.') || is172Private(address)) || candidates[0] || null
}

function is172Private(address: string): boolean {
  const [first, second] = address.split('.').map(Number)
  return first === 172 && Number.isFinite(second) && second >= 16 && second <= 31
}

const AV_TRANSPORT_SCPD = `<?xml version="1.0" encoding="utf-8"?><scpd xmlns="urn:schemas-upnp-org:service-1-0"><specVersion><major>1</major><minor>0</minor></specVersion><actionList><action><name>SetAVTransportURI</name></action><action><name>Play</name></action><action><name>Pause</name></action><action><name>Stop</name></action><action><name>GetTransportInfo</name></action><action><name>GetPositionInfo</name></action><action><name>GetMediaInfo</name></action><action><name>GetCurrentTransportActions</name></action></actionList><serviceStateTable><stateVariable sendEvents="no"><name>A_ARG_TYPE_InstanceID</name><dataType>ui4</dataType></stateVariable></serviceStateTable></scpd>`
const RENDERING_CONTROL_SCPD = `<?xml version="1.0" encoding="utf-8"?><scpd xmlns="urn:schemas-upnp-org:service-1-0"><specVersion><major>1</major><minor>0</minor></specVersion><actionList><action><name>GetVolume</name></action><action><name>SetVolume</name></action><action><name>GetMute</name></action><action><name>SetMute</name></action></actionList><serviceStateTable><stateVariable sendEvents="no"><name>Volume</name><dataType>ui2</dataType></stateVariable></serviceStateTable></scpd>`
const CONNECTION_MANAGER_SCPD = `<?xml version="1.0" encoding="utf-8"?><scpd xmlns="urn:schemas-upnp-org:service-1-0"><specVersion><major>1</major><minor>0</minor></specVersion><actionList><action><name>GetProtocolInfo</name></action><action><name>GetCurrentConnectionIDs</name></action><action><name>GetCurrentConnectionInfo</name></action></actionList><serviceStateTable><stateVariable sendEvents="no"><name>SourceProtocolInfo</name><dataType>string</dataType></stateVariable><stateVariable sendEvents="no"><name>SinkProtocolInfo</name><dataType>string</dataType></stateVariable></serviceStateTable></scpd>`
