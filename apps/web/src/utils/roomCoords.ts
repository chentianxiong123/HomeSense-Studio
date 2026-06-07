// Helpers for converting between canvas-pixel coordinates and room-relative
// ratios. The convention: device position is always stored as a 0..1 ratio
// of the parent room's width/height, never as a canvas-pixel offset.

export type DeviceRatio = { x: number; y: number }

export function pixelToRatio(
  canvasX: number,
  canvasY: number,
  roomX: number,
  roomY: number,
  roomW: number,
  roomH: number
): DeviceRatio {
  if (roomW <= 0 || roomH <= 0) return { x: 0, y: 0 }
  return {
    x: (canvasX - roomX) / roomW,
    y: (canvasY - roomY) / roomH,
  }
}

export function ratioToPixel(
  rx: number,
  ry: number,
  roomX: number,
  roomY: number,
  roomW: number,
  roomH: number
): { x: number; y: number } {
  return {
    x: roomX + rx * roomW,
    y: roomY + ry * roomH,
  }
}

// Heuristic: a value is "ratio" if it's clearly within [0, 5] and not a
// pixel magnitude. Used to detect already-migrated vs legacy data.
export function looksLikeRatio(value: number | undefined | null): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 5
}

export function clampRatio(rx: number, ry: number): DeviceRatio {
  return {
    x: Math.max(-0.5, Math.min(rx, 1.5)),
    y: Math.max(-0.5, Math.min(ry, 1.5)),
  }
}
