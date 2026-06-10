import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res } from '@nestjs/common'
import type { IncomingMessage, ServerResponse } from 'node:http'
import os from 'node:os'
import { Readable } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { cliBridge } from '../cli/cli-bridge'
import {
  MediaService,
  type MediaBookmarkInput,
  type MediaBookmarkQueryInput,
  type MediaBookmarkUpdateInput,
  type MediaPlaylistItem,
  type MediaPlaylistReorderInput,
  type MediaSourceSiteInput,
  type MediaSourceSiteUpdateInput,
} from './media.service'

interface BilibiliAudioResult {
  stream_url?: string
  mime_type?: string
}

interface XiaoAiPlayBody {
  did?: string
  bvid?: string
  title?: string
  quality?: number
}

interface DlnaPlayBody {
  location?: string
  bvid?: string
  title?: string
  quality?: number
}

interface MediaSniffBody {
  url?: string
  max_candidates?: number
  inspect_page?: boolean
}

interface PrepareStreamBody {
  candidate_id?: string
  url?: string
  mime_type?: string
  headers?: Record<string, unknown>
}

interface DlnaPlayUrlBody {
  location?: string
  url?: string
  title?: string
  content_type?: string
  mime_type?: string
}

const BILIBILI_MEDIA_HEADERS = {
  'User-Agent': (
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
    + 'AppleWebKit/537.36 (KHTML, like Gecko) '
    + 'Chrome/120.0.0.0 Safari/537.36'
  ),
  Referer: 'https://www.bilibili.com/',
  Origin: 'https://www.bilibili.com',
  Accept: '*/*',
}

