import * as THREE from "three";

/* ------------------------------------------------------------------ */
/*  Public types shared with the React UI                               */
/* ------------------------------------------------------------------ */

export type Screen = "menu" | "playing" | "paused" | "over";

export interface Stats {
  health: number;
  maxHealth: number;
  ammo: number;
  magSize: number;
  reserve: number;
  reloading: boolean;
  score: number;
  kills: number;
  wave: number;
  enemiesLeft: number;
}

export type GameEvent =
  | { type: "hit"; headshot: boolean; kill: boolean }
  | { type: "damage" }
  | { type: "message"; text: string; color: string };

export interface GameHandlers {
  onStats: (s: Stats) => void;
  onScreen: (s: Screen) => void;
  onEvent: (e: GameEvent) => void;
}

/* ------------------------------------------------------------------ */
/*  Tuning constants                                                    */
/* ------------------------------------------------------------------ */

interface EnemyDef {
  name: string;
  hp: number;
  speed: number;
  color: number;
  eyeColor: number;
  scale: number;
  score: number;
  ranged: boolean;
  range: number;
  cooldown: number;
  damage: number;
  reach: number;
}

const ENEMY_DEFS: Record<"grunt" | "charger", EnemyDef> = {
  grunt: {
    name: "Grunt",
    hp: 60,
    speed: 2.6,
    color: 0xe11d48,
    eyeColor: 0x22d3ee,
    scale: 1,
    score: 100,
    ranged: true,
    range: 26,
    cooldown: 1.7,
    damage: 9,
    reach: 0,
  },
  charger: {
    name: "Charger",
    hp: 45,
    speed: 5,
    color: 0x7c3aed,
    eyeColor: 0xff2d55,
    scale: 1.15,
    score: 150,
    ranged: false,
    range: 0,
    cooldown: 0.9,
    damage: 14,
    reach: 1.9,
  },
};

const ARENA = 42; // half-size of the square arena
const WALL_H = 9;
const PLAYER_R = 0.45;
const EYE_H = 1.7;
const GRAVITY = 26;
const JUMP_V = 9;
const WALK_SPEED = 6.5;
const SPRINT_SPEED = 10;
const MAX_HEALTH = 100;
const MAG_SIZE = 30;
const START_RESERVE = 120;
const FIRE_DELAY = 0.095;
const RELOAD_TIME = 1.5;
const BODY_DAMAGE = 25;
const HEAD_MULT = 2;
const ENEMY_BULLET_SPEED = 20;
const SENS = 0.0022;
const MAX_PITCH = 1.5;
const REGEN_DELAY = 4;
const REGEN_RATE = 12;
const ENEMY_RADIUS = 0.5;

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  h: number;
}

interface Enemy {
  def: EnemyDef;
  group: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  mats: THREE.MeshStandardMaterial[];
  hp: number;
  cd: number;
  flash: number;
  phase: number;
  strafe: number;
  strafeT: number;
}

interface Corpse {
  group: THREE.Group;
  mats: THREE.Material[];
  t: number;
}

interface Bullet {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  dmg: number;
}

interface Particle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
}

interface Tracer {
  line: THREE.Line;
  life: number;
}

