import type { FastifyInstance } from 'fastify'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { RoomService } from '../../nest/modules/room/room.service.js'

const roomService = new RoomService()

export async function roomRoutes(app: FastifyInstance) {
  app.get('/api/rooms', async () => {
    return { rooms: roomService.list() }
  })

  app.get('/api/rooms/:id', async (request) => {
    const { id } = request.params as { id: string }
    try {
      return { room: roomService.get(Number(id)) }
    } catch (error) {
      if (error instanceof NotFoundException) {
        return { status: 'error', error: 'NOT_FOUND' }
      }
      throw error
    }
  })

  app.post('/api/rooms', async (request) => {
    const body = request.body as { name?: string }
    try {
      const room = roomService.create({ name: body?.name ?? '' })
      return { status: 'success', data: { room } }
    } catch (error) {
      if (error instanceof BadRequestException) {
        return { status: 'error', error: 'INVALID_PARAMS', message: 'Name is required' }
      }
      throw error
    }
  })

  app.put('/api/rooms/:id', async (request) => {
    const { id } = request.params as { id: string }
    const body = request.body as { name?: string }
    try {
      const room = roomService.update(Number(id), { name: body?.name })
      return { status: 'success', data: { room } }
    } catch (error) {
      if (error instanceof BadRequestException) {
        return { status: 'error', error: 'INVALID_PARAMS', message: 'Name is required' }
      }
      if (error instanceof NotFoundException) {
        return { status: 'error', error: 'NOT_FOUND' }
      }
      throw error
    }
  })

  app.delete('/api/rooms/:id', async (request) => {
    const { id } = request.params as { id: string }
    try {
      roomService.remove(Number(id))
      return { status: 'success' }
    } catch (error) {
      if (error instanceof NotFoundException) {
        return { status: 'error', error: 'NOT_FOUND' }
      }
      throw error
    }
  })
}
