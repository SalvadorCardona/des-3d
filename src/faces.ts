import * as THREE from 'three'

/** Position des points sur une grille 4x4, en unités de quart de face. */
const PIPS: Record<number, [number, number][]> = {
  1: [[2, 2]],
  2: [[1, 1], [3, 3]],
  3: [[1, 1], [2, 2], [3, 3]],
  4: [[1, 1], [1, 3], [3, 1], [3, 3]],
  5: [[1, 1], [1, 3], [2, 2], [3, 1], [3, 3]],
  6: [[1, 1], [1, 2], [1, 3], [3, 1], [3, 2], [3, 3]],
}

const IVORY = '#f5f1e6'
const INK = '#1b1b1f'

/** Dessine une face de dé dans un canvas, sans aucun asset à télécharger. */
export function faceTexture(n: number): THREE.Texture {
  const s = 256
  const c = document.createElement('canvas')
  c.width = c.height = s
  const g = c.getContext('2d')!

  g.fillStyle = IVORY
  g.fillRect(0, 0, s, s)
  g.fillStyle = INK
  for (const [x, y] of PIPS[n]) {
    g.beginPath()
    g.arc((x * s) / 4, (y * s) / 4, s * 0.075, 0, Math.PI * 2)
    g.fill()
  }

  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

/**
 * BoxGeometry ordonne ses groupes de matériaux : +X, -X, +Y, -Y, +Z, -Z.
 * Les valeurs sont réparties pour que deux faces opposées somment à 7,
 * comme sur un vrai dé.
 */
export const FACE_ORDER = [3, 4, 1, 6, 2, 5]

const AXES: [THREE.Vector3, number][] = [
  [new THREE.Vector3(1, 0, 0), 3],
  [new THREE.Vector3(-1, 0, 0), 4],
  [new THREE.Vector3(0, 1, 0), 1],
  [new THREE.Vector3(0, -1, 0), 6],
  [new THREE.Vector3(0, 0, 1), 2],
  [new THREE.Vector3(0, 0, -1), 5],
]

const scratch = new THREE.Vector3()

/** Face tournée vers le haut : la normale locale dont l'image monde a le plus grand Y. */
export function readValue(q: THREE.Quaternion): number {
  let best = -Infinity
  let value = 1
  for (const [normal, face] of AXES) {
    const y = scratch.copy(normal).applyQuaternion(q).y
    if (y > best) {
      best = y
      value = face
    }
  }
  return value
}
