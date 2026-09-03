declare module 'adbkit' {
  interface AdbDeviceRaw {
    id: string
    type?: string
    properties?: Record<string, string>
  }

  interface AdbClient {
    listDevices(): Promise<AdbDeviceRaw[]>
    connect(host: string, port: number): Promise<string>
    disconnect(host: string, port: number): Promise<void>
    disconnect(serial: string): Promise<void>
    shell(serial: string, command: string): Promise<NodeJS.ReadableStream>
  }

  interface AdbUtil {
    readAll(stream: NodeJS.ReadableStream): Promise<Buffer>
  }

  function createClient(opts?: { host?: string; port?: number; binary?: string }): AdbClient
  const util: AdbUtil

  const adbkit: {
    createClient: typeof createClient
    util: AdbUtil
  }
  export default adbkit
}
