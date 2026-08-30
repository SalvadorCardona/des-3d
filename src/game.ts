import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import type RAPIER from '@dimforge/rapier3d-compat'

import { FACE_ORDER, faceTexture, readValue } from './faces'
import { buzz } from './haptics'

const HALF = 0.5 // demi-arête d'un dé
const MAX_DICE = 6
const ARENA_X = 5
const ARENA_Z = 4

type Die = { mesh: THREE.Mesh; body: RAPIER.RigidBody }

const rand = (a: number, b: number) => a + Math.random() * (b - a)

/**
 * Le rendu démarre immédiatement ; la physique est branchée plus tard,
 * quand le module WASM de Rapier a fini de charger.
 */
export class DiceGame {
  readonly scene = new THREE.Scene()

  private readonly camera: THREE.PerspectiveCamera
  private readonly renderer: THREE.WebGLRenderer
  private readonly geometry: THREE.BufferGeometry
  private readonly materials: THREE.Material[]

  private rapier: typeof RAPIER | null = null
  private world: RAPIER.World | null = null
  private events: RAPIER.EventQueue | null = null

  private dice: Die[] = []
  private count = 2
  private settled = true
  private lastImpactAt = 0

  /** Appelé une fois que tous les dés se sont immobilisés. */
  onSettle: (values: number[]) => void = () => {}
  /** Appelé pendant qu'un lancer est en cours. */
  onRolling: () => void = () => {}

  constructor(container: HTMLElement) {
    this.scene.background = new THREE.Color('#10131a')

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
    this.camera.position.set(0, 7.5, 6.5)
    this.camera.lookAt(0, 0, 0)

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    container.appendChild(this.renderer.domElement)

    this.scene.add(new THREE.HemisphereLight('#ffffff', '#2a2f3a', 1.1))
    const key = new THREE.DirectionalLight('#ffffff', 2.2)
    key.position.set(4, 9, 4)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    key.shadow.camera.left = -8
    key.shadow.camera.right = 8
    key.shadow.camera.top = 8
    key.shadow.camera.bottom = -8
    this.scene.add(key)

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.ShadowMaterial({ opacity: 0.4 }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    this.scene.add(floor)

    this.materials = FACE_ORDER.map(
      (n) =>
        new THREE.MeshStandardMaterial({ map: faceTexture(n), roughness: 0.45, metalness: 0.05 }),
    )
    this.geometry = new RoundedBoxGeometry(HALF * 2, HALF * 2, HALF * 2, 4, HALF * 0.18)

    this.resize()
    addEventListener('resize', () => this.resize())
    this.renderer.setAnimationLoop(() => this.frame())
  }

  /** Charge Rapier à la demande, puis crée le monde et les dés. */
  async start(): Promise<void> {
    const mod = await import('@dimforge/rapier3d-compat')
    await mod.default.init()

    this.rapier = mod.default
    this.world = new mod.default.World({ x: 0, y: -9.81, z: 0 })
    this.events = new mod.default.EventQueue(true)

    const { ColliderDesc } = mod.default
    this.world.createCollider(ColliderDesc.cuboid(20, 0.1, 20).setTranslation(0, -0.1, 0))

    // Murs invisibles : les dés restent dans le champ de la caméra.
    const walls: [number, number, number, number, number, number][] = [
      [0.1, 2.5, ARENA_Z + 1, -ARENA_X, 2.5, 0],
      [0.1, 2.5, ARENA_Z + 1, ARENA_X, 2.5, 0],
      [ARENA_X + 1, 2.5, 0.1, 0, 2.5, -ARENA_Z],
      [ARENA_X + 1, 2.5, 0.1, 0, 2.5, ARENA_Z],
    ]
    for (const [hx, hy, hz, x, y, z] of walls) {
      this.world.createCollider(ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z))
    }

    this.setCount(this.count)
    this.roll()
  }

  get diceCount(): number {
    return this.count
  }

  setCount(n: number): void {
    this.count = Math.min(Math.max(n, 1), MAX_DICE)
    if (!this.world || !this.rapier) return

    for (const { mesh, body } of this.dice) {
      this.scene.remove(mesh)
      this.world.removeRigidBody(body)
    }
    this.dice = []

    const { RigidBodyDesc, ColliderDesc, ActiveEvents } = this.rapier
    for (let i = 0; i < this.count; i++) {
      const mesh = new THREE.Mesh(this.geometry, this.materials)
      mesh.castShadow = true
      this.scene.add(mesh)

      const body = this.world.createRigidBody(RigidBodyDesc.dynamic().setTranslation(0, 4, 0))
      this.world.createCollider(
        ColliderDesc.cuboid(HALF, HALF, HALF)
          .setRestitution(0.35)
          .setFriction(0.7)
          .setActiveEvents(ActiveEvents.COLLISION_EVENTS),
        body,
      )
      this.dice.push({ mesh, body })
    }
    this.roll()
  }

  /** Relance tous les dés depuis une position et une orientation aléatoires. */
  roll(force = 1): void {
    if (!this.dice.length) return

    const spread = 1.4
    this.dice.forEach(({ body }, i) => {
      body.setTranslation(
        {
          x: (i - (this.count - 1) / 2) * spread,
          y: rand(3.5, 5),
          z: rand(-1, 1),
        },
        true,
      )
      body.setRotation(
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(rand(0, Math.PI * 2), rand(0, Math.PI * 2), rand(0, Math.PI * 2)),
        ),
        true,
      )
      body.setLinvel({ x: 0, y: 0, z: 0 }, true)
      body.setAngvel({ x: 0, y: 0, z: 0 }, true)
      body.applyImpulse(
        { x: rand(-1.8, 1.8) * force, y: rand(-1, 0), z: rand(-1.8, 1.8) * force },
        true,
      )
      body.applyTorqueImpulse(
        { x: rand(-0.4, 0.4) * force, y: rand(-0.4, 0.4) * force, z: rand(-0.4, 0.4) * force },
        true,
      )
    })

    this.settled = false
    this.onRolling()
    buzz('medium')
  }

  private resize() {
    const w = innerWidth
    const h = innerHeight
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
  }

  private frame() {
    if (this.world) {
      this.world.step(this.events ?? undefined)
      this.drainImpacts()

      for (const { mesh, body } of this.dice) {
        const t = body.translation()
        const r = body.rotation()
        mesh.position.set(t.x, t.y, t.z)
        mesh.quaternion.set(r.x, r.y, r.z, r.w)
      }

      if (!this.settled && this.dice.every(({ body }) => body.isSleeping())) {
        this.settled = true
        const q = new THREE.Quaternion()
        this.onSettle(
          this.dice.map(({ body }) => {
            const r = body.rotation()
            return readValue(q.set(r.x, r.y, r.z, r.w))
          }),
        )
      }
    }

    this.renderer.render(this.scene, this.camera)
  }

  /** Un petit coup haptique au contact, limité à 12 par seconde pour rester lisible. */
  private drainImpacts() {
    if (!this.events) return
    let hit = false
    this.events.drainCollisionEvents((_a, _b, started) => {
      if (started) hit = true
    })
    const now = performance.now()
    if (hit && now - this.lastImpactAt > 80) {
      this.lastImpactAt = now
      buzz('light')
    }
  }
}
