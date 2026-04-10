export class SseEmitter {
  private chunks: string[] = [];
  private reply: any;
  private isOpen = false;

  constructor(reply: any) {
    this.reply = reply;
  }

  start(): void {
    this.isOpen = true;
    this.reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });
  }

  emit(event: string, data: any): void {
    if (!this.isOpen) return;
    const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    this.reply.raw.write(line);
  }

  emitChunk(content: string): void {
    if (!this.isOpen) return;
    const line = `event: chunk\ndata: ${JSON.stringify({ content })}\n\n`;
    this.reply.raw.write(line);
  }

  emitStep(step: any): void {
    if (!this.isOpen) return;
    const line = `event: step\ndata: ${JSON.stringify(step)}\n\n`;
    this.reply.raw.write(line);
  }

  emitDone(data: any): void {
    if (!this.isOpen) return;
    const line = `event: done\ndata: ${JSON.stringify(data)}\n\n`;
    this.reply.raw.write(line);
  }

  emitError(message: string): void {
    if (!this.isOpen) return;
    const line = `event: error\ndata: ${JSON.stringify({ message })}\n\n`;
    this.reply.raw.write(line);
  }

  end(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.reply.raw.write("event: close\ndata: {}\n\n");
    this.reply.raw.end();
  }

  isActive(): boolean {
    return this.isOpen;
  }
}
