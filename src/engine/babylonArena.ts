import {
  Color3,
  Color4,
  DefaultRenderingPipeline,
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
  Texture,
  TransformNode,
  UniversalCamera,
  Vector3,
  VertexData,
} from '@babylonjs/core';
import {
  CHUNK_SIZE,
  MAT,
  MATERIAL_COLORS,
  VOXEL_SIZE,
  WATER_LEVEL_VOXEL,
  WATER_LEVEL_WORLD,
  type InventorySlotItem,
  type IslandMeta,
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
  getGroundVoxelY,
  raycastVoxels,
  VoxelGrid,
} from '../shared/voxelWorld.ts';
import type { AssetEntry, AssetManifest } from '../shared/assets.ts';
import { resolveAssetUrl } from '../shared/assets.ts';
import { soundSynth } from './soundSynth.ts';
import { ChunkDetailPlugin } from './chunkDetailPlugin.ts';
import { audioDirector } from './audio/audioDirector.ts';
import { materialColor } from './audio/materialAudio.ts';
import {
  detectGpuTier,
  loadQualityLevel,
  resolveQuality,
  type GpuTier,
  type QualityLevel,
  type QualityProfile,
} from './quality.ts';
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

export interface PerfStats {
  fps: number;
  frameMs: number;
  chunks: number;
  activeMeshes: number;
  vertices: number;
}

export interface ArenaCallbacks {
  onSendInput: (
    input: {
      moveX: number;
      moveZ: number;
      jump: boolean;
      sprint?: boolean;
      crouch?: boolean;
      yaw: number;
      pitch: number;
      activeSlot: number;
    },
    force?: boolean,
  ) => void;
  onPrimaryAction: (origin: Vec3, dir: Vec3) => void;
  onDropItem: () => void;
  onPickupItem: () => void;
  onUseZipline?: (routeId: string) => void;
  onZiplineNearby?: (name: string | null) => void;
  onOpenPrompt: () => void;
  onOpenWeaponPrompt: () => void;
  onOpenEventPrompt: () => void;
  onZoomChange: (zoomMeters: number) => void;
  onAimContextChange?: (ctx: 'neutral' | 'dig' | 'grapple' | 'enemy') => void;
  onContextLost?: (lost: boolean) => void;
  onPointerLockChange?: (locked: boolean) => void;
}

export class BabylonVoxelArena {
  private canvas: HTMLCanvasElement;
  private engine: Engine;
  private scene: Scene;
  private camera: UniversalCamera;
  private callbacks: ArenaCallbacks;
  private isSoftwareGl = false;
  private gpuTier: GpuTier = 'unknown';
  private quality: QualityProfile;

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
  private waterNormalTexture: DynamicTexture | null = null;
  private shoreFoamMesh: Mesh | null = null;
  private shoreFoamMat: StandardMaterial | null = null;
  private shoreFoamTexture: DynamicTexture | null = null;
  private bloomPipeline: DefaultRenderingPipeline | null = null;

  // VFX: ondas de choque e decals em pool
  private shockwaves: Array<{
    mesh: Mesh;
    mat: StandardMaterial;
    ttl: number;
    maxTtl: number;
    radius: number;
  }> = [];
  private shockwaveCursor = 0;
  private decals: Array<{
    mesh: Mesh;
    mat: StandardMaterial;
    ttl: number;
    maxTtl: number;
  }> = [];
  private decalCursor = 0;
  private scorchTexture: DynamicTexture | null = null;

  private islandMeta: IslandMeta = { ziplines: [] };
  private ziplineGroup: TransformNode | null = null;
  private nearbyZiplineId: string | null = null;
  private eyeHeight = 1.48;

  // Áudio: rastro de projéteis, passos e ambiência
  private projectileMeta = new Map<
    string,
    {
      position: Vec3;
      velocity: Vec3;
      ownerId: string;
      craterRadius: number;
      color: string;
    }
  >();
  private remoteAudio = new Map<
    string,
    { x: number; z: number; stride: number; airborne: boolean }
  >();
  private localAudio = {
    x: 0,
    y: 0,
    z: 0,
    stride: 0,
    airborne: false,
    sliding: false,
    zipline: false,
    initialized: false,
  };
  private ambienceTimer = 0;
  private ambienceState = {
    underwater: false,
    underground: false,
    nearWater: false,
    nearLava: false,
    nearSwamp: false,
    storm: false,
  };

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
  private weatherFxTimer = 0;
  private blastFlashes: Array<{
    mesh: Mesh;
    mat: StandardMaterial;
    ttl: number;
    maxTtl: number;
  }> = [];
  private blastCursor = 0;
  private targetWaterY = WATER_LEVEL_WORLD;
  private currentWaterY = WATER_LEVEL_WORLD;
  private targetFogColor = new Color3(0.66, 0.84, 0.96);
  private targetClearColor = new Color4(0.42, 0.72, 0.94, 1);
  private targetFogDensity = 0.0022;
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
  private lookSensitivity = 1;
  private invertY = false;
  private reducedMotion = false;
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

    const storedQuality = loadQualityLevel();
    const bootstrapQuality = resolveQuality(storedQuality);

    this.engine = new Engine(canvas, bootstrapQuality.antialias, {
      preserveDrawingBuffer: false,
      stencil: false,
      antialias: bootstrapQuality.antialias,
      powerPreference: 'high-performance',
    });

