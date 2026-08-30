type MotionEventCtor = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>
}

const THRESHOLD = 18 // m/s², au-delà de la gravité
const COOLDOWN = 700

/** iOS 13+ exige un appel explicite, déclenché par un geste de l'utilisateur. */
export function shakeNeedsPermission(): boolean {
  const ctor = DeviceMotionEvent as MotionEventCtor
  return typeof ctor?.requestPermission === 'function'
}

export async function requestShakePermission(): Promise<boolean> {
  const ctor = DeviceMotionEvent as MotionEventCtor
  if (typeof ctor?.requestPermission !== 'function') return true
  try {
    return (await ctor.requestPermission()) === 'granted'
  } catch {
    return false
  }
}

/** Secouer l'appareil relance les dés, avec une force proportionnelle au geste. */
export function listenForShake(onShake: (force: number) => void): () => void {
  let last = 0
  const handler = (e: DeviceMotionEvent) => {
    const a = e.acceleration
    if (!a) return
    const magnitude = Math.hypot(a.x ?? 0, a.y ?? 0, a.z ?? 0)
    if (magnitude < THRESHOLD) return

    const now = Date.now()
    if (now - last < COOLDOWN) return
    last = now
    onShake(Math.min(magnitude / THRESHOLD, 2.5))
  }

  addEventListener('devicemotion', handler)
  return () => removeEventListener('devicemotion', handler)
}
