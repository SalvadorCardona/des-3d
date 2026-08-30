/**
 * Test de la simulation, hors navigateur.
 *
 * Rejoue le monde du jeu des milliers de fois et vérifie trois choses qu'on ne
 * peut pas voir à l'œil sur un lancer isolé :
 *   1. chaque lancer finit par s'immobiliser (aucun dé bloqué en l'air) ;
 *   2. aucun dé ne sort du tapis ;
 *   3. les six faces sortent à la même fréquence (test du khi-deux).
 *
 *   node scripts/verify-physics.mts               # 600 lancers
 *   RUNS=5000 SEED=7 node scripts/verify-physics.mts
 *
 * Le tirage est déterministe : à graine égale, le verdict est reproductible.
 * Une régression fait donc échouer la CI de façon stable, jamais par hasard.
 */
import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'

import { readValue } from '../src/faces.ts'

// Doivent rester alignés sur src/game.ts.
const HALF = 0.5
const HALF_DEPTH = 4
const WALL_HALF_HEIGHT = 4
const SPAWN_MIN_Y = 2.6
const SPAWN_STAGGER = 0.55
const SPAWN_MARGIN = 1.2
const LINEAR_DAMPING = 0.2
const ANGULAR_DAMPING = 0.5
const FIXED_STEP = 1 / 60
const STILL_LINEAR = 0.08
const STILL_ANGULAR = 0.15
const STILL_DWELL = 0.3
const ROLL_TIMEOUT = 8

const RUNS = Number(process.env.RUNS ?? 600)
const SEED = Number(process.env.SEED ?? 1)

/** mulberry32 : générateur court et reproductible, branché à la place de Math.random. */
function seeded(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
Math.random = seeded(SEED)

// Valeur critique du khi-deux à 5 degrés de liberté, seuil 0,1 % : un jeu
// équitable ne dépasse ce seuil qu'une fois sur mille.
const CHI2_CRITICAL = 20.515

const rand = (a: number, b: number) => a + Math.random() * (b - a)
const norm = (v: { x: number; y: number; z: number }) => Math.hypot(v.x, v.y, v.z)

await RAPIER.init()

function roll(count: number, halfWidth: number) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  world.timestep = FIXED_STEP

  world.createCollider(RAPIER.ColliderDesc.cuboid(30, 0.1, 30).setTranslation(0, -0.1, 0))
  for (const x of [-halfWidth, halfWidth]) {
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.1, WALL_HALF_HEIGHT, HALF_DEPTH + 1).setTranslation(
        x,
        WALL_HALF_HEIGHT,
        0,
      ),
    )
  }
  for (const z of [-HALF_DEPTH, HALF_DEPTH]) {
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(7, WALL_HALF_HEIGHT, 0.1).setTranslation(0, WALL_HALF_HEIGHT, z),
    )
  }

  const safeX = Math.max(halfWidth - SPAWN_MARGIN, 0.001)
  const spread = Math.min(1.6, (safeX * 2) / Math.max(count - 1, 1))
  const bodies: RAPIER.RigidBody[] = []

  for (let i = 0; i < count; i++) {
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(
          (i - (count - 1) / 2) * spread,
          SPAWN_MIN_Y + i * SPAWN_STAGGER + rand(0, 0.3),
          rand(-1.2, 1.2),
        )
        .setLinearDamping(LINEAR_DAMPING)
        .setAngularDamping(ANGULAR_DAMPING),
    )
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(HALF, HALF, HALF).setRestitution(0.35).setFriction(0.7),
      body,
    )
    body.setRotation(new THREE.Quaternion().random(), true)
    body.applyImpulse({ x: rand(-1.8, 1.8), y: rand(-1, 0), z: rand(-1.8, 1.8) }, true)
    body.applyTorqueImpulse({ x: rand(-0.4, 0.4), y: rand(-0.4, 0.4), z: rand(-0.4, 0.4) }, true)
    bodies.push(body)
  }

  let simTime = 0
  let stillSince = 0
  let timedOut = false
  for (;;) {
    world.step()
    simTime += FIXED_STEP

    const moving = bodies.some(
      (b) =>
        !b.isSleeping() && (norm(b.linvel()) > STILL_LINEAR || norm(b.angvel()) > STILL_ANGULAR),
    )
    if (moving) {
      stillSince = 0
      if (simTime >= ROLL_TIMEOUT) {
        timedOut = true
        break
      }
      continue
    }
    if (!stillSince) stillSince = simTime
    else if (simTime - stillSince >= STILL_DWELL) break
  }

  const q = new THREE.Quaternion()
  const dice = bodies.map((b) => {
    const t = b.translation()
    const r = b.rotation()
    return { x: t.x, y: t.y, z: t.z, value: readValue(q.set(r.x, r.y, r.z, r.w)) }
  })
  world.free()
  return { simTime, timedOut, dice }
}

const faces: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 }
let timeouts = 0
let escaped = 0
let slowest = 0

// On balaie toutes les combinaisons nombre de dés x largeur de tapis, portrait compris.
const WIDTHS = [2.4, 3, 4, 5, 6]
for (let i = 0; i < RUNS; i++) {
  const count = 1 + (i % 6)
  const halfWidth = WIDTHS[i % WIDTHS.length]
  const result = roll(count, halfWidth)

  if (result.timedOut) timeouts++
  slowest = Math.max(slowest, result.simTime)
  for (const d of result.dice) {
    faces[d.value]++
    if (Math.abs(d.x) > halfWidth + 0.2 || Math.abs(d.z) > HALF_DEPTH + 0.2 || d.y < 0.4) escaped++
  }
}

const total = Object.values(faces).reduce((a, b) => a + b, 0)
const expected = total / 6
const chi2 = Object.values(faces).reduce((sum, n) => sum + (n - expected) ** 2 / expected, 0)

console.log(`graine             : ${SEED}`)
console.log(`lancers            : ${RUNS}`)
console.log(`dés simulés        : ${total}`)
console.log(`lancers sans repos : ${timeouts}`)
console.log(`dés hors du tapis  : ${escaped}`)
console.log(`repos le plus long : ${slowest.toFixed(2)} s simulées`)
console.log(
  `répartition        : ${Object.entries(faces)
    .map(([face, n]) => `${face}=${((100 * n) / total).toFixed(1)}%`)
    .join('  ')}`,
)
console.log(`khi-deux (5 ddl)   : ${chi2.toFixed(2)} (rejet au-delà de ${CHI2_CRITICAL})`)

const failures: string[] = []
if (timeouts > 0) failures.push(`${timeouts} lancer(s) ne se sont jamais immobilisés`)
if (escaped > 0) failures.push(`${escaped} dé(s) sont sortis du tapis`)
if (chi2 > CHI2_CRITICAL) failures.push(`les faces ne sortent pas équitablement (khi-deux ${chi2.toFixed(2)})`)

if (failures.length) {
  console.error('\nÉCHEC :\n- ' + failures.join('\n- '))
  process.exit(1)
}
console.log('\nOK')
