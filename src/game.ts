import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import type RAPIER from '@dimforge/rapier3d-compat'

import { FACE_ORDER, faceTexture, readValue } from './faces'
import { buzz } from './haptics'

const HALF = 0.5 // demi-arête d'un dé
const MAX_DICE = 6

// La profondeur du tapis est fixe ; sa largeur suit le format de l'écran,
// pour que les dés restent cadrés aussi bien en portrait qu'en paysage.
const HALF_DEPTH = 4
const MIN_HALF_WIDTH = 2.4
const MAX_HALF_WIDTH = 6
const WALL_HALF_HEIGHT = 4 // murs assez hauts pour qu'un dé ne se pose jamais dessus

const SPAWN_MIN_Y = 2.6
const SPAWN_STAGGER = 0.55 // décalage vertical entre deux dés d'un même lancer
const SPAWN_MARGIN = 1.2 // écart minimal entre un dé et un mur au moment du lâcher

const LINEAR_DAMPING = 0.2
const ANGULAR_DAMPING = 0.5

const FIXED_STEP = 1 / 60
const MAX_CATCH_UP = 0.25 // rattrapage plafonné : pas de spirale après un onglet en arrière-plan

// Seuils d'immobilité, en temps simulé. Rapier endort les corps, mais un dé
// calé dans un angle peut vibrer indéfiniment : on lit le résultat dès que
// plus rien ne bouge, et au plus tard après ROLL_TIMEOUT.
const STILL_LINEAR = 0.08
const STILL_ANGULAR = 0.15
const STILL_DWELL = 0.3
const ROLL_TIMEOUT = 8

type Die = { mesh: THREE.Mesh; body: RAPIER.RigidBody }