@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Get('bookmarks')
  listBookmarks(@Query() query: MediaBookmarkQueryInput) {
    return this.media.listBookmarks(query)
  }

  @Post('bookmarks')
  addBookmark(@Body() body: MediaBookmarkInput) {
    return this.media.addBookmark(body)
  }

  @Patch('bookmarks/:itemId')
  updateBookmark(@Param('itemId') itemId: string, @Body() body: MediaBookmarkUpdateInput) {
    return this.media.updateBookmark(decodeURIComponent(itemId), body)
  }

  @Delete('bookmarks/:itemId')
  removeBookmark(@Param('itemId') itemId: string) {
    return this.media.removeBookmark(decodeURIComponent(itemId))
  }

  @Post('bookmarks/:itemId/played')
  markBookmarkPlayed(@Param('itemId') itemId: string) {
    return this.media.markBookmarkPlayed(decodeURIComponent(itemId))
  }

  @Get('source-sites')
  listSourceSites() {
    return this.media.listSourceSites()
  }

  @Post('source-sites')
  addSourceSite(@Body() body: MediaSourceSiteInput) {
    return this.media.addSourceSite(body)
  }

  @Patch('source-sites/:siteId')
  updateSourceSite(@Param('siteId') siteId: string, @Body() body: MediaSourceSiteUpdateInput) {
    return this.media.updateSourceSite(Number(siteId), body)
  }

  @Delete('source-sites/:siteId')
  removeSourceSite(@Param('siteId') siteId: string) {
    return this.media.removeSourceSite(Number(siteId))
  }

  @Post('source-sites/:siteId/sniff')
  async sniffSourceSite(@Param('siteId') siteId: string) {
    const id = Number(siteId)
    const site = this.media.getSourceSite(id)
    const result = await this.runSniff(site.url, 20, true)
    const data = result.status === 'success' && result.data && typeof result.data === 'object'
      ? result.data as { candidates?: unknown[] }
      : null
    const candidatesCount = Array.isArray(data?.candidates) ? data.candidates.length : 0
    const updated = this.media.markSourceSiteSniffed(id, candidatesCount)
    return { ...result, site: updated.site }
  }

  @Get('playlist')
  listPlaylist() {
    return this.media.listPlaylist()
  }

  @Post('playlist')
  addPlaylistItem(@Body() body: MediaPlaylistItem) {
    return this.media.addPlaylistItem(body)
  }

  @Patch('playlist/reorder')
  reorderPlaylist(@Body() body: MediaPlaylistReorderInput) {
    return this.media.reorderPlaylist(body)
  }

  @Delete('playlist')
  clearPlaylist() {
    return this.media.clearPlaylist()
  }

  @Delete('playlist/:itemId')
  removePlaylistItem(@Param('itemId') itemId: string) {
    return this.media.removePlaylistItem(decodeURIComponent(itemId))
  }

  @Post('sniff')
  async sniffUrl(@Body() body: MediaSniffBody) {
    const url = String(body.url || '').trim()
    if (!url) return { status: 'error', error: 'INVALID_PARAMS', message: 'url is required' }
    const maxCandidates = Number.isFinite(Number(body.max_candidates)) ? Number(body.max_candidates) : 20
    return this.runSniff(url, maxCandidates, body.inspect_page !== false)
  }

  @Post('streams/prepare')
  prepareStream(@Body() body: PrepareStreamBody, @Req() req: IncomingMessage) {
    return this.media.prepareStream(body, resolvePublicBaseUrl(req))
  }

  @Post('outputs/xiaoai/play-bilibili')
  async playBilibiliOnXiaoAi(@Body() body: XiaoAiPlayBody, @Req() req: IncomingMessage) {
    const did = String(body.did || '').trim()
    const bvid = String(body.bvid || '').trim()
    if (!did) return { status: 'error', error: 'INVALID_PARAMS', message: 'did is required' }
    if (!bvid) return { status: 'error', error: 'INVALID_PARAMS', message: 'bvid is required' }

    const quality = Number.isFinite(Number(body.quality)) ? Number(body.quality) : 64
    const baseUrl = resolvePublicBaseUrl(req)
    const url = `${baseUrl}/api/media/proxy/audio/bilibili/${encodeURIComponent(bvid)}?quality=${encodeURIComponent(String(quality))}`
    const result = await cliBridge.run('mi-cli', 'speaker_play_url', {
      did,
      url,
      title: String(body.title || 'HomeSense Media'),
      bvid,
    })
    return { ...result, proxy_url: url }
  }

  @Post('outputs/dlna/play-bilibili')
  async playBilibiliOnDlna(@Body() body: DlnaPlayBody, @Req() req: IncomingMessage) {
    const location = String(body.location || '').trim()
    const bvid = String(body.bvid || '').trim()
    if (!location) return { status: 'error', error: 'INVALID_PARAMS', message: 'location is required' }
    if (!bvid) return { status: 'error', error: 'INVALID_PARAMS', message: 'bvid is required' }

    const quality = Number.isFinite(Number(body.quality)) ? Number(body.quality) : 64
    const baseUrl = resolvePublicBaseUrl(req)
    const url = `${baseUrl}/api/media/proxy/audio/bilibili/${encodeURIComponent(bvid)}?quality=${encodeURIComponent(String(quality))}`
    const result = await cliBridge.run('media-cli', 'dlna_play_url', {
      location,
      url,
      title: String(body.title || 'HomeSense Media'),
      content_type: 'audio/mpeg',
      bvid,
    })
    return { ...result, proxy_url: url }
  }

  @Post('outputs/dlna/play-url')
  async playUrlOnDlna(@Body() body: DlnaPlayUrlBody, @Req() req: IncomingMessage) {
    const location = String(body.location || '').trim()
    const rawUrl = String(body.url || '').trim()
    if (!location) return { status: 'error', error: 'INVALID_PARAMS', message: 'location is required' }
    if (!rawUrl) return { status: 'error', error: 'INVALID_PARAMS', message: 'url is required' }

    let url: string
    try {
      url = resolvePlaybackUrl(rawUrl, req)
    } catch (error) {
      return {
        status: 'error',
        error: 'INVALID_PARAMS',
        message: error instanceof Error ? error.message : String(error),
      }
    }
    const result = await cliBridge.run('media-cli', 'dlna_play_url', {
      location,
      url,
      title: String(body.title || 'HomeSense Media'),
      content_type: String(body.content_type || body.mime_type || inferContentType(url)),
    })
    return { ...result, url }
  }

  @Get('proxy/audio/bilibili/:bvid')
  async proxyBilibiliAudio(
    @Param('bvid') bvid: string,
    @Query('quality') quality: string | undefined,
    @Req() req: IncomingMessage,
    @Res() res: ServerResponse,
  ) {
    const parsedQuality = Number(quality || 64)
    const resolved = await cliBridge.run('media-cli', 'resolve_audio', {
      bvid,
      quality: Number.isFinite(parsedQuality) ? parsedQuality : 64,
    })

    if (resolved.status !== 'success') {
      sendJson(res, 502, {
        status: 'error',
        error: resolved.error,
        message: resolved.message || 'Failed to resolve Bilibili audio',
      })
      return
    }

    const data = (resolved.data ?? {}) as BilibiliAudioResult
    if (!data.stream_url) {
      sendJson(res, 502, {
        status: 'error',
        error: 'MEDIA_STREAM_MISSING',
        message: 'Resolved audio stream URL is empty',
      })
      return
    }

    const headers: Record<string, string> = { ...BILIBILI_MEDIA_HEADERS }
    const range = req.headers.range
    if (range) headers.Range = range

    let upstream: globalThis.Response
    try {
      upstream = await fetch(data.stream_url, { headers })
    } catch (error) {
      sendJson(res, 502, {
        status: 'error',
        error: 'UPSTREAM_FETCH_FAILED',
        message: error instanceof Error ? error.message : String(error),
      })
      return
    }

    res.statusCode = upstream.status
    setPassthroughHeader(res, 'content-type', upstream.headers.get('content-type') || data.mime_type || 'audio/mpeg')
    setPassthroughHeader(res, 'content-length', upstream.headers.get('content-length'))
    setPassthroughHeader(res, 'content-range', upstream.headers.get('content-range'))
    setPassthroughHeader(res, 'accept-ranges', upstream.headers.get('accept-ranges') || 'bytes')
    res.setHeader('Cache-Control', 'no-store')

    if (!upstream.body) {
      res.end()
      return
    }

    Readable.fromWeb(upstream.body as unknown as NodeReadableStream<Uint8Array>).pipe(res)
  }

  @Get('proxy/stream/:token')
  async proxyPreparedStream(
    @Param('token') token: string,
    @Req() req: IncomingMessage,
    @Res() res: ServerResponse,
  ) {
    let prepared: ReturnType<MediaService['getPreparedStream']>
    try {
      prepared = this.media.getPreparedStream(token)
    } catch (error) {
      sendJson(res, 404, {
        status: 'error',
        error: 'STREAM_NOT_FOUND',
        message: error instanceof Error ? error.message : String(error),
      })
      return
    }

    const headers: Record<string, string> = { ...prepared.headers }
    const range = req.headers.range
    if (range) headers.Range = range

    let upstream: globalThis.Response
    try {
      upstream = await fetch(prepared.upstreamUrl, { headers })
    } catch (error) {
      sendJson(res, 502, {
        status: 'error',
        error: 'UPSTREAM_FETCH_FAILED',
        message: error instanceof Error ? error.message : String(error),
      })
      return
    }

    res.statusCode = upstream.status
    setPassthroughHeader(res, 'content-type', upstream.headers.get('content-type') || prepared.mimeType)
    setPassthroughHeader(res, 'content-length', upstream.headers.get('content-length'))
    setPassthroughHeader(res, 'content-range', upstream.headers.get('content-range'))
    setPassthroughHeader(res, 'accept-ranges', upstream.headers.get('accept-ranges') || 'bytes')
    res.setHeader('Cache-Control', 'no-store')

    if (!upstream.body) {
      res.end()
      return
    }

    Readable.fromWeb(upstream.body as unknown as NodeReadableStream<Uint8Array>).pipe(res)
  }

  private runSniff(url: string, maxCandidates: number, inspectPage: boolean) {
    return cliBridge.run('media-cli', 'sniff_url', {
      url,
      max_candidates: Math.min(50, Math.max(1, maxCandidates)),
      inspect_page: inspectPage,
    })
  }
}

