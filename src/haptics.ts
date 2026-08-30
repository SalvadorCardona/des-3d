import { Capacitor } from '@capacitor/core'

type Strength = 'light' | 'medium' | 'heavy'

let impact: ((opts: { style: unknown }) => Promise<void>) | null = null
let styles: Record<string, unknown> = {}

/**
 * Charge le plugin natif une seule fois, et seulement sur mobile :
 * sur le web, l'import est évité et on retombe sur navigator.vibrate.
 */
async function nativeImpact(strength: Strength) {
  if (!impact) {
    const mod = await import('@capacitor/haptics')
    impact = (o) => mod.Haptics.impact(o as never)
    styles = {
      light: mod.ImpactStyle.Light,
      medium: mod.ImpactStyle.Medium,
      heavy: mod.ImpactStyle.Heavy,
    }
  }
  await impact({ style: styles[strength] })
}

const WEB_FALLBACK: Record<Strength, number> = { light: 8, medium: 18, heavy: 35 }

/** Retour haptique, natif si disponible, vibration web sinon, silencieux à défaut. */
export function buzz(strength: Strength = 'light') {
  if (Capacitor.isNativePlatform()) {
    void nativeImpact(strength).catch(() => {})
    return
  }
  navigator.vibrate?.(WEB_FALLBACK[strength])
}
