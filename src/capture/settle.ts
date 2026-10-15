/** One painted frame: lets the page show a busy button before a long draw holds it. */
export const paint = () => new Promise<void>((res) => requestAnimationFrame(() => setTimeout(res, 0)))

/** A level switch mounts the other scene; give it time to build its lights and textures before drawing. */
export async function settle() {
  await new Promise((r) => setTimeout(r, 400))
  await paint()
  await paint()
}
