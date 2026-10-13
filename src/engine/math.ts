export const TAU = Math.PI * 2

export function gcd(a: number, b: number): number {
  a = Math.abs(a)
  b = Math.abs(b)
  while (b) [a, b] = [b, a % b]
  return a
}

export function lcm(a: number, b: number): number {
  return (a / gcd(a, b)) * b
}

/** Ramanujan's second approximation; exact for a circle. */
export function ellipsePerimeter(r1: number, r2: number): number {
  const h = ((r1 - r2) / (r1 + r2)) ** 2
  return Math.PI * (r1 + r2) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)))
}

/** Signed volume of a closed, consistently oriented triangle mesh (divergence theorem). */
export function signedVolume(positions: ArrayLike<number>, indices: ArrayLike<number>): number {
  let v = 0
  for (let i = 0; i < indices.length; i += 3) {
    const a = 3 * indices[i]!, b = 3 * indices[i + 1]!, c = 3 * indices[i + 2]!
    const ax = positions[a]!, ay = positions[a + 1]!, az = positions[a + 2]!
    const bx = positions[b]!, by = positions[b + 1]!, bz = positions[b + 2]!
    const cx = positions[c]!, cy = positions[c + 1]!, cz = positions[c + 2]!
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)
  }
  return v / 6
}
