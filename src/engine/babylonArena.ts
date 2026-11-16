import {
  Color3,
  Color4,
  DirectionalLight,
  DynamicTexture,
  Engine,
  HemisphericLight,
  LinesMesh,
  Matrix,
  Mesh,
  MeshBuilder,
  Quaternion,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  TransformNode,
  UniversalCamera,
  Vector3,
  VertexData,
} from '@babylonjs/core';
import {
  CHUNK_SIZE,
  MATERIAL_COLORS,
  VOXEL_SIZE,
  WATER_LEVEL_WORLD,
  type InventorySlotItem,
  type LootDropState,
  type MapEventState,
  type PlayerNetState,
  type ProjectileNetState,
  type RoomInitPayload,
  type RoomTickPayload,
  type SpawnedEntityNetState,
  type Vec3,
  type VoxelDelta,
  type WeaponBlueprint,
} from '../shared/types.ts';
import {
  applyPointerLookDelta,
  computeUnlockedEdgeTurn,
} from '../shared/controls.ts';
import {
  createProceduralIsland,
  raycastVoxels,
  VoxelGrid,
} from '../shared/voxelWorld.ts';
import type { AssetEntry, AssetManifest } from '../shared/assets.ts';
import { resolveAssetUrl } from '../shared/assets.ts';
import { soundSynth } from './soundSynth.ts';
import {
  buildBlueprintVoxelMesh,
  buildPlayerAvatarMesh,
  buildStarterToolMesh,
  type PlayerAvatarRig,
} from './voxelMeshBuilder.ts';

interface ShrapnelParticle {
  active: boolean;
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  scale: number;
  ttl: number;
  color: [number, number, number];
}

export interface ArenaCallbacks {
  onSendInput: (
    input: {
      moveX: number;
      moveZ: number;
      jump: boolean;
      yaw: number;
      pitch: number;
      activeSlot: number;
    },
    force?: boolean,
  ) => void;
  onPrimaryAction: (origin: Vec3, dir: Vec3) => void;
  onDropItem: () => void;
  onPickupItem: () => void;
  onOpenPrompt: () => void;
  onOpenWeaponPrompt: () => void;
  onOpenEventPrompt: () => void;
  onZoomChange: (zoomMeters: number) => void;
  onAimContextChange?: (ctx: 'neutral' | 'dig' | 'grapple' | 'enemy') => void;
  onContextLost?: (lost: boolean) => void;
}

export class BabylonVoxelArena {
  private canvas: HTMLCanvasElement;
  private engine: Engine;
  private scene: Scene;
  private camera: UniversalCamera;
  private callbacks: ArenaCallbacks;
  private isSoftwareGl = false;

  private grid: VoxelGrid;
  private chunkMeshes = new Map<string, Mesh>();
  private chunkMat: StandardMaterial;
  private mesherWorker: Worker;
  private mesherJobSeq = 1;
  private pendingJobs = new Map<number, string>();
  private dirtyChunks = new Set<string>();
  private pendingChunkQueue: string[] = [];
  private pendingChunkSet = new Set<string>();
  private shadowGenerator: ShadowGenerator | null = null;

  private waterMesh: Mesh;
  private abyssFloorMesh: Mesh;
  private waterMat: StandardMaterial;

  // Shrapnel zero-GC ThinInstance pool
  private shrapnelBaseMesh: Mesh;
  private shrapnelPool: ShrapnelParticle[] = [];
  private shrapnelMatrices: Float32Array;
  private shrapnelColors: Float32Array;
  private shrapnelCursor = 0;
  private readonly SHRAPNEL_CAP = 240;

  // Dynamic entities
  private playerRigs = new Map<
    string,
    {
      rig: PlayerAvatarRig;
      targetPos: Vector3;
      currentPos: Vector3;
      targetYaw: number;
      currentYaw: number;
      equippedKey: string;
      equippedNode: TransformNode | Mesh | null;
      grappleLine: LinesMesh | null;
    }
  >();

  private projectileMeshes = new Map<string, Mesh>();
  private eventWaypointMeshes = new Map<string, Mesh>();
  private assetManifest: AssetManifest | null = null;
  private lootMeshes = new Map<string, TransformNode>();
  private entityMeshes = new Map<string, { node: TransformNode; targetPos: Vector3 }>();

  // 1st-person viewmodel
  private viewModelAnchor: TransformNode;
  private viewModelNode: TransformNode | Mesh | null = null;
  private viewModelKey = '';
  private muzzleFlashMesh: Mesh;
  private muzzleFlashTimer = 0;
  private lastLocalActionFxAt = 0;
  private weaponCache = new Map<string, WeaponBlueprint>();
  private recoilKick = 0;
  private cameraTrauma = 0;
  private hitstopTimer = 0;

  // Sky, weather & explosion shockwave pools (zero GC)
  private clouds: Mesh[] = [];
  private weatherBaseMesh: Mesh;
  private weatherMatrices: Float32Array;
  private weatherColors: Float32Array;
  private weatherPool: Array<{ x: number; y: number; z: number; speed: number }> = [];
  private readonly WEATHER_CAP = 180;
  private activeWeatherKind: string | null = null;
  private blastFlashes: Array<{
    mesh: Mesh;
    mat: StandardMaterial;
    ttl: number;
    maxTtl: number;
  }> = [];
  private blastCursor = 0;
  private targetWaterY = WATER_LEVEL_WORLD;
  private currentWaterY = WATER_LEVEL_WORLD;
  private aimCheckAccum = 0;
  private lastAimContext: 'neutral' | 'dig' | 'grapple' | 'enemy' = 'neutral';

  // Controls & state
  private mode: 'title' | 'playing' | 'paused' | 'gameover' = 'title';
  private localPlayerId: string | null = null;
  private latestTick: RoomTickPayload | null = null;
  private keysPressed = new Set<string>();
  private yaw = 0;
  private pitch = 0.12;
  private targetZoom = 0; // 0 = 1st person, up to 7.0 = 3rd person
  private currentZoom = 0;
  private activeSlot = 0;
  private promptOpen = false;
  private flyoverAngle = 0;
  private mouseDown = false;
  private rightMouseDown = false;
  private lastMouseClientX: number | null = null;
  private lastMouseClientY: number | null = null;
  private cursorEdgeTurn = 0;
  private cursorOverCanvas = false;
  private animTime = 0;
  private disposed = false;

  private scratchVec = new Vector3();
  private scratchQuat = new Quaternion();
  private scratchScale = new Vector3();
  private scratchPos = new Vector3();
  private scratchMat = Matrix.Identity();