    const gl = (this.engine as unknown as { _gl?: WebGLRenderingContext })._gl;
    if (gl) {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      const rendererName = dbg
        ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) ?? '')
        : String(gl.getParameter(gl.RENDERER) ?? '');
      this.gpuTier = detectGpuTier(rendererName);
      this.isSoftwareGl = this.gpuTier === 'software';
    }

    this.quality = resolveQuality(storedQuality, {
      isSoftwareGl: this.isSoftwareGl,
      gpuTier: this.gpuTier,
    });
    this.engine.setHardwareScalingLevel(this.quality.hardwareScaling);

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
    this.ensureBloomPipeline();

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
      // Cria no tamanho do perfil de boot (mínimo 1024); trocar de preset em
      // runtime não redimensiona o mapa de sombras, apenas liga/desliga.
      const shadowSize = Math.max(1024, this.quality.shadowMapSize);
      this.shadowGenerator = new ShadowGenerator(shadowSize, sun);
      this.shadowGenerator.usePercentageCloserFiltering = true;
      this.shadowGenerator.bias = 0.0008;
    }
    this.scene.shadowsEnabled = Boolean(this.shadowGenerator) && this.quality.shadows;

    // Chunk shared material (vertex colored + AO baked)
    this.chunkMat = new StandardMaterial('voxelChunkMat', this.scene);
    this.chunkMat.specularColor = new Color3(0.08, 0.09, 0.12);
    this.chunkMat.ambientColor = new Color3(0.22, 0.24, 0.3);
    if (!this.isSoftwareGl) {
      // Detalhe procedural + brilho por MAT sem materiais extras.
      new ChunkDetailPlugin(this.chunkMat);
    }

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
    this.waterMat.diffuseColor = Color3.FromHexString('#0a4f73');
    this.waterMat.emissiveColor = Color3.FromHexString('#032238');
    this.waterMat.specularColor = new Color3(0.45, 0.62, 0.78);
    this.waterMat.specularPower = 64;
    this.waterMat.alpha = 0.8;
    this.waterMat.backFaceCulling = false;
    this.waterNormalTexture = this.createWaterNormalTexture();
    this.waterMat.bumpTexture = this.waterNormalTexture;
    this.waterMat.bumpTexture.level = 0.32;
    this.waterMesh.material = this.waterMat;
    this.waterMesh.alphaIndex = 0;

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

    // Ondas de choque de explosão (pool de 3 anéis)
    for (let i = 0; i < 3; i++) {
      const ring = MeshBuilder.CreateTorus(
        `shock_${i}`,
        { diameter: 1, thickness: 0.07, tessellation: 20 },
        this.scene,
      );
      ring.isPickable = false;
      ring.setEnabled(false);
      const rMat = new StandardMaterial(`shockMat_${i}`, this.scene);
      rMat.disableLighting = true;
      rMat.emissiveColor = Color3.FromHexString('#fde68a');
      rMat.alpha = 0;
      rMat.backFaceCulling = false;
      ring.material = rMat;
      this.shockwaves.push({
        mesh: ring,
        mat: rMat,
        ttl: 0,
        maxTtl: 1,
        radius: 1,
      });
    }

    // Textura e pool de decals de impacto (10 quads no chão)
    const scorch = new DynamicTexture(
      'scorchTex',
      { width: 64, height: 64 },
      this.scene,
      false,
    );
    const sctx = scorch.getContext();
    const simg = sctx.getImageData(0, 0, 64, 64);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const dx = (x - 31.5) / 31.5;
        const dy = (y - 31.5) / 31.5;
        const r = Math.sqrt(dx * dx + dy * dy);
        const noise =
          ((((x * 73856093) ^ (y * 19349663)) >>> 0) % 1000) / 1000;
        const alpha = Math.pow(Math.max(0, 1 - r), 1.6) * (0.7 + noise * 0.3);
        const i = (y * 64 + x) * 4;
        simg.data[i] = 255;
        simg.data[i + 1] = 255;
        simg.data[i + 2] = 255;
        simg.data[i + 3] = Math.round(alpha * 255);
      }
    }
    sctx.putImageData(simg, 0, 0);
    scorch.hasAlpha = true;
    scorch.update(false);
    this.scorchTexture = scorch;

    for (let i = 0; i < 10; i++) {
      const decal = MeshBuilder.CreateGround(
        `decal_${i}`,
        { width: 1, height: 1, subdivisions: 1 },
        this.scene,
      );
      decal.isPickable = false;
      decal.receiveShadows = false;
      decal.setEnabled(false);
      const dMat = new StandardMaterial(`decalMat_${i}`, this.scene);
      dMat.disableLighting = true;
      dMat.diffuseColor = Color3.Black();
      dMat.emissiveColor = new Color3(0.85, 0.5, 0.25);
      dMat.opacityTexture = scorch;
      dMat.alpha = 0;
      dMat.backFaceCulling = false;
      dMat.disableDepthWrite = true;
      decal.material = dMat;
      this.decals.push({ mesh: decal, mat: dMat, ttl: 0, maxTtl: 9 });
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
    this.grid = createProceduralIsland(1337, 384, 80, 384, this.islandMeta);
    audioDirector.setOccluder((from, to) => this.isOccluded(from, to));
    const previewCx = (this.grid.dimX * VOXEL_SIZE) / 2;
    const previewCz = (this.grid.dimZ * VOXEL_SIZE) / 2;
    this.waterMesh.position.set(previewCx, WATER_LEVEL_WORLD - 0.12, previewCz);
    this.abyssFloorMesh.position.set(previewCx, 0.25, previewCz);
    this.camera.position.set(previewCx + 52, 26, previewCz + 52);
    this.rebuildAllChunks();
    this.rebuildShoreFoam();
    this.rebuildZiplines();

    this.bindInputListeners();
    this.attachContextListeners();

    // Hook de depuração apenas em DEV (removido do bundle de produção).
    if (import.meta.env.DEV) {
      (
        window as unknown as { __pwArena?: BabylonVoxelArena }
      ).__pwArena = this;
    }

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

  private ensureBloomPipeline(): void {
    if (this.bloomPipeline || this.isSoftwareGl || !this.quality.bloom) return;
    const pipeline = new DefaultRenderingPipeline(
      'pwPost',
      Boolean(this.engine.getCaps().textureHalfFloatRender),
      this.scene,
      [this.camera],
    );
    pipeline.bloomEnabled = true;
    pipeline.bloomThreshold = 1.0;
    pipeline.bloomWeight = 0.3;
    pipeline.bloomKernel = 32;
    pipeline.bloomScale = 0.5;
    pipeline.fxaaEnabled = true;
    this.bloomPipeline = pipeline;
  }

  private createWaterNormalTexture(): DynamicTexture {
    const size = 128;
    const texture = new DynamicTexture(
      'waterNormalTex',
      { width: size, height: size },
      this.scene,
      true,
    );
    const ctx = texture.getContext();
    const image = ctx.getImageData(0, 0, size, size);
    for (let y = 0; y < size; y++) {
      const fz = (y / size) * Math.PI * 2;
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * Math.PI * 2;
        const dx =
          Math.sin(fx * 2 + Math.sin(fz * 2) * 0.8) * 0.45 +
          Math.sin((fx + fz) * 3) * 0.25;
        const dy =
          Math.cos(fz * 2 + Math.sin(fx * 3) * 0.8) * 0.45 +
          Math.cos((fx - fz) * 2) * 0.25;
        const i = (y * size + x) * 4;
        image.data[i] = 128 + dx * 108;
        image.data[i + 1] = 128 + dy * 108;
        image.data[i + 2] = 255;
        image.data[i + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    texture.update(false);
    texture.wrapU = Texture.WRAP_ADDRESSMODE;
    texture.wrapV = Texture.WRAP_ADDRESSMODE;
    texture.uScale = 48;
    texture.vScale = 48;
    return texture;
  }

  /**
   * Máscara de espuma gerada da heightmap: só desenha onde o topo do terreno
   * está próximo da linha d'água. Determinística e sem depth texture.
   */
  private rebuildShoreFoam(): void {
    this.shoreFoamMesh?.dispose();
    this.shoreFoamMesh = null;
    this.shoreFoamMat?.dispose(true, true);
    this.shoreFoamMat = null;
    this.shoreFoamTexture?.dispose();
    this.shoreFoamTexture = null;

    const size = 384;
    const texture = new DynamicTexture(
      'shoreFoamTex',
      { width: size, height: size },
      this.scene,
      false,
      Texture.BILINEAR_SAMPLINGMODE,
      undefined,
      false,
    );
    const ctx = texture.getContext();
    const image = ctx.getImageData(0, 0, size, size);
    const dimX = this.grid.dimX;
    const dimZ = this.grid.dimZ;

    for (let py = 0; py < size; py++) {
      const vz = Math.min(dimZ - 1, Math.floor(((py + 0.5) / size) * dimZ));
      for (let px = 0; px < size; px++) {
        const vx = Math.min(dimX - 1, Math.floor(((px + 0.5) / size) * dimX));
        const top = getGroundVoxelY(this.grid, vx, vz);
        const dist = Math.abs(top - WATER_LEVEL_VOXEL);
        let alpha = 0;
        if (dist <= 2.2) {
          const hash =
            (((vx * 73856093) ^ (vz * 19349663)) >>> 0) % 1000 / 1000;
          alpha = dist <= 1.0 ? 0.95 : 0.45 + hash * 0.35;
        }
        const i = (py * size + px) * 4;
        image.data[i] = 232;
        image.data[i + 1] = 247;
        image.data[i + 2] = 255;
        image.data[i + 3] = Math.round(alpha * 255);
      }
    }
    ctx.putImageData(image, 0, 0);
    texture.hasAlpha = true;
    texture.update(false);
    texture.wrapU = Texture.CLAMP_ADDRESSMODE;
    texture.wrapV = Texture.CLAMP_ADDRESSMODE;
    texture.uScale = 1;
    texture.vScale = 1;

    const width = dimX * VOXEL_SIZE;
    const height = dimZ * VOXEL_SIZE;
    const mesh = MeshBuilder.CreateGround(
      'shoreFoam',
      { width, height, subdivisions: 1 },
      this.scene,
    );
    mesh.position.set(width / 2, this.currentWaterY + 0.02, height / 2);
    mesh.isPickable = false;
    mesh.receiveShadows = false;
    mesh.alphaIndex = 1;

    const material = new StandardMaterial('shoreFoamMat', this.scene);
    material.disableLighting = true;
    material.diffuseColor = Color3.Black();
    material.emissiveColor = new Color3(0.82, 0.94, 1);
    material.specularColor = Color3.Black();
    material.opacityTexture = texture;
    material.alpha = 0.7;
    material.disableDepthWrite = true;
    material.backFaceCulling = false;
    mesh.material = material;

    this.shoreFoamTexture = texture;
    this.shoreFoamMat = material;
    this.shoreFoamMesh = mesh;
  }

  private rebuildZiplines(): void {
    this.ziplineGroup?.dispose(false, true);
    const group = new TransformNode('ziplines', this.scene);
    for (const route of this.islandMeta.ziplines) {
      const points: Vector3[] = [];
      const segments = 24;
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const sag = Math.sin(Math.PI * t) * 1.1;
        points.push(
          new Vector3(
            route.from.x + (route.to.x - route.from.x) * t,
            route.from.y + (route.to.y - route.from.y) * t - sag,
            route.from.z + (route.to.z - route.from.z) * t,
          ),
        );
      }
      const line = MeshBuilder.CreateLines(
        `zipline_${route.id}`,
        { points },
        this.scene,
      );
      line.color = new Color3(0.82, 0.9, 1);
      line.isPickable = false;
      line.parent = group;

      for (const [index, anchor] of [route.from, route.to].entries()) {
        const ring = MeshBuilder.CreateTorus(
          `ziplineAnchor_${route.id}_${index}`,
          { diameter: 1.0, thickness: 0.09, tessellation: 18 },
          this.scene,
        );
        ring.position.set(anchor.x, anchor.y, anchor.z);
        ring.isPickable = false;
        ring.parent = group;
        const mat = new StandardMaterial(
          `ziplineAnchorMat_${route.id}_${index}`,
          this.scene,
        );
        mat.disableLighting = true;
        mat.emissiveColor = Color3.FromHexString('#fbbf24');
        mat.alpha = 0.9;
        ring.material = mat;
      }
    }
    this.ziplineGroup = group;
  }

  private applyUnderwaterAtmosphere(): void {
    this.targetFogColor.set(0.04, 0.28, 0.45);
    this.targetClearColor.set(0.03, 0.2, 0.34, 1);
    this.targetFogDensity = 0.075;
  }

  private isOccluded(
    from: { x: number; y: number; z: number },
    to: { x: number; y: number; z: number },
  ): boolean {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 1.2) return false;
    const hit = raycastVoxels(
      this.grid,
      from.x,
      from.y,
      from.z,
      dx / dist,
      dy / dist,
      dz / dist,
      Math.max(0.2, dist - 0.6),
    );
    return hit.hit;
  }

  private spawnMaterialBurst(
    center: Vec3,
    color: [number, number, number],
    count: number,
    scale: number,
    speed: number,
  ): void {
    const n = Math.max(0, Math.min(24, Math.round(count)));
    for (let i = 0; i < n; i++) {
      const p = this.shrapnelPool[this.shrapnelCursor];
      this.shrapnelCursor = (this.shrapnelCursor + 1) % this.SHRAPNEL_CAP;
      const angle = Math.random() * Math.PI * 2;
      const radial = Math.random();
      p.active = true;
      p.px = center.x + (Math.random() - 0.5) * 0.24;
      p.py = center.y + Math.random() * 0.18;
      p.pz = center.z + (Math.random() - 0.5) * 0.24;
      p.vx = Math.cos(angle) * speed * radial;
      p.vy = speed * (0.25 + Math.random() * 0.75);
      p.vz = Math.sin(angle) * speed * radial;
      p.rx = Math.random() * 6;
      p.ry = Math.random() * 6;
      p.scale = scale * (0.75 + Math.random() * 0.5);
      p.ttl = 0.35 + Math.random() * 0.45;
      p.color = [color[0], color[1], color[2]];
    }
  }

  private spawnFootstepDust(
    mat: number,
    position: Vec3,
    underwater: boolean,
    count = 2,
  ): void {
    const color: [number, number, number] = underwater
      ? [0.55, 0.85, 1]
      : materialColor(mat);
    this.spawnMaterialBurst(
      { x: position.x, y: position.y + 0.04, z: position.z },
      color,
      count,
      0.24,
      0.9,
    );
  }

  private spawnShockwave(center: Vec3, radius: number): void {
    if (this.shockwaves.length === 0) return;
    const s = this.shockwaves[this.shockwaveCursor];
    this.shockwaveCursor = (this.shockwaveCursor + 1) % this.shockwaves.length;
    s.mesh.position.set(center.x, center.y + 0.05, center.z);
    s.mesh.scaling.set(0.35, 1, 0.35);
    s.mesh.setEnabled(true);
    s.ttl = 0.45;
    s.maxTtl = 0.45;
    s.radius = Math.max(0.6, radius);
    s.mat.emissiveColor = Color3.FromHexString('#fde68a');
    s.mat.alpha = 0.6;
  }

  private spawnDecal(
    position: Vec3,
    color: [number, number, number],
    size: number,
  ): void {
    if (this.decals.length === 0) return;
    const d = this.decals[this.decalCursor];
    this.decalCursor = (this.decalCursor + 1) % this.decals.length;
    d.mesh.position.set(position.x, position.y + 0.02, position.z);
    d.mesh.rotation.y = Math.random() * Math.PI * 2;
    d.mesh.scaling.set(Math.max(0.25, size), 1, Math.max(0.25, size));
    d.mat.emissiveColor.set(
      Math.min(1, color[0] * 0.9),
      Math.min(1, color[1] * 0.9),
      Math.min(1, color[2] * 0.9),
    );
    d.mat.alpha = 0.62;
    d.mesh.setEnabled(true);
    d.ttl = 9;
    d.maxTtl = 9;
  }

  private spawnExplosionVfx(center: Vec3, radius: number): void {
    this.spawnShockwave(center, radius * 1.9);
    this.spawnMaterialBurst(
      { x: center.x, y: center.y + 0.35, z: center.z },
      [0.5, 0.5, 0.56],
      10,
      1.05,
      4.2,
    );
    this.spawnDecal(
      { x: center.x, y: Math.max(0, center.y - 0.2), z: center.z },
      [1, 0.42, 0.12],
      radius * 2.4,
    );
  }

  private spawnImpactVfx(
    material: number,
    point: Vec3,
    ny: number,
    local: boolean,
  ): void {
    if (material <= 0) return;
    const color = materialColor(material);
    audioDirector.playImpact(material, point, { local });
    this.spawnMaterialBurst(point, color, 4, 0.45, 2.6);
    if (ny > 0.55) {
      this.spawnDecal(
        point,
        [color[0] * 0.4, color[1] * 0.4, color[2] * 0.4],
        0.55 + Math.random() * 0.35,
      );
    }
  }

  private updateLocalMovementAudio(players: PlayerNetState[]): void {
    if (this.mode !== 'playing') return;
    const local = players.find((p) => p.id === this.localPlayerId);
    if (!local || !local.alive) {
      this.localAudio.initialized = false;
      return;
    }
    const pos = local.position;
    if (!this.localAudio.initialized) {
      this.localAudio.x = pos.x;
      this.localAudio.y = pos.y;
      this.localAudio.z = pos.z;
      this.localAudio.initialized = true;
      return;
    }

    const vx = Math.max(0, Math.floor(pos.x / VOXEL_SIZE));
    const vz = Math.max(0, Math.floor(pos.z / VOXEL_SIZE));
    const top = getGroundVoxelY(this.grid, vx, vz);
    const groundY = (top + 1) * VOXEL_SIZE;
    const underwater = pos.y + 1.0 < this.currentWaterY;
    const grounded = pos.y <= groundY + 0.12 || underwater;
    const dy = (pos.y - this.localAudio.y) / 0.05;
    const moved = Math.hypot(pos.x - this.localAudio.x, pos.z - this.localAudio.z);
    const mat = this.grid.get(vx, Math.max(0, top), vz);

    if (local.sliding && !this.localAudio.sliding) {
      audioDirector.playWorld('sfx:traversal:whoosh:1', pos, {
        volume: 0.55,
        priority: 2,
        hrtf: false,
        occlusion: false,
        maxDistance: 30,
      });
    }
    if (local.ziplineRouteId && !this.localAudio.zipline) {
      audioDirector.playWorld('sfx:traversal:whoosh:2', pos, {
        volume: 0.6,
        priority: 2,
        hrtf: false,
        occlusion: false,
        maxDistance: 30,
      });
    }
    this.localAudio.sliding = local.sliding;
    this.localAudio.zipline = Boolean(local.ziplineRouteId);

    if (local.climbing) {
      const climbDy = Math.abs(pos.y - this.localAudio.y);
      if (climbDy > 0.01) {
        this.localAudio.stride += climbDy;
        if (this.localAudio.stride >= 0.7) {
          this.localAudio.stride = 0;
          audioDirector.playImpact(MAT.WOOD, pos, { local: true });
        }
      }
    } else if (grounded && !this.localAudio.airborne && moved > 0.01) {
      this.localAudio.stride += moved;
      if (this.localAudio.stride >= 2.1) {
        this.localAudio.stride = 0;
        audioDirector.playFootstep(mat, pos, { local: true, underwater });
        this.spawnFootstepDust(mat, pos, underwater);
      }
    }
    if (grounded && this.localAudio.airborne && dy < -2.4) {
      audioDirector.playLanding(mat, pos, true);
      this.spawnFootstepDust(mat, pos, underwater, 4);
    }

    this.localAudio.airborne = !grounded;
    this.localAudio.x = pos.x;
    this.localAudio.y = pos.y;
    this.localAudio.z = pos.z;
  }

  private updateRemoteMovementAudio(players: PlayerNetState[]): void {
    const seen = new Set<string>();
    for (const p of players) {
      if (p.id === this.localPlayerId) continue;
      seen.add(p.id);
      if (!p.alive) {
        this.remoteAudio.delete(p.id);
        continue;
      }
      const distanceToCamera = Math.hypot(
        p.position.x - this.camera.position.x,
        p.position.z - this.camera.position.z,
      );
      const entry = this.remoteAudio.get(p.id);
      if (!entry) {
        this.remoteAudio.set(p.id, {
          x: p.position.x,
          z: p.position.z,
          stride: 0,
          airborne: false,
        });
        continue;
      }

      const moved = Math.hypot(p.position.x - entry.x, p.position.z - entry.z);
      if (distanceToCamera < 42 && moved > 0.01 && moved < 2.5) {
        const vx = Math.max(0, Math.floor(p.position.x / VOXEL_SIZE));
        const vz = Math.max(0, Math.floor(p.position.z / VOXEL_SIZE));
        const top = getGroundVoxelY(this.grid, vx, vz);
        const grounded = p.position.y <= (top + 1) * VOXEL_SIZE + 0.15;
        if (grounded) {
          entry.stride += moved;
          if (entry.stride >= 2.2) {
            entry.stride = 0;
            const mat = this.grid.get(vx, Math.max(0, top), vz);
            const underwater = p.position.y + 1.0 < this.currentWaterY;
            audioDirector.playFootstep(mat, p.position, {
              local: false,
              underwater,
            });
          }
        }
      }
      entry.x = p.position.x;
      entry.z = p.position.z;
    }
    for (const id of this.remoteAudio.keys()) {
      if (!seen.has(id)) this.remoteAudio.delete(id);
    }
  }

  private refreshAmbienceState(): void {
    const pos = this.camera.position;
    const vx = Math.max(0, Math.floor(pos.x / VOXEL_SIZE));
    const vy = Math.max(0, Math.floor(pos.y / VOXEL_SIZE));
    const vz = Math.max(0, Math.floor(pos.z / VOXEL_SIZE));
    const underwater = pos.y < this.currentWaterY - 0.03;

    let underground = false;
    for (let dy = 2; dy <= 10; dy += 2) {
      if (this.grid.isSolid(vx, vy + dy, vz)) {
        underground = true;
        break;
      }
    }

    let nearWater = false;
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const sx = Math.max(
        0,
        Math.floor((pos.x + Math.cos(angle) * 7) / VOXEL_SIZE),
      );
      const sz = Math.max(
        0,
        Math.floor((pos.z + Math.sin(angle) * 7) / VOXEL_SIZE),
      );
      const top = getGroundVoxelY(this.grid, sx, sz);
      if (top > 0 && Math.abs(top - WATER_LEVEL_VOXEL) <= 1) {
        nearWater = true;
        break;
      }
    }

    let nearLava = false;
    outer: for (let dx = -6; dx <= 6; dx += 4) {
      for (let dz = -6; dz <= 6; dz += 4) {
        for (let dy = -2; dy <= 5; dy += 3) {
          if (this.grid.get(vx + dx, vy + dy, vz + dz) === MAT.LAVA) {
            nearLava = true;
            break outer;
          }
        }
      }
    }

    let nearSwamp = false;
    outerSwamp: for (let dx = -6; dx <= 6; dx += 4) {
      for (let dz = -6; dz <= 6; dz += 4) {
        for (let dy = -2; dy <= 4; dy += 3) {
          if (this.grid.get(vx + dx, vy + dy, vz + dz) === MAT.MOSS) {
            nearSwamp = true;
            break outerSwamp;
          }
        }
      }
    }

    const storm =
      this.activeWeatherKind === 'blizzard' ||
      this.activeWeatherKind === 'acid_rain';

    this.ambienceState = {
      underwater,
      underground,
      nearWater,
      nearLava,
      nearSwamp,
      storm,
    };
  }

  private handleProjectileEnded(
    meta: {
      position: Vec3;
      velocity: Vec3;
      ownerId: string;
      craterRadius: number;
      color: string;
    },
  ): void {
    if (meta.craterRadius > 0) return; // explosão já é tratada pelo fx:shrapnel
    const vx = meta.velocity.x;
    const vy = meta.velocity.y;
    const vz = meta.velocity.z;
    const len = Math.hypot(vx, vy, vz);
    if (len < 0.01) return;
    const hit = raycastVoxels(
      this.grid,
      meta.position.x - (vx / len) * 0.08,
      meta.position.y - (vy / len) * 0.08,
      meta.position.z - (vz / len) * 0.08,
      vx / len,
      vy / len,
      vz / len,
      2.2,
    );
    if (!hit.hit) return;
    const local = meta.ownerId === this.localPlayerId;
    this.spawnImpactVfx(hit.material, hit.point, hit.ny, local);
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
    audioDirector.setManifest(manifest);
  }

  /**
   * Troca o preset em runtime. Escala de render e sombras valem na hora;
   * tamanho do shadow map e antialias só no próximo boot.
   */
  public setQuality(level: QualityLevel): QualityProfile {
    this.quality = resolveQuality(level, {
      isSoftwareGl: this.isSoftwareGl,
      gpuTier: this.gpuTier,
    });
    this.engine.setHardwareScalingLevel(this.quality.hardwareScaling);
    this.scene.shadowsEnabled =
      Boolean(this.shadowGenerator) && this.quality.shadows;
    if (this.quality.bloom) this.ensureBloomPipeline();
    if (this.bloomPipeline) {
      this.bloomPipeline.bloomEnabled = this.quality.bloom;
      this.bloomPipeline.fxaaEnabled = this.quality.bloom;
    }
    return this.quality;
  }

  public getQuality(): QualityProfile {
    return this.quality;
  }

  public getPerfStats(): PerfStats {
    const activeMeshes = this.scene.getActiveMeshes();
    return {
      fps: this.engine.getFps(),
      frameMs: this.engine.getDeltaTime(),
      chunks: this.chunkMeshes.size,
      activeMeshes: activeMeshes.length,
      vertices: this.scene.getTotalVertices(),
    };
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
    this.nearbyZiplineId = null;
    this.callbacks.onZiplineNearby?.(null);
    this.islandMeta = { ziplines: [] };
    this.grid = createProceduralIsland(
      init.seed,
      init.dimX,
      init.dimY,
      init.dimZ,
      this.islandMeta,
    );
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
    this.projectileMeta.clear();
    this.remoteAudio.clear();
    this.localAudio.initialized = false;
    this.localAudio.airborne = false;
    this.localAudio.sliding = false;
    this.localAudio.zipline = false;

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
    this.rebuildShoreFoam();
    this.rebuildZiplines();
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
      const isBlast = voxels.length > 5;
      if (isBlast) {
        soundSynth.playExplosionAt(center);
        const dist = Math.hypot(
          center.x - this.camera.position.x,
          center.y - this.camera.position.y,
          center.z - this.camera.position.z,
        );
        if (dist < 26) {
          this.cameraTrauma = Math.min(
            1,
            this.cameraTrauma + 0.35 * (1 - dist / 26),
          );
        }
        this.spawnExplosionVfx(center, 1.1 + Math.random() * 0.45);
      } else {
        soundSynth.playDigAt(center);
        const dist = Math.hypot(
          center.x - this.camera.position.x,
          center.y - this.camera.position.y,
          center.z - this.camera.position.z,
        );
        if (dist > 7) {
          audioDirector.playDig(voxels[0].mat, center, false);
        }
      }
      const flash = this.blastFlashes[this.blastCursor];
      this.blastCursor = (this.blastCursor + 1) % this.blastFlashes.length;
      const baseScale = isBlast ? 0.65 : 0.32;
      flash.mesh.position.set(center.x, center.y, center.z);
      flash.mesh.scaling.set(baseScale, baseScale, baseScale);
      flash.ttl = isBlast ? 0.24 : 0.14;
      flash.maxTtl = flash.ttl;
      flash.mat.alpha = isBlast ? 0.68 : 0.42;
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
    this.updateLocalMovementAudio(tick.players);
    this.updateRemoteMovementAudio(tick.players);
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

  public releasePointerLock(): void {
    if (document.pointerLockElement === this.canvas) {
      document.exitPointerLock?.();
    }
  }

  public setLookSensitivity(multiplier: number): void {
    this.lookSensitivity = Math.max(0.4, Math.min(2, Number.isFinite(multiplier) ? multiplier : 1));
  }

  public setInvertY(invert: boolean): void {
    this.invertY = Boolean(invert);
  }

  public setReducedMotion(reduced: boolean): void {
    this.reducedMotion = Boolean(reduced);
  }

  public projectToScreen(point: Vec3): {
    x: number;
    y: number;
    visible: boolean;
  } {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    const projected = Vector3.Project(
      new Vector3(point.x, point.y, point.z),
      Matrix.Identity(),
      this.scene.getTransformMatrix(),
      this.camera.viewport.toGlobal(width, height),
    );
    return {
      x: projected.x,
      y: projected.y,
      visible:
        projected.z > 0 &&
        projected.z < 1 &&
        projected.x >= -40 &&
        projected.x <= width + 40 &&
        projected.y >= -40 &&
        projected.y <= height + 40,
    };
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
    matIds: Float32Array;
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
    if (data.matIds && data.matIds.length === data.positions.length / 3) {
      mesh.setVerticesData('matId', data.matIds, false, 1);
    }
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
      this.projectileMeta.set(pr.id, {
        position: { x: pr.position.x, y: pr.position.y, z: pr.position.z },
        velocity: { x: pr.velocity.x, y: pr.velocity.y, z: pr.velocity.z },
        ownerId: pr.ownerId,
        craterRadius: pr.craterRadius,
        color: pr.color,
      });
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
        this.playRemoteShot(pr);
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
        const meta = this.projectileMeta.get(id);
        this.projectileMeta.delete(id);
        if (meta) this.handleProjectileEnded(meta);
      }
    }
  }

  private playRemoteShot(pr: ProjectileNetState): void {
    if (pr.ownerId === this.localPlayerId) return;
    const owner = this.latestTick?.players.find((p) => p.id === pr.ownerId);
    if (!owner) return;
    const item = owner.slots[owner.activeSlot];
    if (!item) return;
    const sfxId = item.weapon?.assets?.find((id) =>
      id.startsWith('sfx:weapon:'),
    );
    soundSynth.playShootAt(
      item.massKg,
      sfxId,
      pr.position,
      this.getAssetUrl(sfxId),
    );
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
        const nearest = this.latestTick?.players
          .filter((p) => p.alive)
          .map((p) => ({
            player: p,
            dist: Math.hypot(
              p.position.x - n.position.x,
              p.position.y + 0.8 - n.position.y,
              p.position.z - n.position.z,
            ),
          }))
          .sort((a, b) => a.dist - b.dist)[0];
        if (
          nearest &&
          nearest.dist < 3 &&
          nearest.player.id !== this.localPlayerId
        ) {
          audioDirector.playPickup({
            x: n.position.x,
            y: n.position.y,
            z: n.position.z,
          });
        }
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
        audioDirector.playEvent({
          x: evt.center[0],
          y: evt.center[1],
          z: evt.center[2],
        });
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
    const underwater = this.camera.position.y < this.currentWaterY - 0.05;
    const activeWeather = events.find(
      (e) => e.warningRemainingSec <= 0 && e.archetype === 'WEATHER_HAZARD',
    );

    if (!activeWeather) {
      this.activeWeatherKind = null;
      this.weatherBaseMesh.setEnabled(false);
      this.targetFogColor.set(0.66, 0.84, 0.96);
      this.targetClearColor.set(0.42, 0.72, 0.94, 1);
      this.targetFogDensity = 0.0022;
    } else {
      const wk = activeWeather.params.weatherKind ?? 'meteor_shower';
      this.activeWeatherKind = wk;
      this.weatherBaseMesh.setEnabled(
        wk === 'acid_rain' || wk === 'blizzard' || wk === 'meteor_shower',
      );
      if (wk === 'blizzard') {
        this.targetFogColor.set(0.84, 0.91, 0.98);
        this.targetClearColor.set(0.8, 0.88, 0.96, 1);
        this.targetFogDensity = 0.022;
      } else if (wk === 'acid_rain') {
        this.targetFogColor.set(0.32, 0.45, 0.25);
        this.targetClearColor.set(0.28, 0.4, 0.22, 1);
        this.targetFogDensity = 0.015;
      } else if (wk === 'meteor_shower' || wk === 'earthquake') {
        this.targetFogColor.set(0.42, 0.25, 0.22);
        this.targetClearColor.set(0.38, 0.22, 0.2, 1);
        this.targetFogDensity = 0.012;
      }
    }

    // Água submersa tem prioridade: névoa densa e escura mesmo com clima ativo.
    if (underwater) this.applyUnderwaterAtmosphere();
  }

  private updateFrame(dt: number): void {
    this.animTime += dt;
    this.drainPendingChunks(36);

    // Transições suaves de atmosfera (clima, bioma e submerso).
    const fogK = 1 - Math.exp(-2.2 * dt);
    this.scene.fogColor.set(
      this.scene.fogColor.r + (this.targetFogColor.r - this.scene.fogColor.r) * fogK,
      this.scene.fogColor.g + (this.targetFogColor.g - this.scene.fogColor.g) * fogK,
      this.scene.fogColor.b + (this.targetFogColor.b - this.scene.fogColor.b) * fogK,
    );
    this.scene.clearColor.set(
      this.scene.clearColor.r +
        (this.targetClearColor.r - this.scene.clearColor.r) * fogK,
      this.scene.clearColor.g +
        (this.targetClearColor.g - this.scene.clearColor.g) * fogK,
      this.scene.clearColor.b +
        (this.targetClearColor.b - this.scene.clearColor.b) * fogK,
      1,
    );
    this.scene.fogDensity +=
      (this.targetFogDensity - this.scene.fogDensity) * fogK;

    const forward = this.camera.getDirection(Vector3.Forward());
    audioDirector.updateListener(this.camera.position, forward);
    this.ambienceTimer -= dt;
    if (this.ambienceTimer <= 0) {
      this.ambienceTimer = 0.5;
      this.refreshAmbienceState();
    }
    audioDirector.updateAmbience(dt, this.ambienceState);

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
    if (this.shoreFoamMesh) {
      this.shoreFoamMesh.position.y = this.currentWaterY + 0.02;
    }
    if (this.waterNormalTexture) {
      this.waterNormalTexture.uOffset =
        (this.waterNormalTexture.uOffset + dt * 0.012) % 1;
      this.waterNormalTexture.vOffset =
        (this.waterNormalTexture.vOffset + dt * 0.008) % 1;
    }

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

    // Ondas de choque
    for (const s of this.shockwaves) {
      if (s.ttl <= 0) continue;
      s.ttl -= dt;
      if (s.ttl <= 0) {
        s.mesh.setEnabled(false);
        continue;
      }
      const p = 1 - s.ttl / s.maxTtl;
      const sc = 0.35 + p * s.radius * 2;
      s.mesh.scaling.set(sc, 1, sc);
      s.mat.alpha = (1 - p) * 0.6;
    }

    // Decals de impacto
    for (const d of this.decals) {
      if (d.ttl <= 0) continue;
      d.ttl -= dt;
      if (d.ttl <= 0) {
        d.mesh.setEnabled(false);
        continue;
      }
      d.mat.alpha = 0.62 * Math.min(1, d.ttl / (d.maxTtl * 0.5));
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

    // Weather polish: respingos, meteoros e poeira de terremoto
    this.weatherFxTimer -= dt;
    if (this.weatherFxTimer <= 0 && this.activeWeatherKind) {
      const cam = this.camera.position;
      const angle = Math.random() * Math.PI * 2;
      const dist = 3 + Math.random() * 16;
      const wx = cam.x + Math.cos(angle) * dist;
      const wz = cam.z + Math.sin(angle) * dist;
      const top = getGroundVoxelY(
        this.grid,
        Math.max(0, Math.floor(wx / VOXEL_SIZE)),
        Math.max(0, Math.floor(wz / VOXEL_SIZE)),
      );
      const gy = (top + 1) * VOXEL_SIZE;
      if (this.activeWeatherKind === 'acid_rain') {
        this.weatherFxTimer = 0.35 + Math.random() * 0.5;
        this.spawnMaterialBurst(
          { x: wx, y: gy + 0.05, z: wz },
          [0.45, 0.9, 0.35],
          2,
          0.2,
          0.7,
        );
      } else if (this.activeWeatherKind === 'meteor_shower') {
        this.weatherFxTimer = 1.8 + Math.random() * 1.4;
        const p = this.shrapnelPool[this.shrapnelCursor];
        this.shrapnelCursor = (this.shrapnelCursor + 1) % this.SHRAPNEL_CAP;
        p.active = true;
        p.px = wx;
        p.py = cam.y + 14 + Math.random() * 8;
        p.pz = wz;
        p.vx = 2 + Math.random() * 2;
        p.vy = -14;
        p.vz = 1;
        p.rx = 0;
        p.ry = 0;
        p.scale = 0.55;
        p.ttl = 1.2;
        p.color = [1, 0.45, 0.12];
        audioDirector.playWorld('sfx:impact:stone:medium', {
          x: wx - 12,
          y: gy,
          z: wz - 12,
        }, {
          volume: 0.28,
          priority: 1,
          hrtf: true,
          maxDistance: 140,
        });
      } else if (this.activeWeatherKind === 'earthquake') {
        this.weatherFxTimer = 1.2 + Math.random() * 0.9;
        this.spawnMaterialBurst(
          { x: wx, y: gy + 0.05, z: wz },
          [0.55, 0.5, 0.45],
          3,
          0.45,
          1.4,
        );
        audioDirector.playWorld('sfx:impact:stone:short', {
          x: wx,
          y: gy,
          z: wz,
        }, {
          volume: 0.3,
          priority: 1,
          hrtf: false,
          maxDistance: 90,
        });
      }
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
      const targetFov = localPlayer.sprinting && !this.reducedMotion ? 1.13 : 1.08;
      this.camera.fov += (targetFov - this.camera.fov) * (1 - Math.exp(-8 * dt));

      let bestZipline: string | null = null;
      if (!localPlayer.ziplineRouteId) {
        let bestDist = 3.4;
        for (const route of this.islandMeta.ziplines) {
          const d = Math.hypot(
            localPlayer.position.x - route.from.x,
            localPlayer.position.y - route.from.y,
            localPlayer.position.z - route.from.z,
          );
          if (d < bestDist) {
            bestDist = d;
            bestZipline = route.id;
          }
        }
      }
      if (bestZipline !== this.nearbyZiplineId) {
        this.nearbyZiplineId = bestZipline;
        this.callbacks.onZiplineNearby?.(bestZipline ? 'a tirolesa' : null);
      }
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

    const targetEye = localPlayer?.crouching
      ? localPlayer.sliding
        ? 0.92
        : 1.1
      : 1.48;
    this.eyeHeight += (targetEye - this.eyeHeight) * (1 - Math.exp(-14 * dt));
    const eyePos = new Vector3(anchorPos.x, anchorPos.y + this.eyeHeight, anchorPos.z);
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
      const bobX = (isMoving ? Math.cos(this.animTime * 9) * 0.016 : Math.cos(this.animTime * 1.8) * 0.004) * (this.reducedMotion ? 0.35 : 1);
      const bobY = (isMoving ? Math.abs(Math.sin(this.animTime * 9)) * 0.018 : Math.sin(this.animTime * 1.8) * 0.004) * (this.reducedMotion ? 0.35 : 1);
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
    const shake =
      (this.cameraTrauma * this.cameraTrauma * 0.12 + quake) *
      (this.reducedMotion ? 0.25 : 1);
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
    const sprint =
      !this.promptOpen &&
      (this.keysPressed.has('ShiftLeft') || this.keysPressed.has('ShiftRight'));
    const crouch = !this.promptOpen && this.keysPressed.has('KeyC');
    this.callbacks.onSendInput(
      {
        moveX,
        moveZ,
        jump,
        sprint,
        crouch,
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
          y: localRig.currentPos.y + this.eyeHeight,
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
      else if (e.code === 'KeyE') {
        if (this.nearbyZiplineId) {
          this.callbacks.onUseZipline?.(this.nearbyZiplineId);
        } else {
          this.callbacks.onPickupItem();
        }
      }
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
      const locked = document.pointerLockElement === this.canvas;
      this.canvas.style.cursor = locked ? 'none' : '';
      resetMouseTracking();
      this.callbacks.onPointerLockChange?.(locked);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!e.isPrimary) return;
      if (this.mode !== 'playing' || this.promptOpen) {
        resetMouseTracking();
        return;
      }

      if (document.pointerLockElement === this.canvas) {
        const dy = this.invertY ? -e.movementY : e.movementY;
        const next = applyPointerLookDelta(
          this.yaw,
          this.pitch,
          e.movementX,
          dy,
          0.0026 * this.lookSensitivity,
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
        const next = applyPointerLookDelta(this.yaw, this.pitch, dx, dy, 0.0034 * this.lookSensitivity);
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
    this.bloomPipeline?.dispose();
    this.bloomPipeline = null;
    this.shoreFoamMesh?.dispose();
    this.shoreFoamMesh = null;
    this.shoreFoamMat?.dispose(true, true);
    this.shoreFoamMat = null;
    this.shoreFoamTexture?.dispose();
    this.shoreFoamTexture = null;
    this.waterNormalTexture?.dispose();
    this.waterNormalTexture = null;
    this.ziplineGroup?.dispose(false, true);
    this.ziplineGroup = null;
    audioDirector.setOccluder(null);
    for (const s of this.shockwaves) {
      s.mesh.dispose();
      s.mat.dispose();
    }
    this.shockwaves.length = 0;
    for (const d of this.decals) {
      d.mesh.dispose();
      d.mat.dispose(false, false);
    }
    this.decals.length = 0;
    this.scorchTexture?.dispose();
    this.scorchTexture = null;
    this.scene.dispose();
    this.engine.dispose();
  }
}
