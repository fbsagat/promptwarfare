export function applyPointerLookDelta(
  yaw: number,
  pitch: number,
  dx: number,
  dy: number,
  sensitivity: number,
): { yaw: number; pitch: number } {
  const clampedDx = Math.max(-120, Math.min(120, Number.isFinite(dx) ? dx : 0));
  const clampedDy = Math.max(-120, Math.min(120, Number.isFinite(dy) ? dy : 0));
  const nextYaw = yaw + clampedDx * sensitivity;
  const nextPitch = Math.max(-1.45, Math.min(1.45, pitch + clampedDy * sensitivity));
  return { yaw: nextYaw, pitch: nextPitch };
}

export function computeUnlockedEdgeTurn(
  clientX: number,
  rectLeft: number,
  rectWidth: number,
  marginFraction = 0.08,
): number {
  if (!Number.isFinite(rectWidth) || rectWidth <= 0 || marginFraction <= 0) {
    return 0;
  }
  const u = (clientX - rectLeft) / rectWidth;
  if (u < marginFraction) {
    return -Math.min(1, Math.max(0, (marginFraction - u) / marginFraction));
  }
  if (u > 1 - marginFraction) {
    return Math.min(1, Math.max(0, (u - (1 - marginFraction)) / marginFraction));
  }
  return 0;
}