function clamp(v: number, a: number, b: number) {
  return Math.min(b, Math.max(a, v));
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic set of cover blocks scattered across the arena. */
function generateObstacles(): Box[] {
  const rand = mulberry32(2024);
  const list: Box[] = [];
  for (let attempt = 0; attempt < 500 && list.length < 26; attempt++) {
    const w = 1.6 + rand() * 2.4;
    const d = 1.6 + rand() * 2.4;
    const h = rand() < 0.3 ? 3.8 + rand() * 2.5 : 1.2 + rand() * 1.4;
    const cx = (rand() * 2 - 1) * (ARENA - 5);
    const cz = (rand() * 2 - 1) * (ARENA - 5);
    // keep the spawn area clear
    if (Math.hypot(cx, cz) - Math.hypot(w, d) / 2 < 7) continue;
    const box: Box = {
      minX: cx - w / 2,
      maxX: cx + w / 2,
      minZ: cz - d / 2,
      maxZ: cz + d / 2,
      h,
    };
    const clash = list.some(
      (o) =>
        box.minX < o.maxX + 1.5 &&
        box.maxX > o.minX - 1.5 &&
        box.minZ < o.maxZ + 1.5 &&
        box.maxZ > o.minZ - 1.5
    );
    if (!clash) list.push(box);
  }
  return list;
}

/* ------------------------------------------------------------------ */
/*  Game                                                                */
/* ------------------------------------------------------------------ */

export class Game {
  private readonly canvas = document.createElement("canvas");
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(75, 1, 0.05, 250);
  private readonly raycaster = new THREE.Raycaster();
  private readonly handlers: GameHandlers;
  private readonly container: HTMLElement;

  private readonly bulletGeo = new THREE.SphereGeometry(0.12, 8, 6);
  private readonly bulletMat = new THREE.MeshBasicMaterial({ color: 0xff9f1c });
  private readonly particleGeo = new THREE.BoxGeometry(0.06, 0.06, 0.06);
  private enemyGeo!: Record<"torso" | "head" | "arm" | "leg" | "eye", THREE.BoxGeometry>;

  private screen: Screen = "menu";
  private fallbackLook = false;
  private rafId = 0;
  private lastTime = 0;
  private time = 0;
  private statsTimer = 0;
  private audio: AudioContext | null = null;

  // player state
  private pos = new THREE.Vector3(0, 0, 0); // feet position
  private vel = new THREE.Vector3();
  private onGround = true;
  private yaw = 0;
  private pitch = 0;
  private health = MAX_HEALTH;
  private lastDamage = -100;
  private score = 0;
  private kills = 0;
  private keys = new Set<string>();
  private firing = false;
  private bobT = 0;
  private bobAmt = 0;

  // weapon state
  private ammo = MAG_SIZE;
  private reserve = START_RESERVE;
  private reloadT = 0;
  private nextFire = 0;
  private kick = 0;
  private flashT = 0;
  private gun = new THREE.Group();
  private muzzle = new THREE.Object3D();
  private flashMesh!: THREE.Mesh;

  // wave state
  private wave = 0;
  private toSpawn = 0;
  private spawnT = 0;
  private breakT = 0;
  private cleared = false;

  // world
  private obstacles: Box[] = [];
  private world: THREE.Object3D[] = [];
  private enemies: Enemy[] = [];
  private corpses: Corpse[] = [];
  private enemyBullets: Bullet[] = [];
  private particles: Particle[] = [];
  private tracers: Tracer[] = [];

  constructor(container: HTMLElement, handlers: GameHandlers) {
    this.container = container;
    this.handlers = handlers;

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.canvas);

    this.camera.rotation.order = "YXZ";
    this.scene.background = new THREE.Color(0x0b1020);
    this.scene.add(this.camera);

    this.buildLights();
    this.buildWorld();
    this.buildEnemyGeometry();
    this.buildGun();
    this.resize();
    this.reset();

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("resize", this.onResize);
    window.addEventListener("blur", this.onBlur);
    document.addEventListener("pointerlockchange", this.onPointerLockChange);

    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.loop);
  }

  /* ---------------- public API ---------------- */

  /** Start or resume play (must be called from a user gesture). */
  play() {
    if (this.screen === "playing") return;
    if (this.screen === "over") this.reset();
    this.begin();
  }

  /** Restart a fresh run. */
  restart() {
    this.reset();
    this.begin();
  }

  dispose() {
    cancelAnimationFrame(this.rafId);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("blur", this.onBlur);
    document.removeEventListener("pointerlockchange", this.onPointerLockChange);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => m.dispose());
      }
    });
    this.bulletGeo.dispose();
    this.bulletMat.dispose();
    this.particleGeo.dispose();
    this.renderer.dispose();
    this.canvas.remove();
    void this.audio?.close();
    this.audio = null;
  }

  /* ---------------- setup ---------------- */

  private buildLights() {
    const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x3b3f6b, 2.6);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(20, 40, 15);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = 55;
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 130;
    sun.shadow.bias = -0.0008;
    this.scene.add(sun);
  }

  private makeFloorTexture() {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#4b5b7a";
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = "#8ea3c7";
    ctx.lineWidth = 4;
    ctx.strokeRect(0, 0, 256, 256);
    ctx.fillStyle = "#22d3ee88";
    ctx.fillRect(116, 116, 24, 24);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(ARENA, ARENA);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  }

  private addBlock(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    mat: THREE.Material,
    collidable: boolean
  ) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    if (collidable) this.world.push(mesh);
    return mesh;
  }

  private buildWorld() {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(ARENA * 2, ARENA * 2),
      new THREE.MeshStandardMaterial({ map: this.makeFloorTexture(), roughness: 0.8, metalness: 0 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(4, 0.06, 8, 72),
      new THREE.MeshBasicMaterial({ color: 0x22d3ee })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    this.scene.add(ring);

    // arena walls with neon strips on the inside
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.85 });
    const neonMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee });
    const H = WALL_H;
    const walls: [number, number, number, number, number, number][] = [
      [0, H / 2, -ARENA - 0.5, ARENA * 2 + 2, H, 1],
      [0, H / 2, ARENA + 0.5, ARENA * 2 + 2, H, 1],
      [-ARENA - 0.5, H / 2, 0, 1, H, ARENA * 2 + 2],
      [ARENA + 0.5, H / 2, 0, 1, H, ARENA * 2 + 2],
    ];
    for (const [x, y, z, w, h, d] of walls) {
      this.addBlock(x, y, z, w, h, d, wallMat, true);
      const sx = Math.sign(x);
      const sz = Math.sign(z);
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(w > d ? w : 0.1, 0.25, w > d ? 0.1 : d),
        neonMat
      );
      strip.position.set(x - sx * 0.55, 2.6, z - sz * 0.55);
      this.scene.add(strip);
    }

    // cover blocks
    this.obstacles = generateObstacles();
    const palette = [0x94a3b8, 0x2dd4bf, 0xfb923c, 0xa78bfa, 0xcbd5e1];
    const neons = [0x22d3ee, 0xf472b6, 0xa3e635, 0xfbbf24];
    this.obstacles.forEach((b, i) => {
      const w = b.maxX - b.minX;
      const d = b.maxZ - b.minZ;
      const cx = (b.minX + b.maxX) / 2;
      const cz = (b.minZ + b.maxZ) / 2;
      const mat = new THREE.MeshStandardMaterial({
        color: palette[i % palette.length],
        roughness: 0.7,
        metalness: 0.1,
      });
      this.addBlock(cx, b.h / 2, cz, w, b.h, d, mat, true);
      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(w + 0.04, 0.12, d + 0.04),
        new THREE.MeshBasicMaterial({ color: neons[i % neons.length] })
      );
      cap.position.set(cx, b.h + 0.01, cz);
      this.scene.add(cap);
    });
  }

  private buildEnemyGeometry() {
    this.enemyGeo = {
      torso: new THREE.BoxGeometry(0.75, 0.9, 0.45),
      head: new THREE.BoxGeometry(0.42, 0.42, 0.42),
      arm: new THREE.BoxGeometry(0.2, 0.8, 0.2),
      leg: new THREE.BoxGeometry(0.26, 0.85, 0.28),
      eye: new THREE.BoxGeometry(0.3, 0.07, 0.04),
    };
  }

  private buildGun() {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.5, metalness: 0.6 });
    const accentMat = new THREE.MeshStandardMaterial({ color: 0x0e7490, roughness: 0.4, metalness: 0.5 });
    const glowMat = new THREE.MeshBasicMaterial({ color: 0x67e8f9 });

    const part = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      this.gun.add(m);
      return m;
    };
    part(0.09, 0.12, 0.5, bodyMat, 0, 0, -0.05); // receiver
    part(0.05, 0.05, 0.32, accentMat, 0, 0.02, -0.4); // barrel
    part(0.07, 0.14, 0.22, bodyMat, 0, -0.02, 0.24); // stock
    part(0.06, 0.18, 0.08, bodyMat, 0, -0.14, -0.08); // magazine
    part(0.03, 0.04, 0.1, accentMat, 0, 0.09, -0.12); // sight
    part(0.01, 0.015, 0.4, glowMat, 0.046, 0.012, -0.1); // neon stripe

    this.muzzle.position.set(0, 0.02, -0.6);
    this.gun.add(this.muzzle);

    this.flashMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xfde047 })
    );
    this.flashMesh.position.copy(this.muzzle.position);
    this.flashMesh.visible = false;
    this.gun.add(this.flashMesh);

    const gunLight = new THREE.PointLight(0xffffff, 2.5, 4);
    gunLight.position.set(0.2, 0.3, 0.1);
    this.camera.add(gunLight);

    this.gun.position.set(0.28, -0.26, -0.5);
    this.camera.add(this.gun);
  }

  /* ---------------- state transitions ---------------- */

  private begin() {
    this.ensureAudio();
    this.screen = "playing";
    this.keys.clear();
    this.firing = false;
    this.requestLock();
    this.handlers.onScreen("playing");
  }

  private pause() {
    if (this.screen !== "playing") return;
    this.screen = "paused";
    this.firing = false;
    this.keys.clear();
    if (document.pointerLockElement) document.exitPointerLock();
    this.handlers.onScreen("paused");
  }

  private gameOver() {
    this.screen = "over";
    this.firing = false;
    this.keys.clear();
    if (document.pointerLockElement) document.exitPointerLock();
    this.handlers.onStats(this.buildStats());
    this.handlers.onScreen("over");
  }

  private requestLock() {
    try {
      const result = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      result?.catch(() => {
        this.fallbackLook = true;
      });
    } catch {
      this.fallbackLook = true;
    }
  }

  private reset() {
    this.clearDynamic();
    this.time = 0;
    this.health = MAX_HEALTH;
    this.lastDamage = -100;
    this.score = 0;
    this.kills = 0;
    this.ammo = MAG_SIZE;
    this.reserve = START_RESERVE;
    this.reloadT = 0;
    this.nextFire = 0;
    this.kick = 0;
    this.flashT = 0;
    this.bobT = 0;
    this.bobAmt = 0;
    this.pos.set(0, 0, 0);
    this.vel.set(0, 0, 0);
    this.onGround = true;
    this.yaw = 0;
    this.pitch = 0;
    this.wave = 0;
    this.toSpawn = 0;
    this.breakT = 0;
    this.cleared = false;
    this.startWave(1);
  }

  private clearDynamic() {
    for (const e of this.enemies) {
      this.scene.remove(e.group);
      e.mats.forEach((m) => m.dispose());
    }
    for (const c of this.corpses) {
      this.scene.remove(c.group);
      c.mats.forEach((m) => m.dispose());
    }
    for (const b of this.enemyBullets) this.scene.remove(b.mesh);
    for (const p of this.particles) {
      this.scene.remove(p.mesh);
      (p.mesh.material as THREE.Material).dispose();
    }
    for (const t of this.tracers) {
      this.scene.remove(t.line);
      t.line.geometry.dispose();
      (t.line.material as THREE.Material).dispose();
    }
    this.enemies = [];
    this.corpses = [];
    this.enemyBullets = [];
    this.particles = [];
    this.tracers = [];
  }

  private startWave(n: number) {
    this.wave = n;
    this.toSpawn = 4 + n * 3;
    this.spawnT = n === 1 ? 2.5 : 2;
    this.cleared = false;
    this.emit({ type: "message", text: `WAVE ${n}`, color: "#22d3ee" });
  }

  /* ---------------- input ---------------- */

  private onKeyDown = (e: KeyboardEvent) => {
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) {
      e.preventDefault();
    }
    if (e.code === "Escape") {
      this.pause();
      return;
    }
    if (this.screen !== "playing") return;
    if (e.code === "KeyR" && !e.repeat) this.startReload();
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private onMouseDown = (e: MouseEvent) => {
    if (e.button === 0 && this.screen === "playing") this.firing = true;
  };

  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) this.firing = false;
  };

  private onMouseMove = (e: MouseEvent) => {
    if (this.screen !== "playing") return;
    if (!document.pointerLockElement && !this.fallbackLook) return;
    this.yaw -= e.movementX * SENS;
    this.pitch = clamp(this.pitch - e.movementY * SENS, -MAX_PITCH, MAX_PITCH);
  };

  private onPointerLockChange = () => {
    if (!document.pointerLockElement && this.screen === "playing" && !this.fallbackLook) {
      this.pause();
    }
  };

  private onBlur = () => {
    this.keys.clear();
    this.firing = false;
  };

  private onResize = () => this.resize();

  private resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /* ---------------- main loop ---------------- */

  private loop = (now: number) => {
    this.rafId = requestAnimationFrame(this.loop);
    const dt = clamp((now - this.lastTime) / 1000, 0, 0.05);
    this.lastTime = now;
    this.update(dt);
    this.renderer.render(this.scene, this.camera);
  };

  private update(dt: number) {
    this.time += dt;

    if (this.screen === "playing") {
      this.updatePlayer(dt);
      this.updateCamera();
      this.updateGun(dt);
      this.updateWeapon(dt);
      this.updateWaves(dt);
      this.updateEnemies(dt);
      this.updateEnemyBullets(dt);
      this.updateEffects(dt);
      if (this.health < MAX_HEALTH && this.time - this.lastDamage > REGEN_DELAY) {
        this.health = Math.min(MAX_HEALTH, this.health + REGEN_RATE * dt);
      }
    } else {
      if (this.screen === "menu") {
        // slow attract-mode pan behind the title screen
        this.yaw += dt * 0.12;
        this.pitch = -0.08;
      }
      this.updateCamera();
      this.updateGun(dt);
    }

    this.statsTimer += dt;
    if (this.statsTimer >= 0.1) {
      this.statsTimer = 0;
      this.handlers.onStats(this.buildStats());
    }
  }

  private buildStats(): Stats {
    return {
      health: Math.ceil(this.health),
      maxHealth: MAX_HEALTH,
      ammo: this.ammo,
      magSize: MAG_SIZE,
      reserve: this.reserve,
      reloading: this.reloadT > 0,
      score: this.score,
      kills: this.kills,
      wave: this.wave,
      enemiesLeft: this.enemies.length + this.toSpawn,
    };
  }

  private emit(e: GameEvent) {
    this.handlers.onEvent(e);
  }

  /* ---------------- player ---------------- */

  private updatePlayer(dt: number) {
    const k = this.keys;
    const sprint = k.has("ShiftLeft") || k.has("ShiftRight");
    const fwd =
      (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
    const side =
      (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);

    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    let dx = -sinY * fwd + cosY * side;
    let dz = -cosY * fwd - sinY * side;
    const len = Math.hypot(dx, dz);
    const moving = len > 0;
    if (moving) {
      dx /= len;
      dz /= len;
    }

    const speed = sprint ? SPRINT_SPEED : WALK_SPEED;
    const accel = 1 - Math.exp(-(this.onGround ? 14 : 3) * dt);
    this.vel.x += (dx * speed - this.vel.x) * accel;
    this.vel.z += (dz * speed - this.vel.z) * accel;

    if (k.has("Space") && this.onGround) {
      this.vel.y = JUMP_V;
      this.onGround = false;
    }
    this.vel.y -= GRAVITY * dt;

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vel.y * dt;
    if (this.pos.y <= 0) {
      this.pos.y = 0;
      this.vel.y = 0;
      this.onGround = true;
    }

    const [x, z] = this.resolveXZ(this.pos.x, this.pos.z, PLAYER_R);
    this.pos.x = x;
    this.pos.z = z;

    const grounded = this.onGround && moving;
    this.bobAmt += ((grounded ? 1 : 0) - this.bobAmt) * Math.min(1, dt * 8);
    if (grounded) this.bobT += dt * (sprint ? 16 : 11);
  }

  private updateCamera() {
    this.camera.position.set(
      this.pos.x,
      this.pos.y + EYE_H + Math.sin(this.bobT) * 0.04 * this.bobAmt,
      this.pos.z
    );
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  private resolveXZ(x: number, z: number, r: number): [number, number] {
    const lim = ARENA - r;
    x = clamp(x, -lim, lim);
    z = clamp(z, -lim, lim);
    for (let pass = 0; pass < 2; pass++) {
      for (const b of this.obstacles) {
        if (x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r) {
          const dL = x - (b.minX - r);
          const dR = b.maxX + r - x;
          const dB = z - (b.minZ - r);
          const dF = b.maxZ + r - z;
          const m = Math.min(dL, dR, dB, dF);
          if (m === dL) x = b.minX - r;
          else if (m === dR) x = b.maxX + r;
          else if (m === dB) z = b.minZ - r;
          else z = b.maxZ + r;
        }
      }
    }
    return [x, z];
  }

  private blocked(x: number, y: number, z: number): boolean {
    if (Math.abs(x) > ARENA || Math.abs(z) > ARENA) return true;
    for (const b of this.obstacles) {
      if (y < b.h && x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) return true;
    }
    return false;
  }

  private blockedXZ(x: number, z: number, pad: number): boolean {
    return this.obstacles.some(
      (b) => x > b.minX - pad && x < b.maxX + pad && z > b.minZ - pad && z < b.maxZ + pad
    );
  }

  private hasLOS(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dy, dz) / 0.4));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (this.blocked(ax + dx * t, ay + dy * t, az + dz * t)) return false;
    }
    return true;
  }

  private applyDamage(amount: number) {
    if (this.screen !== "playing") return;
    this.health -= amount;
    this.lastDamage = this.time;
    this.emit({ type: "damage" });
    this.beep(140, 60, 0.2, "sawtooth", 0.12);
    if (this.health <= 0) {
      this.health = 0;
      this.gameOver();
    }
  }

  /* ---------------- weapon ---------------- */

  private updateGun(dt: number) {
    this.kick = Math.max(0, this.kick - dt * 10);
    this.flashT = Math.max(0, this.flashT - dt);
    this.flashMesh.visible = this.flashT > 0;

    const sway = Math.sin(this.bobT * 0.5) * 0.012 * this.bobAmt;
    const bob = Math.abs(Math.sin(this.bobT)) * 0.015 * this.bobAmt;
    let dip = 0;
    let tilt = 0;
    if (this.reloadT > 0) {
      const p = 1 - this.reloadT / RELOAD_TIME;
      const s = Math.sin(p * Math.PI);
      dip = s * 0.18;
      tilt = s * 0.5;
    }
    this.gun.position.set(0.28 + sway, -0.26 - bob - dip, -0.5 + this.kick * 0.06);
    this.gun.rotation.set(this.kick * 0.15 - tilt, 0, 0);
  }

  private updateWeapon(dt: number) {
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        this.reloadT = 0;
        const take = Math.min(MAG_SIZE - this.ammo, this.reserve);
        this.ammo += take;
        this.reserve -= take;
      }
    }
    if (this.firing && this.reloadT === 0 && this.time >= this.nextFire) {
      if (this.ammo > 0) this.shoot();
      else this.startReload();
    }
  }

  private startReload() {
    if (this.reloadT > 0 || this.ammo >= MAG_SIZE || this.reserve <= 0) return;
    this.reloadT = RELOAD_TIME;
    this.beep(300, 500, 0.25, "triangle", 0.05);
  }

  private shoot() {
    this.ammo--;
    this.nextFire = this.time + FIRE_DELAY;
    this.kick = 1;
    this.flashT = 0.05;
    this.pitch = Math.min(MAX_PITCH, this.pitch + 0.012);
    this.beep(900, 180, 0.09, "square", 0.05);

    this.scene.updateMatrixWorld();
    const spread = new THREE.Vector2((Math.random() - 0.5) * 0.02, (Math.random() - 0.5) * 0.02);
    this.raycaster.setFromCamera(spread, this.camera);
    const ray = this.raycaster.ray;

    const targets: THREE.Object3D[] = [...this.enemies.map((e) => e.group), ...this.world];
    const hits = this.raycaster.intersectObjects(targets, true);
    const hit = hits[0];

    const muzzle = this.muzzle.getWorldPosition(new THREE.Vector3());
    const end = hit ? hit.point.clone() : ray.origin.clone().addScaledVector(ray.direction, 120);
    this.addTracer(muzzle, end);

    if (!hit) return;

    let obj: THREE.Object3D | null = hit.object;
    let enemy: Enemy | undefined;
    while (obj && !enemy) {
      enemy = obj.userData.enemy as Enemy | undefined;
      obj = obj.parent;
    }
    if (!enemy) {
      this.spawnParticles(hit.point, 6, 0xfacc15);
      return;
    }

    const head = hit.object.userData.part === "head";
    const dmg = head ? BODY_DAMAGE * HEAD_MULT : BODY_DAMAGE;
    enemy.hp -= dmg;
    this.setEnemyFlash(enemy, true);
    this.spawnParticles(hit.point, 10, 0xff4d6d);
    const killed = enemy.hp <= 0;
    if (killed) this.killEnemy(enemy, head);
    this.emit({ type: "hit", headshot: head, kill: killed });
    if (killed) this.beep(500, 1000, 0.15, "triangle", 0.1);
    else this.beep(1200, 600, 0.05, "triangle", 0.1);
  }

  private addTracer(from: THREE.Vector3, to: THREE.Vector3) {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const mat = new THREE.LineBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.9 });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.tracers.push({ line, life: 0.07 });
  }

  private spawnParticles(at: THREE.Vector3, count: number, color: number) {
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true });
      const mesh = new THREE.Mesh(this.particleGeo, mat);
      mesh.position.copy(at);
      this.scene.add(mesh);
      this.particles.push({
        mesh,
        vel: new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 5 + 1, (Math.random() - 0.5) * 6),
        life: 0.4 + Math.random() * 0.3,
      });
    }
  }

  private updateEffects(dt: number) {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      (t.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, t.life / 0.07) * 0.9;
      if (t.life <= 0) {
        this.scene.remove(t.line);
        t.line.geometry.dispose();
        (t.line.material as THREE.Material).dispose();
        this.tracers.splice(i, 1);
      }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      p.vel.y -= 14 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      if (p.mesh.position.y < 0.03) {
        p.mesh.position.y = 0.03;
        p.vel.set(0, 0, 0);
      }
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = Math.min(1, p.life / 0.3);
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        (p.mesh.material as THREE.Material).dispose();
        this.particles.splice(i, 1);
      }
    }

    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const c = this.corpses[i];
      c.t += dt;
      c.group.rotation.x = Math.min(Math.PI / 2, c.t * 5);
      c.group.position.y = Math.min(0.2, c.t * 0.5);
      if (c.t > 2.2) {
        this.scene.remove(c.group);
        c.mats.forEach((m) => m.dispose());
        this.corpses.splice(i, 1);
      }
    }
  }

  /* ---------------- waves & enemies ---------------- */

  private updateWaves(dt: number) {
    if (this.toSpawn > 0) {
      this.spawnT -= dt;
      const cap = Math.min(14, 4 + this.wave * 2);
      if (this.spawnT <= 0 && this.enemies.length < cap) {
        this.spawnEnemy();
        this.toSpawn--;
        this.spawnT = Math.max(0.45, 1.8 - this.wave * 0.1);
      }
      return;
    }

    if (this.enemies.length === 0) {
      if (!this.cleared) {
        this.cleared = true;
        this.breakT = 4;
        const bonus = 250 * this.wave;
        this.score += bonus;
        this.health = Math.min(MAX_HEALTH, this.health + 25);
        this.reserve += 30;
        this.emit({ type: "message", text: `WAVE ${this.wave} CLEARED  +${bonus}`, color: "#86efac" });
      }
      this.breakT -= dt;
      if (this.breakT <= 0) this.startWave(this.wave + 1);
    }
  }

  private spawnEnemy() {
    const charger = this.wave >= 2 && Math.random() < Math.min(0.5, 0.15 + this.wave * 0.05);
    const def = charger ? ENEMY_DEFS.charger : ENEMY_DEFS.grunt;

    let x = 0;
    let z = 0;
    for (let i = 0; i < 25; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 24 + Math.random() * 10;
      x = clamp(Math.cos(a) * r, -(ARENA - 2), ARENA - 2);
      z = clamp(Math.sin(a) * r, -(ARENA - 2), ARENA - 2);
      if (!this.blockedXZ(x, z, 1.2)) break;
    }

    const enemy = this.createEnemy(def);
    enemy.group.position.set(x, 0, z);
    this.scene.add(enemy.group);
    this.enemies.push(enemy);
  }

  private createEnemy(def: EnemyDef): Enemy {
    const geo = this.enemyGeo;
    const bodyMat = new THREE.MeshStandardMaterial({
      color: def.color,
      emissive: def.color,
      emissiveIntensity: 0.15,
      roughness: 0.5,
      metalness: 0.2,
    });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.8 });
    const eyeMat = new THREE.MeshStandardMaterial({
      color: def.eyeColor,
      emissive: def.eyeColor,
      emissiveIntensity: 2,
    });

    const group = new THREE.Group();
    const mesh = (
      g: THREE.BufferGeometry,
      m: THREE.Material,
      parent: THREE.Object3D,
      x: number,
      y: number,
      z: number,
      part?: string
    ) => {
      const o = new THREE.Mesh(g, m);
      o.position.set(x, y, z);
      o.castShadow = true;
      if (part) o.userData.part = part;
      parent.add(o);
      return o;
    };

    mesh(geo.torso, bodyMat, group, 0, 1.35, 0, "body");
    mesh(geo.head, bodyMat, group, 0, 2.0, 0, "head");
    mesh(geo.eye, eyeMat, group, 0, 2.02, 0.22);
    mesh(geo.arm, darkMat, group, -0.5, 1.35, 0);
    mesh(geo.arm, darkMat, group, 0.5, 1.35, 0);

    const legL = new THREE.Group();
    legL.position.set(-0.18, 0.85, 0);
    group.add(legL);
    mesh(geo.leg, darkMat, legL, 0, -0.42, 0, "body");

    const legR = new THREE.Group();
    legR.position.set(0.18, 0.85, 0);
    group.add(legR);
    mesh(geo.leg, darkMat, legR, 0, -0.42, 0, "body");

    group.scale.setScalar(def.scale);

    const wave = this.wave;
    const enemy: Enemy = {
      def,
      group,
      legL,
      legR,
      mats: [bodyMat, darkMat, eyeMat],
      hp: def.hp * (1 + (wave - 1) * 0.08),
      cd: 0.5 + Math.random(),
      flash: 0,
      phase: Math.random() * 6,
      strafe: Math.random() < 0.5 ? -1 : 1,
      strafeT: 2,
    };
    group.userData.enemy = enemy;
    return enemy;
  }

  private setEnemyFlash(e: Enemy, on: boolean) {
    const body = e.mats[0];
    body.emissive.setHex(on ? 0xffffff : e.def.color);
    body.emissiveIntensity = on ? 1.2 : 0.15;
    e.flash = on ? 0.08 : 0;
  }

  private killEnemy(e: Enemy, head: boolean) {
    this.enemies = this.enemies.filter((x) => x !== e);
    this.corpses.push({ group: e.group, mats: e.mats, t: 0 });
    const pts = head ? Math.round(e.def.score * 1.5) : e.def.score;
    this.score += pts;
    this.kills++;
    this.emit({
      type: "message",
      text: `${head ? "HEADSHOT! " : ""}${e.def.name} down  +${pts}`,
      color: head ? "#f87171" : "#fde68a",
    });
  }

  private updateEnemies(dt: number) {
    const px = this.pos.x;
    const pz = this.pos.z;
    const mul = 1 + (this.wave - 1) * 0.04;

    for (const e of this.enemies) {
      const def = e.def;
      const g = e.group;
      const dx = px - g.position.x;
      const dz = pz - g.position.z;
      const dist = Math.max(0.001, Math.hypot(dx, dz));
      const nx = dx / dist;
      const nz = dz / dist;

      e.strafeT -= dt;
      if (e.strafeT <= 0) {
        e.strafeT = 1.5 + Math.random() * 2;
        e.strafe = -e.strafe;
      }

      let mx = 0;
      let mz = 0;
      if (def.ranged) {
        if (dist > 11) {
          mx = nx;
          mz = nz;
        } else if (dist < 6) {
          mx = -nx;
          mz = -nz;
        } else {
          mx = -nz * e.strafe;
          mz = nx * e.strafe;
        }
      } else if (dist > def.reach * 0.8) {
        mx = nx;
        mz = nz;
      }

      const moving = mx !== 0 || mz !== 0;
      if (moving) {
        const step = def.speed * mul * dt;
        const [x, z] = this.resolveXZ(g.position.x + mx * step, g.position.z + mz * step, ENEMY_RADIUS);
        g.position.x = x;
        g.position.z = z;
      }

      g.rotation.y = Math.atan2(dx, dz);
      e.phase += dt * def.speed * 2.2;
      const swing = moving ? Math.sin(e.phase) * 0.7 : 0;
      e.legL.rotation.x = swing;
      e.legR.rotation.x = -swing;

      e.cd -= dt;
      if (def.ranged) {
        if (
          e.cd <= 0 &&
          dist < def.range &&
          dist > 3 &&
          this.hasLOS(g.position.x, 1.9, g.position.z, px, this.pos.y + 1.2, pz)
        ) {
          this.fireEnemyBullet(g.position.x, g.position.z, def.damage);
          const diff = 1 - Math.min(0.4, (this.wave - 1) * 0.03);
          e.cd = def.cooldown * diff * (0.8 + Math.random() * 0.4);
        }
      } else if (dist < def.reach && e.cd <= 0) {
        this.applyDamage(def.damage);
        e.cd = def.cooldown;
      }

      if (e.flash > 0) {
        e.flash -= dt;
        if (e.flash <= 0) this.setEnemyFlash(e, false);
      }
    }

    // soft separation so enemies don't stack
    for (let i = 0; i < this.enemies.length; i++) {
      for (let j = i + 1; j < this.enemies.length; j++) {
        const a = this.enemies[i].group.position;
        const b = this.enemies[j].group.position;
        const ddx = b.x - a.x;
        const ddz = b.z - a.z;
        const d = Math.hypot(ddx, ddz);
        if (d < 1 && d > 0.001) {
          const push = (1 - d) * 0.5;
          a.x -= (ddx / d) * push;
          a.z -= (ddz / d) * push;
          b.x += (ddx / d) * push;
          b.z += (ddz / d) * push;
        }
      }
    }
  }

  private fireEnemyBullet(x: number, z: number, dmg: number) {
    const from = new THREE.Vector3(x, 1.9, z);
    const to = new THREE.Vector3(
      this.pos.x + (Math.random() - 0.5) * 1.4,
      this.pos.y + 1.1 + (Math.random() - 0.5) * 1.0,
      this.pos.z + (Math.random() - 0.5) * 1.4
    );
    const vel = to.sub(from).normalize().multiplyScalar(ENEMY_BULLET_SPEED);
    const mesh = new THREE.Mesh(this.bulletGeo, this.bulletMat);
    mesh.position.copy(from);
    this.scene.add(mesh);
    this.enemyBullets.push({ mesh, vel, life: 3, dmg });
    this.beep(320, 140, 0.12, "sawtooth", 0.05);
  }

  private updateEnemyBullets(dt: number) {
    for (let i = this.enemyBullets.length - 1; i >= 0; i--) {
      const b = this.enemyBullets[i];
      b.life -= dt;
      b.mesh.position.addScaledVector(b.vel, dt);
      const p = b.mesh.position;
      let remove = b.life <= 0;

      if (
        !remove &&
        Math.hypot(p.x - this.pos.x, p.z - this.pos.z) < 0.5 &&
        p.y > this.pos.y &&
        p.y < this.pos.y + 1.9
      ) {
        this.applyDamage(b.dmg);
        remove = true;
      }

      if (!remove && this.blocked(p.x, p.y, p.z)) {
        remove = true;
        this.spawnParticles(p.clone(), 4, 0xffb703);
      }

      if (remove) {
        this.scene.remove(b.mesh);
        this.enemyBullets.splice(i, 1);
      }
    }
  }

  /* ---------------- audio ---------------- */

  private ensureAudio() {
    try {
      if (!this.audio) this.audio = new AudioContext();
      if (this.audio.state === "suspended") void this.audio.resume();
    } catch {
      this.audio = null;
    }
  }

  private beep(f0: number, f1: number, dur: number, type: OscillatorType, vol: number) {
    const ctx = this.audio;
    if (!ctx || ctx.state !== "running") return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const t = ctx.currentTime;
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }
}
