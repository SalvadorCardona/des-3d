const KEY = 'des3d.history.v1'
const MAX = 30

export type Roll = { values: number[]; total: number; at: number }

/** Historique des lancers, conservé localement. Aucune donnée ne quitte l'appareil. */
export function loadHistory(): Roll[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Roll[]) : []
  } catch {
    return []
  }
}

export function pushRoll(history: Roll[], values: number[]): Roll[] {
  const next = [
    { values, total: values.reduce((a, b) => a + b, 0), at: Date.now() },
    ...history,
  ].slice(0, MAX)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // stockage indisponible (mode privé) : l'historique reste en mémoire
  }
  return next
}

export function clearHistory(): Roll[] {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // rien à faire
  }
  return []
}