const rand = (a: number, b: number) => a + Math.random() * (b - a)
const length = (v: { x: number; y: number; z: number }) => Math.hypot(v.x, v.y, v.z)

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
  private sideWalls: RAPIER.Collider[] = []

  private dice: Die[] = []
  private count = 2
  private halfWidth = 3
  private settled = true
  private stillSince = 0
  private rollStartedAt = 0
  private lastImpactAt = 0
  private lastFrameAt = performance.now()
  private accumulator = 0
  private simTime = 0

  /** Appelé une fois que tous les dés se sont immobilisés. */
  onSettle: (values: number[]) => void = () => {}
  /** Appelé pendant qu'un lancer est en cours. */
  onRolling: () => void = () => {}

  constructor(container: HTMLElement) {
    this.scene.background = new THREE.Color('#10131a')

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    container.appendChild(this.renderer.domElement)

    this.scene.add(new THREE.HemisphereLight('#ffffff', '#2a2f3a', 1.1))
    const key = new THREE.DirectionalLight('#ffffff', 2.2)
    key.position.set(5, 12, 5)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.camera.left = -10
    key.shadow.camera.right = 10
    key.shadow.camera.top = 10
    key.shadow.camera.bottom = -10
    key.shadow.camera.far = 40
    this.scene.add(key)

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 60),
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

    this.layout()
    addEventListener('resize', () => this.layout())
    this.renderer.setAnimationLoop(() => this.frame())
  }

  /** Charge Rapier à la demande, puis crée le monde, le tapis et les dés. */
  async start(): Promise<void> {
    const mod = await import('@dimforge/rapier3d-compat')
    const rapier = mod.default
    await rapier.init()

    this.rapier = rapier
    this.world = new rapier.World({ x: 0, y: -9.81, z: 0 })
    this.world.timestep = FIXED_STEP
    this.events = new rapier.EventQueue(true)
    this.lastFrameAt = performance.now()

    const { ColliderDesc } = rapier
    this.world.createCollider(ColliderDesc.cuboid(30, 0.1, 30).setTranslation(0, -0.1, 0))

    const span = MAX_HALF_WIDTH + 1
    this.sideWalls = [
      this.world.createCollider(
        ColliderDesc.cuboid(0.1, WALL_HALF_HEIGHT, HALF_DEPTH + 1).setTranslation(
          -this.halfWidth,
          WALL_HALF_HEIGHT,
          0,
        ),
      ),
      this.world.createCollider(
        ColliderDesc.cuboid(0.1, WALL_HALF_HEIGHT, HALF_DEPTH + 1).setTranslation(
          this.halfWidth,
          WALL_HALF_HEIGHT,
          0,
        ),
      ),
    ]
    for (const z of [-HALF_DEPTH, HALF_DEPTH]) {
      this.world.createCollider(
        ColliderDesc.cuboid(span, WALL_HALF_HEIGHT, 0.1).setTranslation(0, WALL_HALF_HEIGHT, z),
      )
    }

    this.setCount(this.count)
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

      // L'amortissement dissipe l'énergie résiduelle : sans lui, un dé calé
      // contre un mur ou sur un autre dé peut vibrer sans jamais s'endormir.
      const body = this.world.createRigidBody(
        RigidBodyDesc.dynamic()
          .setTranslation(0, 3, 0)
          .setLinearDamping(LINEAR_DAMPING)
          .setAngularDamping(ANGULAR_DAMPING),
      )
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

    // Les dés tombent en cascade : espacés sur la largeur utile, et surtout
    // décalés en hauteur. Alignés à la même altitude dans un tapis étroit, ils
    // se coincent les uns contre les autres et restent bloqués en l'air.
    const safeX = Math.max(this.halfWidth - SPAWN_MARGIN, 0.001)
    const spread = Math.min(1.6, (safeX * 2) / Math.max(this.count - 1, 1))
    const quaternion = new THREE.Quaternion()

    this.dice.forEach(({ body }, i) => {
      body.setTranslation(
        {
          x: (i - (this.count - 1) / 2) * spread,
          y: SPAWN_MIN_Y + i * SPAWN_STAGGER + rand(0, 0.3),
          z: rand(-1.2, 1.2),
        },
        true,
      )
      // Quaternion.random() tire une rotation uniforme sur SO(3) ; trois angles
      // d'Euler uniformes ne le seraient pas et biaiseraient les faces.
      body.setRotation(quaternion.random(), true)
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
    this.stillSince = 0
    this.rollStartedAt = this.simTime
    this.onRolling()
    buzz('medium')
  }

  /**
   * Recule la caméra juste ce qu'il faut pour voir toute la profondeur du tapis,
   * puis élargit ou resserre les murs selon le format de l'écran.
   */
  private layout() {
    const aspect = innerWidth / innerHeight
    this.camera.aspect = aspect
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(innerWidth, innerHeight)

    const distance = HALF_DEPTH / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2))
    this.camera.position.set(0, distance * 0.76, distance * 0.65)
    this.camera.lookAt(0, 0, 0)

    this.halfWidth = THREE.MathUtils.clamp(HALF_DEPTH * aspect, MIN_HALF_WIDTH, MAX_HALF_WIDTH)
    this.sideWalls[0]?.setTranslation({ x: -this.halfWidth, y: WALL_HALF_HEIGHT, z: 0 })
    this.sideWalls[1]?.setTranslation({ x: this.halfWidth, y: WALL_HALF_HEIGHT, z: 0 })
  }

  /**
   * La physique avance à pas fixe, rattrapé sur le temps réellement écoulé.
   * Un pas par image ferait ralentir la simulation dès que le navigateur
   * bride les images — onglet en arrière-plan, appareil chargé — et les dés
   * se figeraient en l'air.
   */
  private frame() {
    const now = performance.now()
    const elapsed = Math.min((now - this.lastFrameAt) / 1000, MAX_CATCH_UP)
    this.lastFrameAt = now

    if (this.world) {
      this.accumulator += elapsed
      while (this.accumulator >= FIXED_STEP) {
        this.world.step(this.events ?? undefined)
        this.accumulator -= FIXED_STEP
        this.simTime += FIXED_STEP
        this.drainImpacts()
      }

      for (const { mesh, body } of this.dice) {
        const t = body.translation()
        const r = body.rotation()
        mesh.position.set(t.x, t.y, t.z)
        mesh.quaternion.set(r.x, r.y, r.z, r.w)
      }

      if (!this.settled) this.checkSettled()
    }

    this.renderer.render(this.scene, this.camera)
  }

  /** Tout est mesuré en temps simulé, jamais en temps réel : le résultat ne dépend pas du framerate. */
  private checkSettled() {
    const moving = this.dice.some(
      ({ body }) =>
        !body.isSleeping() &&
        (length(body.linvel()) > STILL_LINEAR || length(body.angvel()) > STILL_ANGULAR),
    )

    if (moving) {
      this.stillSince = 0
      if (this.simTime - this.rollStartedAt < ROLL_TIMEOUT) return
    } else if (!this.stillSince) {
      this.stillSince = this.simTime
      return
    } else if (this.simTime - this.stillSince < STILL_DWELL) {
      return
    }

    this.settled = true
    const q = new THREE.Quaternion()
    const values = this.dice.map(({ body }) => {
      body.sleep() // rien ne bouge plus : on rend la main au GPU et à la batterie
      const r = body.rotation()
      return readValue(q.set(r.x, r.y, r.z, r.w))
    })
    this.onSettle(values)
  }

  /** Un petit coup haptique au contact, limité pour rester lisible. */
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