  constructor(canvas: HTMLCanvasElement, callbacks: ArenaCallbacks) {
    this.canvas = canvas;
    this.callbacks = callbacks;

    this.engine = new Engine(canvas, true, {
      preserveDrawingBuffer: false,
      stencil: false,
      antialias: true,
      powerPreference: 'high-performance',
    });

    const gl = (this.engine as unknown as { _gl?: WebGLRenderingContext })._gl;
    if (gl) {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      const rendererName = dbg
        ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) ?? '')
        : String(gl.getParameter(gl.RENDERER) ?? '');
      this.isSoftwareGl = /SwiftShader|llvmpipe|Software|Mesa/i.test(rendererName);
    }
    this.engine.setHardwareScalingLevel(this.isSoftwareGl ? 1.5 : 1);

    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.42, 0.72, 0.94, 1);
    this.scene.fogMode = Scene.FOGMODE_EXP2;
    this.scene.fogColor = new Color3(0.66, 0.84, 0.96);
    this.scene.fogDensity = 0.0022;

    // ACES Filmic tone mapping & vibrant color contrast
    const imgCfg = this.scene.imageProcessingConfiguration;
    imgCfg.toneMappingEnabled = true;
    imgCfg.toneMappingType = 1; // ACES Filmic
    imgCfg.contrast = 1.15;
    imgCfg.exposure = 1.08;

    this.camera = new UniversalCamera('mainCam', new Vector3(64, 26, 64), this.scene);
    this.camera.minZ = 0.08;
    this.camera.maxZ = 950;
    this.camera.fov = 1.08;

    // Gradient sky dome (zenith cobalt -> sunlit horizon -> deep abyssal nadir)
    const skyDome = MeshBuilder.CreateSphere(
      'skyDome',
      { diameter: 1100, segments: 12, sideOrientation: Mesh.BACKSIDE },
      this.scene,
    );
    skyDome.infiniteDistance = true;
    skyDome.isPickable = false;
    const skyTex = new DynamicTexture('skyGradTex', { width: 4, height: 128 }, this.scene, false);
    const skyCtx = skyTex.getContext();
    const grad = skyCtx.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0.0, '#1d4ed8');
    grad.addColorStop(0.32, '#3b82f6');
    grad.addColorStop(0.5, '#bae6fd');
    grad.addColorStop(0.54, '#e0f2fe');
    grad.addColorStop(0.68, '#0c4a6e');
    grad.addColorStop(1.0, '#041729');
    skyCtx.fillStyle = grad;
    skyCtx.fillRect(0, 0, 4, 128);
    skyTex.update();
    const skyMat = new StandardMaterial('skyDomeMat', this.scene);
    skyMat.emissiveTexture = skyTex;
    skyMat.disableLighting = true;
    skyMat.fogEnabled = false;
    skyDome.material = skyMat;

    // Three-point lighting: cool sky hemisphere, warm key sun, subtle cool rim bounce
    const hemi = new HemisphericLight('skyHemi', new Vector3(0.2, 1, 0.15), this.scene);
    hemi.intensity = 0.78;
    hemi.diffuse = new Color3(0.8, 0.91, 1.0);
    hemi.groundColor = new Color3(0.18, 0.23, 0.31);

    const sun = new DirectionalLight('sunKey', new Vector3(-0.55, -0.82, -0.45), this.scene);
    sun.position = new Vector3(160, 140, 140);
    sun.intensity = 1.22;
    sun.diffuse = new Color3(1.0, 0.94, 0.82);

    const rimLight = new DirectionalLight('rimLight', new Vector3(0.55, -0.35, 0.55), this.scene);
    rimLight.intensity = 0.32;
    rimLight.diffuse = new Color3(0.38, 0.65, 0.98);

    if (!this.isSoftwareGl) {
      this.shadowGenerator = new ShadowGenerator(1024, sun);
      this.shadowGenerator.usePercentageCloserFiltering = true;
      this.shadowGenerator.bias = 0.0008;
    }

    // Chunk shared material (vertex colored + AO baked)
    this.chunkMat = new StandardMaterial('voxelChunkMat', this.scene);
    this.chunkMat.specularColor = new Color3(0.08, 0.09, 0.12);
    this.chunkMat.ambientColor = new Color3(0.22, 0.24, 0.3);

    // Abyssal deep sea floor beneath transparent animated ocean surface
    this.abyssFloorMesh = MeshBuilder.CreateGround(
      'abyssFloor',
      { width: 1200, height: 1200, subdivisions: 2 },
      this.scene,
    );
    this.abyssFloorMesh.position.set(64, 0.25, 64);
    const abyssMat = new StandardMaterial('abyssMat', this.scene);
    abyssMat.diffuseColor = Color3.FromHexString('#031728');
    abyssMat.specularColor = Color3.Black();
    this.abyssFloorMesh.material = abyssMat;
    this.abyssFloorMesh.isPickable = false;

    // Ocean water around island (covers up to 224m+ islands cleanly to the horizon)
    this.waterMesh = MeshBuilder.CreateGround(
      'oceanWater',
      { width: 1200, height: 1200, subdivisions: 16 },
      this.scene,
    );
    this.waterMesh.position.set(64, WATER_LEVEL_WORLD - 0.12, 64);
    this.waterMat = new StandardMaterial('waterMat', this.scene);
    this.waterMat.diffuseColor = Color3.FromHexString('#0c5d88');
    this.waterMat.emissiveColor = Color3.FromHexString('#032238');
    this.waterMat.specularColor = new Color3(0.45, 0.72, 0.9);
    this.waterMat.specularPower = 64;
    this.waterMat.alpha = 0.84;
    this.waterMesh.material = this.waterMat;

    // Shrapnel zero-GC ThinInstance pool
    this.shrapnelBaseMesh = MeshBuilder.CreateBox(
      'shrapnelCube',
      { size: VOXEL_SIZE * 0.72 },
      this.scene,
    );
    const shrapMat = new StandardMaterial('shrapMat', this.scene);
    shrapMat.specularColor = new Color3(0.1, 0.1, 0.1);
    this.shrapnelBaseMesh.material = shrapMat;
    this.shrapnelBaseMesh.isPickable = false;
    this.shrapnelBaseMesh.alwaysSelectAsActiveMesh = true;

    this.shrapnelMatrices = new Float32Array(this.SHRAPNEL_CAP * 16);
    this.shrapnelColors = new Float32Array(this.SHRAPNEL_CAP * 4);
    for (let i = 0; i < this.SHRAPNEL_CAP; i++) {
      this.shrapnelPool.push({
        active: false,
        px: 0,
        py: -100,
        pz: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        rx: 0,
        ry: 0,
        scale: 0,
        ttl: 0,
        color: [1, 1, 1],
      });
      Matrix.Scaling(0, 0, 0).copyToArray(this.shrapnelMatrices, i * 16);
      this.shrapnelColors[i * 4 + 3] = 1;
    }
    this.shrapnelBaseMesh.thinInstanceSetBuffer('matrix', this.shrapnelMatrices, 16, false);
    this.shrapnelBaseMesh.thinInstanceSetBuffer('color', this.shrapnelColors, 4, false);

    // Sunlit voxel sun disc + warm solar halo + multi-tier drifting sky clouds
    const sunHalo = MeshBuilder.CreateBox('voxelSunHalo', { width: 32, height: 32, depth: 2 }, this.scene);
    sunHalo.position.set(275, 165, 245);
    sunHalo.lookAt(new Vector3(64, 14, 64));
    const sunHaloMat = new StandardMaterial('sunHaloMat', this.scene);
    sunHaloMat.emissiveColor = Color3.FromHexString('#fbbf24');
    sunHaloMat.disableLighting = true;
    sunHaloMat.fogEnabled = false;
    sunHaloMat.alpha = 0.24;
    sunHalo.material = sunHaloMat;
    sunHalo.isPickable = false;

    const sunDisc = MeshBuilder.CreateBox('voxelSunDisc', { width: 18, height: 18, depth: 2.5 }, this.scene);
    sunDisc.position.set(270, 162, 240);
    sunDisc.lookAt(new Vector3(64, 14, 64));
    const sunDiscMat = new StandardMaterial('sunDiscMat', this.scene);
    sunDiscMat.emissiveColor = Color3.FromHexString('#fef08a');
    sunDiscMat.disableLighting = true;
    sunDiscMat.fogEnabled = false;
    sunDisc.material = sunDiscMat;
    sunDisc.isPickable = false;

    const cloudMat = new StandardMaterial('cloudMat', this.scene);
    cloudMat.diffuseColor = new Color3(0.98, 0.99, 1);
    cloudMat.emissiveColor = new Color3(0.5, 0.56, 0.66);
    cloudMat.fogEnabled = false;
    cloudMat.alpha = 0.86;
    for (let i = 0; i < 18; i++) {
      const cloud = MeshBuilder.CreateBox(
        `voxelCloud_${i}`,
        {
          width: 11 + (i % 4) * 5,
          height: 2.4 + (i % 2) * 1.1,
          depth: 6 + (i % 4) * 2.8,
        },
        this.scene,
      );
      cloud.position.set(
        -50 + i * 20,
        52 + (i % 3) * 6.5,
        -40 + ((i * 37) % 260),
      );
      cloud.material = cloudMat;
      cloud.isPickable = false;
      this.clouds.push(cloud);
    }

    // Weather zero-GC ThinInstance pool
    this.weatherBaseMesh = MeshBuilder.CreateBox('weatherParticle', { size: 0.14 }, this.scene);
    const weatherMat = new StandardMaterial('weatherMat', this.scene);
    weatherMat.disableLighting = true;
    weatherMat.emissiveColor = new Color3(1, 1, 1);
    weatherMat.alpha = 0.78;
    this.weatherBaseMesh.material = weatherMat;
    this.weatherBaseMesh.isPickable = false;
    this.weatherBaseMesh.alwaysSelectAsActiveMesh = true;
    this.weatherBaseMesh.setEnabled(false);

    this.weatherMatrices = new Float32Array(this.WEATHER_CAP * 16);
    this.weatherColors = new Float32Array(this.WEATHER_CAP * 4);
    for (let i = 0; i < this.WEATHER_CAP; i++) {
      this.weatherPool.push({
        x: (Math.random() - 0.5) * 36,
        y: Math.random() * 18,
        z: (Math.random() - 0.5) * 36,
        speed: 0.75 + Math.random() * 0.55,
      });
      Matrix.Scaling(0, 0, 0).copyToArray(this.weatherMatrices, i * 16);
      this.weatherColors[i * 4] = 1;
      this.weatherColors[i * 4 + 1] = 1;
      this.weatherColors[i * 4 + 2] = 1;
      this.weatherColors[i * 4 + 3] = 1;
    }
    this.weatherBaseMesh.thinInstanceSetBuffer('matrix', this.weatherMatrices, 16, false);
    this.weatherBaseMesh.thinInstanceSetBuffer('color', this.weatherColors, 4, false);

    // Pooled explosion shockwave flashes
    for (let i = 0; i < 8; i++) {
      const flash = MeshBuilder.CreateBox(`blastFlash_${i}`, { size: 1 }, this.scene);
      const fMat = new StandardMaterial(`blastMat_${i}`, this.scene);
      fMat.emissiveColor = Color3.FromHexString('#fb923c');
      fMat.disableLighting = true;
      fMat.alpha = 0;
      flash.material = fMat;
      flash.isPickable = false;
      flash.setEnabled(false);
      this.blastFlashes.push({ mesh: flash, mat: fMat, ttl: 0, maxTtl: 0.25 });
    }

    // 1st-person viewmodel anchor + muzzle flash
    this.viewModelAnchor = new TransformNode('viewModelAnchor', this.scene);
    this.viewModelAnchor.parent = this.camera;
    this.viewModelAnchor.position.set(0.3, -0.26, 0.5);
    this.viewModelAnchor.rotation.set(0.08, -0.14, 0);

    this.muzzleFlashMesh = MeshBuilder.CreateBox('muzzleFlash', { size: 0.16 }, this.scene);
    const mfMat = new StandardMaterial('mfMat', this.scene);
    mfMat.emissiveColor = Color3.FromHexString('#fde047');
    mfMat.disableLighting = true;
    this.muzzleFlashMesh.material = mfMat;
    this.muzzleFlashMesh.parent = this.viewModelAnchor;
    this.muzzleFlashMesh.position.set(0, 0.06, 0.72);
    this.muzzleFlashMesh.isPickable = false;
    this.muzzleFlashMesh.setEnabled(false);

    // Web Worker for Greedy Meshing
    this.mesherWorker = new Worker(
      new URL('./greedyMesher.worker.ts', import.meta.url),
      { type: 'module' },
    );
    this.mesherWorker.onmessage = (ev) => this.handleWorkerChunkBuilt(ev.data);

    // Initial Title preview island (120x120m high-res vista at 0.3125m voxels)
    this.grid = createProceduralIsland(1337, 384, 80, 384);
    const previewCx = (this.grid.dimX * VOXEL_SIZE) / 2;
    const previewCz = (this.grid.dimZ * VOXEL_SIZE) / 2;
    this.waterMesh.position.set(previewCx, WATER_LEVEL_WORLD - 0.12, previewCz);
    this.abyssFloorMesh.position.set(previewCx, 0.25, previewCz);
    this.camera.position.set(previewCx + 52, 26, previewCz + 52);
    this.rebuildAllChunks();

    this.bindInputListeners();
    this.attachContextListeners();

    this.engine.runRenderLoop(() => {
      if (this.disposed) return;
      const rawDt = this.engine.getDeltaTime() / 1000;
      const dt = Math.min(0.05, Math.max(0.001, rawDt));
      this.updateFrame(dt);
      this.scene.render();
    });
  }

  private attachContextListeners(): void {
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.callbacks.onContextLost?.(true);
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.callbacks.onContextLost?.(false);
    });
  }

  public setMode(mode: 'title' | 'playing' | 'paused' | 'gameover'): void {
    this.mode = mode;
    if (mode !== 'playing') {
      this.keysPressed.clear();
      this.mouseDown = false;
      this.rightMouseDown = false;
      this.lastMouseClientX = null;
      this.lastMouseClientY = null;
      this.cursorEdgeTurn = 0;
      this.cursorOverCanvas = false;
      if (document.pointerLockElement === this.canvas) {
        document.exitPointerLock?.();
      }
      this.viewModelAnchor.setEnabled(false);
    }
  }

  public setPromptOpen(open: boolean): void {
    this.promptOpen = open;
    if (open) {
      this.keysPressed.clear();
      this.mouseDown = false;
      this.rightMouseDown = false;
      this.lastMouseClientX = null;
      this.lastMouseClientY = null;
      this.cursorEdgeTurn = 0;
      this.cursorOverCanvas = false;
      if (document.pointerLockElement === this.canvas) {
        document.exitPointerLock?.();
      }
    }
  }

  public setAssetManifest(manifest: AssetManifest | null): void {
    this.assetManifest = manifest;
  }

  private getAsset(id: string | undefined): AssetEntry | null {
    if (!id || !this.assetManifest) return null;
    return this.assetManifest.assets.find((asset) => asset.id === id) ?? null;
  }

  private getAssetUrl(id: string | undefined): string | null {
    return resolveAssetUrl(this.getAsset(id), this.assetManifest);
  }

  public loadRoomInit(init: RoomInitPayload): void {
    this.localPlayerId = init.playerId;
    this.grid = createProceduralIsland(init.seed, init.dimX, init.dimY, init.dimZ);
    this.grid.applyDeltas(init.deltas);
    const cx = (init.dimX * VOXEL_SIZE) / 2;
    const cz = (init.dimZ * VOXEL_SIZE) / 2;
    this.waterMesh.position.set(cx, WATER_LEVEL_WORLD - 0.12, cz);
    this.abyssFloorMesh.position.set(cx, 0.25, cz);

    // Clear old player rigs & dynamic objects
    for (const r of this.playerRigs.values()) {
      r.grappleLine?.dispose();
      r.rig.dispose();
    }
    this.playerRigs.clear();
    for (const m of this.projectileMeshes.values()) m.dispose();
    this.projectileMeshes.clear();
    for (const m of this.lootMeshes.values()) m.dispose();
    this.lootMeshes.clear();
    for (const e of this.entityMeshes.values()) e.node.dispose();
    this.entityMeshes.clear();

    const local = init.players.find((p) => p.id === init.playerId);
    if (local) {
      this.yaw = local.yaw;
      this.pitch = local.pitch;
      this.activeSlot = local.activeSlot;
      this.targetZoom = 0;
      this.currentZoom = 0;
      this.camera.position.set(local.position.x, local.position.y + 1.48, local.position.z);
      this.camera.rotation.set(this.pitch, this.yaw, 0);
    }

    this.rebuildAllChunks();
  }

  public applyVoxelDeltas(deltas: VoxelDelta[]): void {
    if (deltas.length === 0) return;
    for (const d of deltas) {
      this.grid.set(d.vx, d.vy, d.vz, d.mat);
      const cx = Math.floor(d.vx / CHUNK_SIZE);
      const cy = Math.floor(d.vy / CHUNK_SIZE);
      const cz = Math.floor(d.vz / CHUNK_SIZE);
      const lx = d.vx - cx * CHUNK_SIZE;
      const ly = d.vy - cy * CHUNK_SIZE;
      const lz = d.vz - cz * CHUNK_SIZE;

      this.markChunkDirty(cx, cy, cz);
      if (lx === 0) this.markChunkDirty(cx - 1, cy, cz);
      if (lx === CHUNK_SIZE - 1) this.markChunkDirty(cx + 1, cy, cz);
      if (ly === 0) this.markChunkDirty(cx, cy - 1, cz);
      if (ly === CHUNK_SIZE - 1) this.markChunkDirty(cx, cy + 1, cz);
      if (lz === 0) this.markChunkDirty(cx, cy, cz - 1);
      if (lz === CHUNK_SIZE - 1) this.markChunkDirty(cx, cy, cz + 1);
    }
    this.flushDirtyChunks();
  }

  public triggerHitstop(durationSec = 0.048): void {
    this.hitstopTimer = Math.max(this.hitstopTimer, durationSec);
    this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.22);
  }

  public spawnShrapnelBurst(
    center: Vec3,
    voxels: Array<{ vx: number; vy: number; vz: number; mat: number }>,
  ): void {
    if (voxels.length > 0) {
      if (voxels.length > 5) {
        soundSynth.playExplosion();
        this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.35);
      } else {
        soundSynth.playDig();
      }
      const flash = this.blastFlashes[this.blastCursor];
      this.blastCursor = (this.blastCursor + 1) % this.blastFlashes.length;
      const baseScale = voxels.length > 5 ? 0.65 : 0.32;
      flash.mesh.position.set(center.x, center.y, center.z);
      flash.mesh.scaling.set(baseScale, baseScale, baseScale);
      flash.ttl = voxels.length > 5 ? 0.24 : 0.14;
      flash.maxTtl = flash.ttl;
      flash.mat.alpha = voxels.length > 5 ? 0.68 : 0.42;
      flash.mesh.setEnabled(true);
    }

    for (const v of voxels) {
      const p = this.shrapnelPool[this.shrapnelCursor];
      this.shrapnelCursor = (this.shrapnelCursor + 1) % this.SHRAPNEL_CAP;
      const wx = (v.vx + 0.5) * VOXEL_SIZE;
      const wy = (v.vy + 0.5) * VOXEL_SIZE;
      const wz = (v.vz + 0.5) * VOXEL_SIZE;
      const dx = wx - center.x + (Math.random() - 0.5) * 0.4;
      const dy = wy - center.y + 0.5;
      const dz = wz - center.z + (Math.random() - 0.5) * 0.4;
      const len = Math.hypot(dx, dy, dz) || 1;
      const speed = 4 + Math.random() * 8;
      const rgb = MATERIAL_COLORS[v.mat] ?? [180, 180, 180];

      p.active = true;
      p.px = wx;
      p.py = wy;
      p.pz = wz;
      p.vx = (dx / len) * speed;
      p.vy = (dy / len) * speed + 2.5;
      p.vz = (dz / len) * speed;
      p.rx = Math.random() * 6;
      p.ry = Math.random() * 6;
      p.scale = 0.8 + Math.random() * 0.5;
      p.ttl = 1.2 + Math.random() * 0.9;
      p.color = [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
    }
  }

  public applyRoomTick(tick: RoomTickPayload): void {
    this.latestTick = tick;
    this.targetWaterY = tick.waterLevelWorld ?? WATER_LEVEL_WORLD;
    this.syncPlayers(tick.players);
    this.syncProjectiles(tick.projectiles);
    this.syncLootDrops(tick.lootDrops);
    this.syncEntities(tick.entities);
    this.applyWeatherAtmosphere(tick.activeEvents);
    this.syncEventWaypoints(tick.activeEvents);
  }

  public getZoomMeters(): number {
    return this.targetZoom;
  }

  public requestPointerLock(): void {
    if (this.mode === 'playing' && !this.promptOpen) {
      try {
        const res = this.canvas.requestPointerLock?.() as unknown as Promise<void> | undefined;
        if (res && typeof res.catch === 'function') {
          res.catch(() => {
            // Ignore sandboxed iframe or browser pointer-lock rejection
          });
        }
      } catch {
        // Ignore headless pointer lock restriction
      }
    }
  }

  private rebuildAllChunks(): void {
    for (const m of this.chunkMeshes.values()) m.dispose();
    this.chunkMeshes.clear();
    this.dirtyChunks.clear();
    this.pendingChunkQueue = [];
    this.pendingChunkSet.clear();

    const cxMax = Math.ceil(this.grid.dimX / CHUNK_SIZE);
    const cyMax = Math.ceil(this.grid.dimY / CHUNK_SIZE);
    const czMax = Math.ceil(this.grid.dimZ / CHUNK_SIZE);

    for (let cy = 0; cy < cyMax; cy++) {
      for (let cz = 0; cz < czMax; cz++) {
        for (let cx = 0; cx < cxMax; cx++) {
          this.markChunkDirty(cx, cy, cz);
        }
      }
    }
    this.flushDirtyChunks(220);
  }

  private markChunkDirty(cx: number, cy: number, cz: number): void {
    const cxMax = Math.ceil(this.grid.dimX / CHUNK_SIZE);
    const cyMax = Math.ceil(this.grid.dimY / CHUNK_SIZE);
    const czMax = Math.ceil(this.grid.dimZ / CHUNK_SIZE);
    if (cx < 0 || cy < 0 || cz < 0 || cx >= cxMax || cy >= cyMax || cz >= czMax) {
      return;
    }
    this.dirtyChunks.add(`${cx},${cy},${cz}`);
  }

  private dispatchChunkKey(key: string): void {
    const [cx, cy, cz] = key.split(',').map(Number);
    const pSize = CHUNK_SIZE + 2;
    const padded = new Uint8Array(pSize * pSize * pSize);
    const baseX = cx * CHUNK_SIZE;
    const baseY = cy * CHUNK_SIZE;
    const baseZ = cz * CHUNK_SIZE;

    let hasSolid = false;
    for (let ly = -1; ly <= CHUNK_SIZE; ly++) {
      for (let lz = -1; lz <= CHUNK_SIZE; lz++) {
        for (let lx = -1; lx <= CHUNK_SIZE; lx++) {
          const mat = this.grid.get(baseX + lx, baseY + ly, baseZ + lz);
          if (mat !== 0) {
            hasSolid = true;
            padded[lx + 1 + (lz + 1) * pSize + (ly + 1) * pSize * pSize] = mat;
          }
        }
      }
    }

    if (!hasSolid) {
      const existing = this.chunkMeshes.get(key);
      if (existing) {
        existing.dispose();
        this.chunkMeshes.delete(key);
      }
      return;
    }

    const jobId = this.mesherJobSeq++;
    this.pendingJobs.set(jobId, key);
    this.mesherWorker.postMessage(
      {
        jobId,
        cx,
        cy,
        cz,
        chunkSize: CHUNK_SIZE,
        voxelSize: VOXEL_SIZE,
        padded,
      },
      [padded.buffer],
    );
  }

  private flushDirtyChunks(immediateLimit = 72): void {
    if (this.dirtyChunks.size === 0) return;

    const camX = this.camera.position.x;
    const camY = this.camera.position.y;
    const camZ = this.camera.position.z;
    const chunkWorldSpan = CHUNK_SIZE * VOXEL_SIZE;
    const sorted = Array.from(this.dirtyChunks)
      .map((key) => {
        const [cx, cy, cz] = key.split(',').map(Number);
        const dx = (cx + 0.5) * chunkWorldSpan - camX;
        const dy = (cy + 0.5) * chunkWorldSpan - camY;
        const dz = (cz + 0.5) * chunkWorldSpan - camZ;
        return { key, distSq: dx * dx + dy * dy + dz * dz };
      })
      .sort((a, b) => a.distSq - b.distSq);

    let sent = 0;
    for (const item of sorted) {
      if (sent < immediateLimit) {
        this.pendingChunkSet.delete(item.key);
        this.dispatchChunkKey(item.key);
        sent++;
      } else if (!this.pendingChunkSet.has(item.key)) {
        this.pendingChunkSet.add(item.key);
        this.pendingChunkQueue.push(item.key);
      }
    }
    this.dirtyChunks.clear();
  }

  private drainPendingChunks(maxPerFrame = 20): void {
    let processed = 0;
    while (processed < maxPerFrame && this.pendingChunkQueue.length > 0) {
      const key = this.pendingChunkQueue.shift()!;
      this.pendingChunkSet.delete(key);
      this.dispatchChunkKey(key);
      processed++;
    }
  }

  private handleWorkerChunkBuilt(data: {
    jobId: number;
    cx: number;
    cy: number;
    cz: number;
    positions: Float32Array;
    normals: Float32Array;
    colors: Float32Array;
    indices: Uint32Array;
  }): void {
    if (this.disposed) return;
    const key = this.pendingJobs.get(data.jobId);
    this.pendingJobs.delete(data.jobId);
    if (!key) return;

    let mesh = this.chunkMeshes.get(key);
    if (data.indices.length === 0) {
      if (mesh) {
        mesh.dispose();
        this.chunkMeshes.delete(key);
      }
      return;
    }

    if (!mesh) {
      mesh = new Mesh(`chunk_${key}`, this.scene);
      mesh.material = this.chunkMat;
      mesh.isPickable = false;
      mesh.receiveShadows = Boolean(this.shadowGenerator);
      this.chunkMeshes.set(key, mesh);
    }

    const vData = new VertexData();
    vData.positions = data.positions;
    vData.normals = data.normals;
    vData.colors = data.colors;
    vData.indices = data.indices;
    vData.applyToMesh(mesh, false);
  }

  private syncPlayers(players: PlayerNetState[]): void {
    const seen = new Set<string>();
    for (const p of players) {
      seen.add(p.id);
      if (p.slots[p.activeSlot]?.weapon) {
        const w = p.slots[p.activeSlot]!.weapon!;
        this.weaponCache.set(w.id, w);
      }

      let entry = this.playerRigs.get(p.id);
      if (!entry) {
        const rig = buildPlayerAvatarMesh(this.scene, p.id, p.color);
        if (this.shadowGenerator) {
          for (const m of rig.bodyGroup.getChildMeshes()) {
            this.shadowGenerator.addShadowCaster(m, false);
          }
        }
        entry = {
          rig,
          targetPos: new Vector3(p.position.x, p.position.y, p.position.z),
          currentPos: new Vector3(p.position.x, p.position.y, p.position.z),
          targetYaw: p.yaw,
          currentYaw: p.yaw,
          equippedKey: '',
          equippedNode: null,
          grappleLine: null,
        };
        this.playerRigs.set(p.id, entry);
      }

      entry.rig.root.setEnabled(p.alive);
      entry.targetPos.set(p.position.x, p.position.y, p.position.z);
      entry.targetYaw = p.yaw;

      const nowMs = Date.now();
      if (nowMs < p.burnUntil) {
        entry.rig.primaryMat.emissiveColor.set(0.75, 0.25, 0.04);
        if (p.alive && Math.random() < 0.35) {
          const sp = this.shrapnelPool[this.shrapnelCursor];
          this.shrapnelCursor = (this.shrapnelCursor + 1) % this.SHRAPNEL_CAP;
          sp.active = true;
          sp.px = p.position.x + (Math.random() - 0.5) * 0.5;
          sp.py = p.position.y + 0.6 + Math.random() * 0.9;
          sp.pz = p.position.z + (Math.random() - 0.5) * 0.5;
          sp.vx = (Math.random() - 0.5) * 0.8;
          sp.vy = 2.6 + Math.random() * 1.4;
          sp.vz = (Math.random() - 0.5) * 0.8;
          sp.rx = 0;
          sp.ry = 0;
          sp.scale = 0.38;
          sp.ttl = 0.35;
          sp.color = [1.0, 0.42, 0.08];
        }
      } else if (nowMs < p.freezeUntil) {
        entry.rig.primaryMat.emissiveColor.set(0.15, 0.6, 0.85);
        if (p.alive && Math.random() < 0.28) {
          const sp = this.shrapnelPool[this.shrapnelCursor];
          this.shrapnelCursor = (this.shrapnelCursor + 1) % this.SHRAPNEL_CAP;
          sp.active = true;
          sp.px = p.position.x + (Math.random() - 0.5) * 0.6;
          sp.py = p.position.y + 0.7 + Math.random() * 0.8;
          sp.pz = p.position.z + (Math.random() - 0.5) * 0.6;
          sp.vx = (Math.random() - 0.5) * 0.5;
          sp.vy = 0.8;
          sp.vz = (Math.random() - 0.5) * 0.5;
          sp.rx = 0;
          sp.ry = 0;
          sp.scale = 0.32;
          sp.ttl = 0.4;
          sp.color = [0.65, 0.92, 1.0];
        }
      } else {
        entry.rig.primaryMat.emissiveColor.set(0, 0, 0);
      }

      // Sync weapon in avatar hand
      const activeItem = p.slots[p.activeSlot] ?? null;
      const itemKey = activeItem
        ? `${activeItem.kind}_${activeItem.weapon?.id ?? activeItem.id}`
        : 'empty';
      if (entry.equippedKey !== itemKey) {
        entry.equippedKey = itemKey;
        if (entry.equippedNode) {
          entry.equippedNode.dispose();
          entry.equippedNode = null;
        }
        if (activeItem) {
          if (activeItem.kind === 'weapon' && activeItem.weapon) {
            const wMesh = buildBlueprintVoxelMesh(
              this.scene,
              `av_wpn_${p.id}_${activeItem.weapon.id}`,
              activeItem.weapon.rleVoxels,
              activeItem.weapon.palette,
              12,
              12,
              24,
              0.036,
              activeItem.weapon.gripPos,
              this.getAssetUrl(
                activeItem.weapon.assets?.find((id) => id.startsWith('texture:weapon:')),
              ),
            );
            wMesh.parent = entry.rig.handSocket;
            entry.equippedNode = wMesh;
          } else if (activeItem.kind === 'shovel' || activeItem.kind === 'grapple') {
            const tNode = buildStarterToolMesh(
              this.scene,
              activeItem.kind,
              `av_tool_${p.id}_${activeItem.kind}`,
            );
            tNode.parent = entry.rig.handSocket;
            entry.equippedNode = tNode;
          }
        }
      }

      // Grapple tether line (offset slightly right/forward in 1P so it streaks visibly from launcher)
      if (p.grappleTarget && p.alive) {
        const isLocalFirstPerson = p.id === this.localPlayerId && this.currentZoom < 0.25;
        const cosY = Math.cos(this.yaw);
        const sinY = Math.sin(this.yaw);
        const start = isLocalFirstPerson
          ? new Vector3(
              p.position.x + cosY * 0.26 + sinY * 0.35,
              p.position.y + 1.22,
              p.position.z - sinY * 0.26 + cosY * 0.35,
            )
          : new Vector3(p.position.x, p.position.y + 1.2, p.position.z);
        const end = new Vector3(p.grappleTarget.x, p.grappleTarget.y, p.grappleTarget.z);
        if (!entry.grappleLine) {
          entry.grappleLine = MeshBuilder.CreateLines(
            `grp_line_${p.id}`,
            { points: [start, end], updatable: true },
            this.scene,
          );
          entry.grappleLine.color = Color3.FromHexString('#06b6d4');
        } else {
          MeshBuilder.CreateLines(
            `grp_line_${p.id}`,
            { points: [start, end], instance: entry.grappleLine },
            this.scene,
          );
        }
      } else if (entry.grappleLine) {
        entry.grappleLine.dispose();
        entry.grappleLine = null;
      }

      // Sync 1st-person viewmodel if local player
      if (p.id === this.localPlayerId) {
        this.syncLocalViewModel(activeItem);
      }
    }

    for (const [id, entry] of this.playerRigs) {
      if (!seen.has(id)) {
        entry.grappleLine?.dispose();
        entry.rig.dispose();
        this.playerRigs.delete(id);
      }
    }
  }

  private syncLocalViewModel(item: InventorySlotItem | null): void {
    const key = item ? `${item.kind}_${item.weapon?.id ?? item.id}` : 'empty';
    if (this.viewModelKey === key) return;
    this.viewModelKey = key;

    if (this.viewModelNode) {
      this.viewModelNode.dispose();
      this.viewModelNode = null;
    }

    if (!item) return;
    if (item.kind === 'weapon' && item.weapon) {
      const mesh = buildBlueprintVoxelMesh(
        this.scene,
        `vm_wpn_${item.weapon.id}`,
        item.weapon.rleVoxels,
        item.weapon.palette,
        12,
        12,
        24,
        0.042,
        item.weapon.gripPos,
        this.getAssetUrl(
          item.weapon.assets?.find((id) => id.startsWith('texture:weapon:')),
        ),
      );
      mesh.parent = this.viewModelAnchor;
      this.viewModelNode = mesh;
    } else if (item.kind === 'shovel' || item.kind === 'grapple') {
      const node = buildStarterToolMesh(this.scene, item.kind, `vm_${item.kind}`);
      node.parent = this.viewModelAnchor;
      this.viewModelNode = node;
    }
  }

  private syncProjectiles(projectiles: ProjectileNetState[]): void {
    const seen = new Set<string>();
    for (const pr of projectiles) {
      seen.add(pr.id);
      let mesh = this.projectileMeshes.get(pr.id);
      if (!mesh) {
        mesh = MeshBuilder.CreateBox(
          `prj_${pr.id}`,
          { width: 0.2, height: 0.2, depth: 0.65 },
          this.scene,
        );
        const mat = new StandardMaterial(`prj_mat_${pr.id}`, this.scene);
        const c = Color3.FromHexString(pr.color || '#38bdf8');
        mat.diffuseColor = c;
        mat.emissiveColor = c;
        mat.disableLighting = true;
        mesh.material = mat;
        this.projectileMeshes.set(pr.id, mesh);
      }
      mesh.position.set(pr.position.x, pr.position.y, pr.position.z);
      mesh.lookAt(
        new Vector3(
          pr.position.x + pr.velocity.x,
          pr.position.y + pr.velocity.y,
          pr.position.z + pr.velocity.z,
        ),
      );

      // Emit subtle glowing tracer ember into zero-GC shrapnel pool
      if (Math.random() < 0.45) {
        const p = this.shrapnelPool[this.shrapnelCursor];
        this.shrapnelCursor = (this.shrapnelCursor + 1) % this.SHRAPNEL_CAP;
        const c = Color3.FromHexString(pr.color || '#38bdf8');
        p.active = true;
        p.px = pr.position.x + (Math.random() - 0.5) * 0.1;
        p.py = pr.position.y + (Math.random() - 0.5) * 0.1;
        p.pz = pr.position.z + (Math.random() - 0.5) * 0.1;
        p.vx = -pr.velocity.x * 0.04;
        p.vy = 0.6;
        p.vz = -pr.velocity.z * 0.04;
        p.rx = 0;
        p.ry = 0;
        p.scale = 0.35;
        p.ttl = 0.22;
        p.color = [c.r, c.g, c.b];
      }
    }

    for (const [id, m] of this.projectileMeshes) {
      if (!seen.has(id)) {
        m.dispose();
        this.projectileMeshes.delete(id);
      }
    }
  }

  private syncLootDrops(drops: LootDropState[]): void {
    const seen = new Set<string>();
    for (const d of drops) {
      seen.add(d.id);
      let node = this.lootMeshes.get(d.id);
      if (!node) {
        node = new TransformNode(`loot_${d.id}`, this.scene);
        const box = MeshBuilder.CreateBox(
          `loot_box_${d.id}`,
          { width: 0.55, height: 0.35, depth: 0.55 },
          this.scene,
        );
        const mat = new StandardMaterial(`loot_mat_${d.id}`, this.scene);
        const col = d.item.kind === 'weapon' ? '#f59e0b' : '#38bdf8';
        mat.diffuseColor = Color3.FromHexString(col);
        mat.emissiveColor = Color3.FromHexString(col).scale(0.45);
        box.material = mat;
        box.parent = node;

        const ring = MeshBuilder.CreateCylinder(
          `loot_ring_${d.id}`,
          { diameter: 0.9, height: 0.04, tessellation: 16 },
          this.scene,
        );
        ring.position.y = -0.22;
        const rMat = new StandardMaterial(`loot_rmat_${d.id}`, this.scene);
        rMat.emissiveColor = Color3.FromHexString(col);
        rMat.disableLighting = true;
        rMat.alpha = 0.55;
        ring.material = rMat;
        ring.parent = node;

        this.lootMeshes.set(d.id, node);
      }
      node.position.set(
        d.position.x,
        d.position.y + 0.25 + Math.sin(this.animTime * 3 + d.position.x) * 0.1,
        d.position.z,
      );
      node.rotation.y += 0.03;
    }

    for (const [id, n] of this.lootMeshes) {
      if (!seen.has(id)) {
        n.dispose();
        this.lootMeshes.delete(id);
      }
    }
  }

  private syncEntities(entities: SpawnedEntityNetState[]): void {
    const seen = new Set<string>();
    for (const ent of entities) {
      seen.add(ent.id);
      let entry = this.entityMeshes.get(ent.id);
      if (!entry) {
        const node = new TransformNode(`ent_${ent.id}`, this.scene);
        if (ent.blueprint) {
          const mesh = buildBlueprintVoxelMesh(
            this.scene,
            `ent_mesh_${ent.id}`,
            ent.blueprint.rleVoxels,
            ent.blueprint.palette,
            16,
            16,
            16,
            0.075,
            [8, 0, 8],
          );
          mesh.parent = node;
          if (this.shadowGenerator) {
            this.shadowGenerator.addShadowCaster(mesh, false);
          }
        } else {
          const fallback = MeshBuilder.CreateBox(`ent_fb_${ent.id}`, { size: 0.9 }, this.scene);
          fallback.position.y = 0.45;
          fallback.parent = node;
        }

        const entShadow = MeshBuilder.CreateCylinder(
          `ent_shd_${ent.id}`,
          { diameter: 1.0, height: 0.02, tessellation: 14 },
          this.scene,
        );
        entShadow.position.y = 0.02;
        const esMat = new StandardMaterial(`esmat_${ent.id}`, this.scene);
        esMat.diffuseColor = Color3.Black();
        esMat.alpha = 0.28;
        entShadow.material = esMat;
        entShadow.isPickable = false;
        entShadow.parent = node;

        if (ent.kind === 'supply_crate') {
          const beacon = MeshBuilder.CreateCylinder(
            `beacon_${ent.id}`,
            { diameter: 0.18, height: 24 },
            this.scene,
          );
          beacon.position.y = 12;
          const bMat = new StandardMaterial(`bmat_${ent.id}`, this.scene);
          bMat.emissiveColor = Color3.FromHexString('#22d3ee');
          bMat.alpha = 0.32;
          beacon.material = bMat;
          beacon.parent = node;

          // Stylized voxel parachute canopy while descending
          const chute = MeshBuilder.CreateBox(
            `chute_${ent.id}`,
            { width: 2.2, height: 0.35, depth: 2.2 },
            this.scene,
          );
          chute.position.y = 2.4;
          const cMat = new StandardMaterial(`cmat_${ent.id}`, this.scene);
          cMat.diffuseColor = Color3.FromHexString('#f59e0b');
          cMat.emissiveColor = Color3.FromHexString('#78350f');
          chute.material = cMat;
          chute.parent = node;
        }

        node.position.set(ent.position.x, ent.position.y, ent.position.z);
        entry = {
          node,
          targetPos: new Vector3(ent.position.x, ent.position.y, ent.position.z),
        };
        this.entityMeshes.set(ent.id, entry);
      }
      entry.targetPos.set(ent.position.x, ent.position.y, ent.position.z);
      if (ent.kind === 'supply_crate') {
        const chuteMesh = entry.node.getChildMeshes().find((m) => m.name.startsWith('chute_'));
        if (chuteMesh) {
          chuteMesh.setEnabled(ent.velocity.y < -0.3);
        }
      }
    }

    for (const [id, e] of this.entityMeshes) {
      if (!seen.has(id)) {
        e.node.dispose();
        this.entityMeshes.delete(id);
      }
    }
  }

  private syncEventWaypoints(events: MapEventState[]): void {
    const seen = new Set<string>();
    for (const evt of events) {
      if (!evt.assets?.includes('waypoint:event')) continue;
      seen.add(evt.id);
      let mesh = this.eventWaypointMeshes.get(evt.id);
      if (!mesh) {
        const waypoint = this.getAsset('waypoint:event');
        const radius = Number(waypoint?.params.radius ?? 2.5);
        mesh = MeshBuilder.CreateTorus(
          `evt_wp_${evt.id}`,
          { diameter: Math.max(1, radius * 2), thickness: 0.12, tessellation: 28 },
          this.scene,
        );
        const fxAsset = this.getAsset(
          evt.assets.find((id) => id.startsWith('fx:event:')),
        );
        const colorHex =
          typeof fxAsset?.params.color === 'string' ? fxAsset.params.color : '#f59e0b';
        const mat = new StandardMaterial(`evt_wp_mat_${evt.id}`, this.scene);
        const color = Color3.FromHexString(colorHex);
        mat.emissiveColor = color;
        mat.diffuseColor = color;
        mat.disableLighting = true;
        mat.alpha = 0.72;
        mesh.material = mat;
        this.eventWaypointMeshes.set(evt.id, mesh);
      }
      mesh.position.set(evt.center[0], evt.center[1] + 0.08, evt.center[2]);
      mesh.setEnabled(true);
    }
    for (const [id, mesh] of this.eventWaypointMeshes) {
      if (!seen.has(id)) {
        mesh.dispose();
        this.eventWaypointMeshes.delete(id);
      }
    }
  }

  private applyWeatherAtmosphere(events: MapEventState[]): void {
    const activeWeather = events.find(
      (e) => e.warningRemainingSec <= 0 && e.archetype === 'WEATHER_HAZARD',
    );
    if (!activeWeather) {
      this.activeWeatherKind = null;
      this.weatherBaseMesh.setEnabled(false);
      if (this.camera.position.y < this.currentWaterY) {
        this.scene.fogColor.set(0.06, 0.34, 0.52);
        this.scene.clearColor.set(0.05, 0.26, 0.42, 1);
        this.scene.fogDensity = 0.042;
      } else {
        this.scene.fogColor.set(0.66, 0.84, 0.96);
        this.scene.clearColor.set(0.42, 0.72, 0.94, 1);
        this.scene.fogDensity = 0.0022;
      }
      return;
    }

    const wk = activeWeather.params.weatherKind ?? 'meteor_shower';
    this.activeWeatherKind = wk;
    this.weatherBaseMesh.setEnabled(wk === 'acid_rain' || wk === 'blizzard' || wk === 'meteor_shower');
    if (wk === 'blizzard') {
      this.scene.fogColor.set(0.84, 0.91, 0.98);
      this.scene.clearColor.set(0.8, 0.88, 0.96, 1);
      this.scene.fogDensity = 0.022;
    } else if (wk === 'acid_rain') {
      this.scene.fogColor.set(0.32, 0.45, 0.25);
      this.scene.clearColor.set(0.28, 0.4, 0.22, 1);
      this.scene.fogDensity = 0.015;
    } else if (wk === 'meteor_shower' || wk === 'earthquake') {
      this.scene.fogColor.set(0.42, 0.25, 0.22);
      this.scene.clearColor.set(0.38, 0.22, 0.2, 1);
      this.scene.fogDensity = 0.012;
    }
  }

  private updateFrame(dt: number): void {
    this.animTime += dt;
    this.drainPendingChunks(36);

    // Drift sky clouds lazily across larger island span
    for (let i = 0; i < this.clouds.length; i++) {
      const c = this.clouds[i];
      c.position.x += dt * (0.45 + (i % 3) * 0.2);
      if (c.position.x > 290) c.position.x = -65;
    }

    // Smooth rising tide water level + subtle wave bob
    this.currentWaterY += (this.targetWaterY - this.currentWaterY) * (1 - Math.exp(-3 * dt));
    this.waterMesh.position.y =
      this.currentWaterY - 0.12 + Math.sin(this.animTime * 1.4) * 0.04;

    // Update explosion shockwave flashes
    for (const f of this.blastFlashes) {
      if (f.ttl <= 0) continue;
      f.ttl -= dt;
      if (f.ttl <= 0) {
        f.mesh.setEnabled(false);
        continue;
      }
      const p = 1 - f.ttl / f.maxTtl;
      const sc = 0.8 + p * 4.2;
      f.mesh.scaling.set(sc, sc, sc);
      f.mat.alpha = (1 - p) * 0.65;
    }

    // Hitstop micro-freeze for crisp heavy impact feel (40-60ms)
    if (this.hitstopTimer > 0) {
      this.hitstopTimer = Math.max(0, this.hitstopTimer - dt);
      dt *= 0.15;
    }

    // Update weather particle pool when active
    if (
      this.activeWeatherKind === 'acid_rain' ||
      this.activeWeatherKind === 'blizzard' ||
      this.activeWeatherKind === 'meteor_shower'
    ) {
      const camPos = this.camera.position;
      const isRain = this.activeWeatherKind === 'acid_rain';
      const isSnow = this.activeWeatherKind === 'blizzard';
      const fallSpeed = isRain ? 22 : isSnow ? 4.5 : 18;
      const driftX = isRain ? 1.5 : isSnow ? 3.2 : 6.0;
      const sx = isRain ? 0.3 : isSnow ? 0.8 : 1.0;
      const sy = isRain ? 3.4 : isSnow ? 0.8 : 2.2;
      const col: [number, number, number] = isRain
        ? [0.45, 0.95, 0.35]
        : isSnow
          ? [0.9, 0.96, 1.0]
          : [1.0, 0.45, 0.12];

      for (let i = 0; i < this.WEATHER_CAP; i++) {
        const wp = this.weatherPool[i];
        wp.y -= fallSpeed * wp.speed * dt;
        wp.x += driftX * wp.speed * dt;
        if (wp.y < -3) wp.y = 18;
        if (wp.x > 18) wp.x = -18;
        this.scratchScale.set(sx, sy, sx);
        this.scratchPos.set(camPos.x + wp.x, Math.max(1, camPos.y + wp.y - 4), camPos.z + wp.z);
        this.scratchQuat.set(0, 0, 0, 1);
        Matrix.ComposeToRef(
          this.scratchScale,
          this.scratchQuat,
          this.scratchPos,
          this.scratchMat,
        );
        this.scratchMat.copyToArray(this.weatherMatrices, i * 16);
        this.weatherColors[i * 4] = col[0];
        this.weatherColors[i * 4 + 1] = col[1];
        this.weatherColors[i * 4 + 2] = col[2];
        this.weatherColors[i * 4 + 3] = 1;
      }
      this.weatherBaseMesh.thinInstanceBufferUpdated('matrix');
      this.weatherBaseMesh.thinInstanceBufferUpdated('color');
    }

    // Update shrapnel ring buffer
    let shrapDirty = false;
    for (let i = 0; i < this.SHRAPNEL_CAP; i++) {
      const p = this.shrapnelPool[i];
      if (!p.active) continue;
      shrapDirty = true;
      p.ttl -= dt;
      if (p.ttl <= 0) {
        p.active = false;
        Matrix.Scaling(0, 0, 0).copyToArray(this.shrapnelMatrices, i * 16);
        continue;
      }
      p.vy -= 22 * dt;
      p.px += p.vx * dt;
      p.py += p.vy * dt;
      p.pz += p.vz * dt;
      p.rx += 5 * dt;
      p.ry += 4 * dt;

      const gx = Math.floor(p.px / VOXEL_SIZE);
      const gy = Math.floor(p.py / VOXEL_SIZE);
      const gz = Math.floor(p.pz / VOXEL_SIZE);
      if (this.grid.isSolid(gx, gy, gz) && p.vy < 0) {
        p.vy *= -0.4;
        p.vx *= 0.65;
        p.vz *= 0.65;
        p.py = (gy + 1) * VOXEL_SIZE + 0.08;
      }

      const s = p.scale * Math.min(1, p.ttl * 2.5);
      this.scratchScale.set(s, s, s);
      this.scratchPos.set(p.px, p.py, p.pz);
      Quaternion.RotationYawPitchRollToRef(p.ry, p.rx, 0, this.scratchQuat);
      Matrix.ComposeToRef(
        this.scratchScale,
        this.scratchQuat,
        this.scratchPos,
        Matrix.Identity(),
      ).copyToArray(this.shrapnelMatrices, i * 16);

      this.shrapnelColors[i * 4] = p.color[0];
      this.shrapnelColors[i * 4 + 1] = p.color[1];
      this.shrapnelColors[i * 4 + 2] = p.color[2];
      this.shrapnelColors[i * 4 + 3] = 1;
    }
    if (shrapDirty) {
      this.shrapnelBaseMesh.thinInstanceBufferUpdated('matrix');
      this.shrapnelBaseMesh.thinInstanceBufferUpdated('color');
    }

    // Interpolate player avatars & entities
    const lerpAlpha = 1 - Math.exp(-16 * dt);
    for (const [id, entry] of this.playerRigs) {
      Vector3.LerpToRef(entry.currentPos, entry.targetPos, lerpAlpha, entry.currentPos);
      entry.rig.root.position.copyFrom(entry.currentPos);
      entry.rig.root.rotation.y = id === this.localPlayerId ? this.yaw : entry.targetYaw;

      const speed = entry.targetPos.subtract(entry.currentPos).length();
      if (speed > 0.02) {
        const swing = Math.sin(this.animTime * 11) * 0.45;
        entry.rig.leftLeg.rotation.x = swing;
        entry.rig.rightLeg.rotation.x = -swing;
      } else {
        entry.rig.leftLeg.rotation.x *= 0.85;
        entry.rig.rightLeg.rotation.x *= 0.85;
      }

      // Hide local avatar mesh when in 1st-person view
      if (id === this.localPlayerId) {
        entry.rig.bodyGroup.setEnabled(this.currentZoom >= 0.75);
      }
    }

    for (const e of this.entityMeshes.values()) {
      Vector3.LerpToRef(e.node.position, e.targetPos, lerpAlpha, e.node.position);
    }

    if (this.mode === 'title') {
      this.flyoverAngle += dt * 0.11;
      const cx = (this.grid.dimX * VOXEL_SIZE) / 2;
      const cz = (this.grid.dimZ * VOXEL_SIZE) / 2;
      const r = Math.max(46, this.grid.dimX * VOXEL_SIZE * 0.42);
      this.camera.position.set(
        cx + Math.cos(this.flyoverAngle) * r,
        30 + Math.sin(this.flyoverAngle * 1.3) * 4.0,
        cz + Math.sin(this.flyoverAngle) * r,
      );
      this.camera.setTarget(new Vector3(cx, 11, cz));
      return;
    }

    if (this.mode !== 'playing') return;

    // Continuous smooth edge-turning when pointer lock is unavailable (e.g. iframe)
    if (
      !this.promptOpen &&
      document.pointerLockElement !== this.canvas &&
      this.cursorOverCanvas &&
      Math.abs(this.cursorEdgeTurn) > 0.01
    ) {
      this.yaw += this.cursorEdgeTurn * 2.1 * dt;
    }

    // Playing mode camera & movement input
    const localPlayer = this.latestTick?.players.find((p) => p.id === this.localPlayerId);
    if (localPlayer) {
      this.sendInputFrame(false);
    }

    // Smooth camera zoom (0m = 1st person, 0.5..7.0m = 3rd person)
    this.currentZoom += (this.targetZoom - this.currentZoom) * (1 - Math.exp(-14 * dt));

    const localRig = this.localPlayerId ? this.playerRigs.get(this.localPlayerId) : null;
    const anchorPos = localRig
      ? localRig.currentPos
      : new Vector3(
          (this.grid.dimX * VOXEL_SIZE) / 2,
          10,
          (this.grid.dimZ * VOXEL_SIZE) / 2,
        );

    const eyePos = new Vector3(anchorPos.x, anchorPos.y + 1.48, anchorPos.z);
    const cosP = Math.cos(this.pitch);
    const lookDir = new Vector3(
      Math.sin(this.yaw) * cosP,
      -Math.sin(this.pitch),
      Math.cos(this.yaw) * cosP,
    );

    if (this.muzzleFlashTimer > 0) {
      this.muzzleFlashTimer = Math.max(0, this.muzzleFlashTimer - dt);
      if (this.muzzleFlashTimer <= 0) this.muzzleFlashMesh.setEnabled(false);
    }

    if (this.currentZoom < 0.25) {
      this.camera.position.copyFrom(eyePos);
      this.viewModelAnchor.setEnabled(Boolean(localPlayer?.alive));
      this.recoilKick = Math.max(0, this.recoilKick - dt * 6);
      const isMoving =
        !this.promptOpen &&
        (this.keysPressed.has('KeyW') ||
          this.keysPressed.has('KeyA') ||
          this.keysPressed.has('KeyS') ||
          this.keysPressed.has('KeyD'));
      const bobX = isMoving ? Math.cos(this.animTime * 9) * 0.016 : Math.cos(this.animTime * 1.8) * 0.004;
      const bobY = isMoving ? Math.abs(Math.sin(this.animTime * 9)) * 0.018 : Math.sin(this.animTime * 1.8) * 0.004;
      this.viewModelAnchor.position.set(
        0.32 + bobX,
        -0.25 - bobY,
        0.56 - this.recoilKick * 0.14,
      );
      this.viewModelAnchor.rotation.x = this.recoilKick * 0.35;
    } else {
      this.viewModelAnchor.setEnabled(false);
      // DDA wall pull-in so 3rd person never clips behind cliffs/walls
      const backHit = raycastVoxels(
        this.grid,
        eyePos.x,
        eyePos.y,
        eyePos.z,
        -lookDir.x,
        -lookDir.y,
        -lookDir.z,
        this.currentZoom,
      );
      const safeDist = backHit.hit ? Math.max(0.5, backHit.distance - 0.35) : this.currentZoom;
      this.camera.position.set(
        eyePos.x - lookDir.x * safeDist,
        eyePos.y - lookDir.y * safeDist + 0.35,
        eyePos.z - lookDir.z * safeDist,
      );
    }

    // Decaying trauma shake + earthquake micro-tremor
    this.cameraTrauma = Math.max(0, this.cameraTrauma - dt * 2.2);
    const quake = this.activeWeatherKind === 'earthquake' ? 0.045 : 0;
    const shake = this.cameraTrauma * this.cameraTrauma * 0.12 + quake;
    this.scratchVec.set(
      eyePos.x + lookDir.x * 25 + (Math.random() - 0.5) * shake,
      eyePos.y + lookDir.y * 25 + (Math.random() - 0.5) * shake,
      eyePos.z + lookDir.z * 25,
    );
    this.camera.setTarget(this.scratchVec);

    // Throttled crosshair context detection (shovel/grapple/enemy target feedback)
    this.aimCheckAccum += dt;
    if (this.aimCheckAccum >= 0.1 && this.callbacks.onAimContextChange && localPlayer) {
      this.aimCheckAccum = 0;
      const item = localPlayer.slots[localPlayer.activeSlot];
      let nextCtx: 'neutral' | 'dig' | 'grapple' | 'enemy' = 'neutral';
      if (item?.kind === 'shovel') {
        const hit = raycastVoxels(this.grid, eyePos.x, eyePos.y, eyePos.z, lookDir.x, lookDir.y, lookDir.z, 6.0);
        if (hit.hit) nextCtx = 'dig';
      } else if (item?.kind === 'grapple') {
        const hit = raycastVoxels(this.grid, eyePos.x, eyePos.y, eyePos.z, lookDir.x, lookDir.y, lookDir.z, 44);
        if (hit.hit) {
          nextCtx = 'grapple';
        } else {
          for (const other of this.latestTick?.players ?? []) {
            if (!other.alive || other.id === this.localPlayerId) continue;
            const dx = other.position.x - eyePos.x;
            const dy = other.position.y + 0.9 - eyePos.y;
            const dz = other.position.z - eyePos.z;
            const proj = dx * lookDir.x + dy * lookDir.y + dz * lookDir.z;
            if (proj > 0 && proj <= 44 && dx * dx + dy * dy + dz * dz - proj * proj <= 1.0) {
              nextCtx = 'grapple';
              break;
            }
          }
          if (nextCtx === 'neutral') {
            for (const ent of this.latestTick?.entities ?? []) {
              if (ent.kind !== 'creature') continue;
              const dx = ent.position.x - eyePos.x;
              const dy = ent.position.y + 0.6 - eyePos.y;
              const dz = ent.position.z - eyePos.z;
              const proj = dx * lookDir.x + dy * lookDir.y + dz * lookDir.z;
              if (proj > 0 && proj <= 44 && dx * dx + dy * dy + dz * dz - proj * proj <= 1.2) {
                nextCtx = 'grapple';
                break;
              }
            }
          }
        }
      } else if (item?.kind === 'weapon' && item.weapon) {
        const range = item.weapon.stats.rangeMeters;
        for (const other of this.latestTick?.players ?? []) {
          if (!other.alive || other.id === this.localPlayerId) continue;
          const dx = other.position.x - eyePos.x;
          const dy = other.position.y + 0.9 - eyePos.y;
          const dz = other.position.z - eyePos.z;
          const proj = dx * lookDir.x + dy * lookDir.y + dz * lookDir.z;
          if (proj > 0 && proj <= range) {
            const perpSq = dx * dx + dy * dy + dz * dz - proj * proj;
            if (perpSq <= 1.0) {
              nextCtx = 'enemy';
              break;
            }
          }
        }
        if (nextCtx === 'neutral') {
          for (const ent of this.latestTick?.entities ?? []) {
            if (ent.kind !== 'creature') continue;
            const dx = ent.position.x - eyePos.x;
            const dy = ent.position.y + 0.6 - eyePos.y;
            const dz = ent.position.z - eyePos.z;
            const proj = dx * lookDir.x + dy * lookDir.y + dz * lookDir.z;
            if (proj > 0 && proj <= range) {
              const perpSq = dx * dx + dy * dy + dz * dz - proj * proj;
              if (perpSq <= 1.2) {
                nextCtx = 'enemy';
                break;
              }
            }
          }
        }
      }
      if (nextCtx !== this.lastAimContext) {
        this.lastAimContext = nextCtx;
        this.callbacks.onAimContextChange(nextCtx);
      }
    }

    // Continuous fire/dig while holding primary button
    if (this.mouseDown && !this.promptOpen && localPlayer?.alive) {
      const slotItem = localPlayer.slots[localPlayer.activeSlot];
      if (slotItem?.kind === 'weapon' || slotItem?.kind === 'shovel') {
        this.triggerPrimaryAction();
      }
    }
  }

  private sendInputFrame(force = false): void {
    let moveX = 0;
    let moveZ = 0;
    if (!this.promptOpen) {
      if (this.keysPressed.has('KeyW') || this.keysPressed.has('ArrowUp')) moveZ += 1;
      if (this.keysPressed.has('KeyS') || this.keysPressed.has('ArrowDown')) moveZ -= 1;
      if (this.keysPressed.has('KeyD') || this.keysPressed.has('ArrowRight')) moveX += 1;
      if (this.keysPressed.has('KeyA') || this.keysPressed.has('ArrowLeft')) moveX -= 1;
    }

    const jump = !this.promptOpen && this.keysPressed.has('Space');
    this.callbacks.onSendInput(
      {
        moveX,
        moveZ,
        jump,
        yaw: this.yaw,
        pitch: this.pitch,
        activeSlot: this.activeSlot,
      },
      force,
    );
  }

  private triggerPrimaryAction(): void {
    const localRig = this.localPlayerId ? this.playerRigs.get(this.localPlayerId) : null;
    const camPos = this.camera.position;
    const origin: Vec3 = localRig
      ? {
          x: localRig.currentPos.x,
          y: localRig.currentPos.y + 1.48,
          z: localRig.currentPos.z,
        }
      : { x: camPos.x, y: camPos.y, z: camPos.z };

    const cosP = Math.cos(this.pitch);
    const lookDir: Vec3 = {
      x: Math.sin(this.yaw) * cosP,
      y: -Math.sin(this.pitch),
      z: Math.cos(this.yaw) * cosP,
    };

    let dir: Vec3 = { ...lookDir };
    if (this.currentZoom >= 0.25) {
      // Converge 3rd-person camera ray only if impact lies ahead of the player's shoulder
      const camForward = this.camera.getForwardRay(100).direction;
      const worldHit = raycastVoxels(
        this.grid,
        camPos.x,
        camPos.y,
        camPos.z,
        camForward.x,
        camForward.y,
        camForward.z,
        90,
      );
      const camToOriginDist = Math.hypot(
        origin.x - camPos.x,
        origin.y - camPos.y,
        origin.z - camPos.z,
      );
      const aimPoint: Vec3 =
        worldHit.hit && worldHit.distance > camToOriginDist + 0.35
          ? worldHit.point
          : {
              x: origin.x + lookDir.x * 90,
              y: origin.y + lookDir.y * 90,
              z: origin.z + lookDir.z * 90,
            };
      const dx = aimPoint.x - origin.x;
      const dy = aimPoint.y - origin.y;
      const dz = aimPoint.z - origin.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      dir = { x: dx / len, y: dy / len, z: dz / len };
    }

    const now = Date.now();
    const localPlayer = this.latestTick?.players.find((p) => p.id === this.localPlayerId);
    const activeItem = localPlayer?.slots[this.activeSlot];

    if (activeItem?.kind === 'grapple' && now - this.lastLocalActionFxAt >= 650) {
      this.lastLocalActionFxAt = now;
      this.recoilKick = 0.7;
      soundSynth.playGrapple();
    } else if (activeItem?.kind === 'shovel' && now - this.lastLocalActionFxAt >= 280) {
      this.lastLocalActionFxAt = now;
      this.recoilKick = 0.9;
      soundSynth.playDig();
    } else if (activeItem?.kind === 'weapon' && activeItem.weapon && localPlayer) {
      if (now < localPlayer.overheatedUntil) {
        if (now - this.lastLocalActionFxAt >= 500) {
          this.lastLocalActionFxAt = now;
          soundSynth.playOverheat();
        }
        return;
      }
      const minMs = 1000 / Math.max(0.5, activeItem.weapon.stats.fireRate);
      if (now - this.lastLocalActionFxAt >= minMs) {
        this.lastLocalActionFxAt = now;
        this.recoilKick = 1.0;
        this.muzzleFlashTimer = 0.06;
        this.muzzleFlashMesh.setEnabled(true);
        soundSynth.playShoot(
          activeItem.massKg,
          activeItem.weapon.assets?.find((id) => id.startsWith('sfx:weapon:')),
          this.getAssetUrl(
            activeItem.weapon.assets?.find((id) => id.startsWith('sfx:weapon:')),
          ),
        );
      }
    }

    this.callbacks.onPrimaryAction(origin, dir);
  }

  private bindInputListeners(): void {
    const onKeyDown = (e: KeyboardEvent) => {
      if (this.mode !== 'playing') return;
      if (this.promptOpen) return;
      const activeTag = document.activeElement?.tagName;
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT') return;

      this.keysPressed.add(e.code);

      if (e.code === 'Digit1') this.selectSlot(0);
      else if (e.code === 'Digit2') this.selectSlot(1);
      else if (e.code === 'Digit3') this.selectSlot(2);
      else if (e.code === 'Digit4') this.selectSlot(3);
      else if (e.code === 'KeyG' || e.code === 'KeyQ') this.callbacks.onDropItem();
      else if (e.code === 'KeyE') this.callbacks.onPickupItem();
      else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        this.callbacks.onOpenPrompt();
      } else if (e.code === 'KeyT') {
        e.preventDefault();
        this.callbacks.onOpenWeaponPrompt();
      } else if (e.code === 'KeyY') {
        e.preventDefault();
        this.callbacks.onOpenEventPrompt();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      this.keysPressed.delete(e.code);
    };

    const resetMouseTracking = () => {
      this.lastMouseClientX = null;
      this.lastMouseClientY = null;
      this.cursorEdgeTurn = 0;
      this.cursorOverCanvas = false;
    };

    const onBlur = () => {
      this.keysPressed.clear();
      this.mouseDown = false;
      this.rightMouseDown = false;
      resetMouseTracking();
    };

    const onPointerLockChange = () => {
      resetMouseTracking();
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!e.isPrimary) return;
      if (this.mode !== 'playing' || this.promptOpen) {
        resetMouseTracking();
        return;
      }

      if (document.pointerLockElement === this.canvas) {
        const next = applyPointerLookDelta(
          this.yaw,
          this.pitch,
          e.movementX,
          e.movementY,
          0.0026,
        );
        this.yaw = next.yaw;
        this.pitch = next.pitch;
        this.cursorEdgeTurn = 0;
        return;
      }

      const overCanvas = e.target === this.canvas;
      if (!overCanvas && !this.mouseDown && !this.rightMouseDown) {
        resetMouseTracking();
        return;
      }

      if (this.lastMouseClientX !== null && this.lastMouseClientY !== null) {
        let dx = e.clientX - this.lastMouseClientX;
        let dy = e.clientY - this.lastMouseClientY;
        if (dx === 0 && dy === 0 && (e.movementX !== 0 || e.movementY !== 0)) {
          dx = e.movementX;
          dy = e.movementY;
        }
        const next = applyPointerLookDelta(this.yaw, this.pitch, dx, dy, 0.0034);
        this.yaw = next.yaw;
        this.pitch = next.pitch;
      }

      this.lastMouseClientX = e.clientX;
      this.lastMouseClientY = e.clientY;
      this.cursorOverCanvas = overCanvas;

      if (overCanvas) {
        const rect = this.canvas.getBoundingClientRect();
        this.cursorEdgeTurn = computeUnlockedEdgeTurn(e.clientX, rect.left, rect.width, 0.08);
      } else {
        this.cursorEdgeTurn = 0;
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      if (!e.isPrimary) return;
      if (this.mode !== 'playing' || this.promptOpen) return;
      if (e.target !== this.canvas) return;
      this.lastMouseClientX = e.clientX;
      this.lastMouseClientY = e.clientY;
      this.cursorOverCanvas = true;
      if (e.button === 2) {
        this.rightMouseDown = true;
        return;
      }
      if (e.button === 0) {
        this.mouseDown = true;
        this.requestPointerLock();
        this.triggerPrimaryAction();
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!e.isPrimary) return;
      if (e.button === 2) {
        this.rightMouseDown = false;
      } else if (e.button === 0) {
        this.mouseDown = false;
      }
    };

    const onPointerCancel = () => {
      this.mouseDown = false;
      this.rightMouseDown = false;
      resetMouseTracking();
    };

    const onContextMenu = (e: MouseEvent) => {
      if (this.mode === 'playing' && !this.promptOpen) {
        e.preventDefault();
      }
    };

    const onWheel = (e: WheelEvent) => {
      if (this.mode !== 'playing' || this.promptOpen) return;
      e.preventDefault();
      this.targetZoom = Math.max(0, Math.min(7.0, this.targetZoom + Math.sign(e.deltaY) * 0.75));
      this.callbacks.onZoomChange(this.targetZoom);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onBlur);
    document.addEventListener('pointerlockchange', onPointerLockChange);
    window.addEventListener('pointermove', onPointerMove);
    this.canvas.addEventListener('pointerleave', resetMouseTracking);
    this.canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    this.canvas.addEventListener('contextmenu', onContextMenu);
    this.canvas.addEventListener('wheel', onWheel, { passive: false });

    const onResize = () => this.engine.resize();
    window.addEventListener('resize', onResize);

    // Store cleanup on scene dispose
    this.scene.onDisposeObservable.add(() => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onBlur);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      window.removeEventListener('pointermove', onPointerMove);
      this.canvas.removeEventListener('pointerleave', resetMouseTracking);
      this.canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      this.canvas.removeEventListener('contextmenu', onContextMenu);
      this.canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', onResize);
    });
  }

  public selectSlot(idx: number): void {
    this.activeSlot = Math.max(0, Math.min(3, idx));
    this.sendInputFrame(true);
  }

  public dispose(): void {
    this.disposed = true;
    this.mesherWorker.terminate();
    for (const r of this.playerRigs.values()) {
      r.grappleLine?.dispose();
      r.rig.dispose();
    }
    this.playerRigs.clear();
    this.scene.dispose();
    this.engine.dispose();
  }
}
