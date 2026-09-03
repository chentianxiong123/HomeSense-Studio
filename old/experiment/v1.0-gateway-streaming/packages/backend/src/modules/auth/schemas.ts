import { z } from 'zod'

export const LoginQrSchema = z.void()
export const LoginStatusSchema = z.void()
export const LoginLogoutSchema = z.void()

export type LoginQrInput = z.infer<typeof LoginQrSchema>
export type LoginStatusInput = z.infer<typeof LoginStatusSchema>
export type LoginLogoutInput = z.infer<typeof LoginLogoutSchema>