function sendJson(res: ServerResponse, statusCode: number, body: Record<string, unknown>): void {
  res.statusCode = statusCode
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

function setPassthroughHeader(res: ServerResponse, name: string, value: string | null | undefined): void {
  if (!value) return
  res.setHeader(name, value)
}

function resolvePublicBaseUrl(req: IncomingMessage): string {
  const configured = process.env.MEDIA_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL
  if (configured) return configured.replace(/\/$/, '')

  const host = String(req.headers.host || '')
  const port = host.includes(':') ? host.split(':').at(-1) || '3100' : String(process.env.PORT || 3100)
  const ip = findLanIpv4() || '127.0.0.1'
  return `http://${ip}:${port}`
}

function resolvePlaybackUrl(rawUrl: string, req: IncomingMessage): string {
  if (rawUrl.startsWith('/')) return `${resolvePublicBaseUrl(req)}${rawUrl}`
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error('url must be a valid URL')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('url must be an http(s) URL')
  }
  return parsed.toString()
}

function inferContentType(url: string): string {
  const pathname = new URL(url).pathname.toLowerCase()
  if (pathname.endsWith('.mp3')) return 'audio/mpeg'
  if (pathname.endsWith('.m4a')) return 'audio/mp4'
  if (pathname.endsWith('.aac')) return 'audio/aac'
  if (pathname.endsWith('.flac')) return 'audio/flac'
  if (pathname.endsWith('.wav')) return 'audio/wav'
  if (pathname.endsWith('.ogg')) return 'audio/ogg'
  if (pathname.endsWith('.webm')) return 'video/webm'
  if (pathname.endsWith('.mkv')) return 'video/x-matroska'
  if (pathname.endsWith('.mov')) return 'video/quicktime'
  if (pathname.endsWith('.avi')) return 'video/x-msvideo'
  if (pathname.endsWith('.flv')) return 'video/x-flv'
  if (pathname.endsWith('.ts')) return 'video/mp2t'
  if (pathname.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl'
  if (pathname.endsWith('.mpd')) return 'application/dash+xml'
  return 'video/mp4'
}

function findLanIpv4(): string | null {
  const nets = os.networkInterfaces()
  const candidates: string[] = []
  for (const entries of Object.values(nets)) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue
      if (entry.address.startsWith('169.254.')) continue
      if (entry.address.startsWith('198.18.') || entry.address.startsWith('198.19.')) continue
      candidates.push(entry.address)
    }
  }
  return candidates.find(isPrivateLanIpv4) || candidates[0] || null
}

function isPrivateLanIpv4(address: string): boolean {
  if (address.startsWith('10.')) return true
  if (address.startsWith('192.168.')) return true
  const [first, second] = address.split('.').map((part) => Number(part))
  return first === 172 && Number.isFinite(second) && second >= 16 && second <= 31
}
