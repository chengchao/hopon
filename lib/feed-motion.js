// A gesture advances at most one game; short drags settle back in place.
export function snapTarget(origin, position, height, count) {
  const index = Math.round(origin / height);
  const distance = position - origin;
  const step = Math.abs(distance) >= Math.min(80, height * 0.15) ? Math.sign(distance) : 0;
  return Math.max(0, Math.min(count - 1, index + step)) * height;
}
