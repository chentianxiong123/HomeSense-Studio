import { z } from 'zod'

export const DiscoverSchema = z.void()
export const GetPropSchema = z.object({
  did: z.string(),
  siid: z.number(),
  piid: z.number(),
})
export const SetPropSchema = z.object({
  did: z.string(),
  siid: z.number(),
  piid: z.number(),
  value: z.unknown(),
})

export type DiscoverInput = z.infer<typeof DiscoverSchema>
export type GetPropInput = z.infer<typeof GetPropSchema>
export type SetPropInput = z.infer<typeof SetPropSchema>
