import * as THREE from "three";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import type { GraphData, GraphNode } from "../types";

type SelectHandler = (node: GraphNode | null) => void;
type HoverHandler = (node: GraphNode | null, x: number, y: number) => void;

type NodeVisual = {
  node: GraphNode;
  group: THREE.Group;
  hit: THREE.Mesh;
  core: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  inner: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  marker: THREE.Sprite;
  glow: THREE.Sprite;
  label?: CSS2DObject;
  baseScale: number;
};

const SPHERE_RADIUS = 3.66;
const NOTE_COLORS = [0xa6c9ff, 0x7796ef, 0xa79de9, 0xd3a0be, 0x7db8c2, 0xbdacd9];
const PRIMARY_COLOR = 0xe2a0c5;

type TerrainProfile = { displacement: number; ridge: number };

type TerrainCrater = {
  center: THREE.Vector3;
  tangentA: THREE.Vector3;
  tangentB: THREE.Vector3;
  angularRadius: number;
  rimWidth: number;
  rimHeight: number;
  basinDepth: number;
  peakHeight: number;
  phase: number;
  harmonics: number;
};

function fract(value: number) {
  return value - Math.floor(value);
}

function hashNoise(x: number, y: number, z: number) {
  return fract(Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453123) * 2 - 1;
}

function valueNoise(x: number, y: number, z: number) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);
  const x00 = THREE.MathUtils.lerp(hashNoise(ix, iy, iz), hashNoise(ix + 1, iy, iz), ux);
  const x10 = THREE.MathUtils.lerp(hashNoise(ix, iy + 1, iz), hashNoise(ix + 1, iy + 1, iz), ux);
  const x01 = THREE.MathUtils.lerp(hashNoise(ix, iy, iz + 1), hashNoise(ix + 1, iy, iz + 1), ux);
  const x11 = THREE.MathUtils.lerp(hashNoise(ix, iy + 1, iz + 1), hashNoise(ix + 1, iy + 1, iz + 1), ux);
  const y0 = THREE.MathUtils.lerp(x00, x10, uy);
  const y1 = THREE.MathUtils.lerp(x01, x11, uy);
  return THREE.MathUtils.lerp(y0, y1, uz);
}

function fractalNoise(direction: THREE.Vector3, scale: number) {
  let x = direction.x * scale + 11.7;
  let y = direction.y * scale - 4.3;
  let z = direction.z * scale + 7.9;
  let amplitude = 0.56;
  let result = 0;
  let normalizer = 0;
  for (let octave = 0; octave < 4; octave += 1) {
    result += valueNoise(x, y, z) * amplitude;
    normalizer += amplitude;
    x = x * 1.93 + 3.1;
    y = y * 2.07 - 1.7;
    z = z * 1.89 + 2.4;
    amplitude *= 0.5;
  }
  return result / normalizer;
}

function createTerrainCraters() {
  let state = 0x83d2e5a1;
  const random = () => {
    state = Math.imul(state ^ (state >>> 15), 1 | state);
    state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
  };
  const craters: TerrainCrater[] = [];
  const count = 19;
  for (let index = 0; index < count; index += 1) {
    const z = index < 7 ? 0.22 + random() * 0.76 : random() * 2 - 1;
    const angle = random() * Math.PI * 2;
    const ring = Math.sqrt(Math.max(0, 1 - z * z));
    const center = new THREE.Vector3(Math.cos(angle) * ring, Math.sin(angle) * ring, z).normalize();
    const tangentA = new THREE.Vector3()
      .crossVectors(center, Math.abs(center.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0))
      .normalize();
    const tangentB = new THREE.Vector3().crossVectors(center, tangentA).normalize();
    const sizeBand = index < 2 ? 0.46 : index < 7 ? 0.25 : 0.11;
    const sizeSpread = index < 2 ? 0.12 : index < 7 ? 0.18 : 0.16;
    const angularRadius = sizeBand + random() * sizeSpread;
    const basinDepth = 0.045 + angularRadius * (0.17 + random() * 0.14);
    craters.push({
      center,
      tangentA,
      tangentB,
      angularRadius,
      rimWidth: 0.11 + random() * 0.1,
      rimHeight: 0.045 + angularRadius * (0.17 + random() * 0.12),
      basinDepth,
      peakHeight: random() > 0.68 ? basinDepth * (0.28 + random() * 0.5) : 0,
      phase: random() * Math.PI * 2,
      harmonics: 3 + Math.floor(random() * 5),
    });
  }
  return craters;
}

const TERRAIN_CRATERS = createTerrainCraters();

function terrainProfile(direction: THREE.Vector3): TerrainProfile {
  const continental = fractalNoise(direction, 1.45);
  const erosion = fractalNoise(direction, 4.8);
  const granular = fractalNoise(direction, 11.5);
  let displacement = continental * 0.14 + erosion * 0.057 + granular * 0.022;
  let ridge = Math.max(0, Math.abs(erosion) * 0.18 + Math.abs(granular) * 0.1);

  for (const crater of TERRAIN_CRATERS) {
    const dot = THREE.MathUtils.clamp(direction.dot(crater.center), -1, 1);
    if (dot < Math.cos(crater.angularRadius * 1.42)) continue;
    const angularDistance = Math.acos(dot);
    const localAngle = Math.atan2(direction.dot(crater.tangentB), direction.dot(crater.tangentA));
    const contourNoise = fractalNoise(direction, 8.2);
    const radiusWarp = 1
      + Math.sin(localAngle * crater.harmonics + crater.phase) * 0.09
      + Math.sin(localAngle * (crater.harmonics + 3) - crater.phase * 0.7) * 0.045
      + contourNoise * 0.055;
    const normalized = angularDistance / (crater.angularRadius * radiusWarp);
    const rimDistance = (normalized - 1) / crater.rimWidth;
    const rawRim = Math.exp(-rimDistance * rimDistance);
    const brokenEdge = Math.sin(localAngle * (crater.harmonics - 1) - crater.phase * 1.4)
      + Math.sin(localAngle * (crater.harmonics + 2) + crater.phase) * 0.42
      + contourNoise * 1.35;
    const edgeCompleteness = 0.04 + THREE.MathUtils.smoothstep(brokenEdge, -0.12, 0.68) * 0.96;
    const irregularRim = rawRim * edgeCompleteness;
    const bowl = normalized < 1 ? Math.pow(1 - normalized, 1.55) : 0;
    const centralPeak = crater.peakHeight > 0
      ? Math.exp(-Math.pow(normalized / 0.19, 2)) * crater.peakHeight
      : 0;
    displacement += irregularRim * crater.rimHeight - bowl * crater.basinDepth + centralPeak;
    ridge = Math.max(ridge, irregularRim * (0.76 + crater.rimHeight * 2.4), bowl * 0.14);
  }

  return {
    displacement: THREE.MathUtils.clamp(displacement, -0.29, 0.36),
    ridge: THREE.MathUtils.clamp(ridge, 0, 1),
  };
}

function terrainRadius(direction: THREE.Vector3) {
  return SPHERE_RADIUS + terrainProfile(direction).displacement;
}

const ANCHORS = [
  new THREE.Vector3(0.45, -0.12, 2.9),
  new THREE.Vector3(-1.85, 1.05, 2.15),
  new THREE.Vector3(1.75, 1.35, 1.9),
  new THREE.Vector3(-1.65, -1.45, 1.85),
  new THREE.Vector3(1.75, -1.25, 1.6),
  new THREE.Vector3(0.05, 2.45, 1.15),
  new THREE.Vector3(-0.15, -2.5, 1.05),
  new THREE.Vector3(2.6, 0.15, 0.65),
].map((anchor) => anchor.normalize());

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let output = value;
    output = Math.imul(output ^ (output >>> 15), output | 1);
    output ^= output + Math.imul(output ^ (output >>> 7), output | 61);
    return ((output ^ (output >>> 14)) >>> 0) / 4294967296;
  };
}

function createGlowTexture(size = 128) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.12, "rgba(255,255,255,.96)");
  gradient.addColorStop(0.36, "rgba(255,255,255,.34)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createNodeMarkerTexture(size = 192) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d")!;
  const center = size / 2;

  const body = context.createRadialGradient(center, center, 0, center, center, size * 0.24);
  body.addColorStop(0, "rgba(255,255,255,1)");
  body.addColorStop(0.12, "rgba(255,255,255,.9)");
  body.addColorStop(0.3, "rgba(255,255,255,.38)");
  body.addColorStop(0.58, "rgba(255,255,255,.08)");
  body.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = body;
  context.fillRect(0, 0, size, size);

  context.strokeStyle = "rgba(255,255,255,.86)";
  context.lineWidth = size * 0.01;
  context.beginPath();
  context.arc(center, center, size * 0.235, 0, Math.PI * 2);
  context.stroke();

  context.strokeStyle = "rgba(255,255,255,.34)";
  context.lineWidth = size * 0.007;
  context.beginPath();
  context.arc(center, center, size * 0.36, 0, Math.PI * 2);
  context.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function displayGroupName(value: string) {
  return value.replace(/^\d+[.]?\s*/, "") || "Заметки";
}

export class SphericalGraph {
  private readonly canvas: HTMLCanvasElement;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;
  private readonly labelRenderer = new CSS2DRenderer();
  private readonly root = new THREE.Group();
  private readonly networkRoot = new THREE.Group();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly clock = new THREE.Clock();
  private readonly glowTexture = createGlowTexture();
  private readonly nodeMarkerTexture = createNodeMarkerTexture();
  private readonly nodeVisuals: NodeVisual[] = [];
  private readonly hitMeshes: THREE.Mesh[] = [];
  private readonly degrees = new Map<string, number>();
  private readonly tempWorld = new THREE.Vector3();
  private readonly tempNormal = new THREE.Vector3();
  private readonly tempCameraDirection = new THREE.Vector3();
  private selectedId: string | null = null;
  private hoveredId: string | null = null;
  private primaryNode: GraphNode | null = null;
  private search = "";
  private dragging = false;
  private moved = false;
  private lastX = 0;
  private lastY = 0;
  private velocityX = 0;
  private velocityY = 0;
  private autoRotate: boolean;
  private readonly focusStart = new THREE.Quaternion();
  private readonly focusEnd = new THREE.Quaternion();
  private focusElapsed = 0;
  private focusDuration = 0;
  private focusing = false;
  private animationFrame = 0;
  private resizeObserver: ResizeObserver;
  private onSelect: SelectHandler = () => undefined;
  private onHover: HoverHandler = () => undefined;
  private readonly reducedMotion: boolean;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.autoRotate = !this.reducedMotion;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.97;
    this.renderer.setClearColor(0x02040a, 1);
    this.camera.position.set(0, 0, 12);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.86, 0.46, 0.5);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    this.labelRenderer.domElement.className = "graph-label-layer";
    (canvas.parentElement ?? document.body).appendChild(this.labelRenderer.domElement);

    this.scene.add(this.createStarfield());
    this.scene.add(new THREE.HemisphereLight(0x8297c2, 0x02040a, 0.3));
    const terrainLight = new THREE.DirectionalLight(0xc7d6ff, 2.5);
    terrainLight.position.set(-4.5, 6.5, 8);
    this.scene.add(terrainLight);
    this.scene.add(this.root);
    this.root.add(this.createTerrainSurface());
    this.root.add(this.createAtmosphere());
    this.root.add(this.createShellDust());
    this.root.add(this.createTerrainAccents());
    this.root.add(this.createSparkleShell());
    this.root.add(this.createInnerDust());
    this.root.add(this.networkRoot);
    this.root.rotation.set(-0.035, -0.12, 0.015);

    this.bindEvents();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
    this.resize();
    this.animate();
  }

  setHandlers(onSelect: SelectHandler, onHover: HoverHandler) {
    this.onSelect = onSelect;
    this.onHover = onHover;
  }

  getPrimaryNode() {
    return this.primaryNode;
  }

  setData(data: GraphData) {
    this.selectedId = null;
    this.hoveredId = null;
    this.primaryNode = null;
    this.focusing = false;
    this.degrees.clear();
    data.nodes.forEach((node) => this.degrees.set(node.id, 0));
    data.edges.forEach((edge) => {
      this.degrees.set(edge.source, (this.degrees.get(edge.source) ?? 0) + 1);
      this.degrees.set(edge.target, (this.degrees.get(edge.target) ?? 0) + 1);
    });
    this.clearNetwork();

    const grouped = new Map<string, GraphNode[]>();
    data.nodes.forEach((node) => grouped.set(node.group, [...(grouped.get(node.group) ?? []), node]));
    const orderedGroups = [...grouped.entries()].sort(([nameA, notesA], [nameB, notesB]) => {
      const projectA = /project|проект/i.test(nameA) ? 1 : 0;
      const projectB = /project|проект/i.test(nameB) ? 1 : 0;
      return projectB - projectA || notesB.length - notesA.length;
    });

    const positions = new Map<string, THREE.Vector3>();
    const colorByGroup = new Map<string, number>();
    const clusterNodes: GraphNode[] = [];

    orderedGroups.forEach(([groupName, notes], groupIndex) => {
      const anchor = (ANCHORS[groupIndex] ?? this.fibonacciDirection(groupIndex, orderedGroups.length)).clone();
      const cluster: GraphNode = {
        id: `@cluster/${groupName}`,
        title: displayGroupName(groupName),
        path: `${notes.length} заметок в кластере`,
        group: groupName,
        kind: "cluster",
        noteCount: notes.length,
      };
      const color = groupIndex === 0 ? PRIMARY_COLOR : NOTE_COLORS[(groupIndex - 1) % NOTE_COLORS.length];
      colorByGroup.set(groupName, color);
      clusterNodes.push(cluster);
      positions.set(cluster.id, anchor.clone().multiplyScalar(terrainRadius(anchor) + 0.045));
      if (groupIndex === 0) this.primaryNode = cluster;

      const tangentA = new THREE.Vector3().crossVectors(anchor, Math.abs(anchor.y) > 0.88 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize();
      const tangentB = new THREE.Vector3().crossVectors(anchor, tangentA).normalize();
      notes.forEach((note, noteIndex) => {
        const angle = noteIndex * Math.PI * (3 - Math.sqrt(5));
        const spread = Math.min(1.08, 0.22 + Math.sqrt(noteIndex + 0.2) * 0.18);
        const direction = anchor.clone()
          .addScaledVector(tangentA, Math.cos(angle) * spread)
          .addScaledVector(tangentB, Math.sin(angle) * spread)
          .normalize();
        const position = direction.multiplyScalar(terrainRadius(direction) + 0.035 + ((noteIndex % 3) - 1) * 0.022);
        positions.set(note.id, position);
      });
    });

    this.networkRoot.add(this.createAmbientNetwork());
    this.networkRoot.add(this.createGraphLines(data, orderedGroups, clusterNodes, positions, colorByGroup));

    const rankedNotes = [...data.nodes]
      .sort((a, b) => (this.degrees.get(b.id) ?? 0) - (this.degrees.get(a.id) ?? 0))
      .slice(0, Math.min(15, Math.max(8, Math.round(Math.sqrt(data.nodes.length) * 2.8))));
    const labeledIds = new Set(rankedNotes.map((node) => node.id));

    clusterNodes.forEach((cluster, index) => {
      const visual = this.createNodeVisual(cluster, positions.get(cluster.id)!, colorByGroup.get(cluster.group)!, true, true);
      this.nodeVisuals.push(visual);
      this.networkRoot.add(visual.group);
      if (index === 0) this.networkRoot.add(this.createHubRings(positions.get(cluster.id)!, colorByGroup.get(cluster.group)!));
    });

    data.nodes.forEach((node) => {
      const visual = this.createNodeVisual(node, positions.get(node.id)!, colorByGroup.get(node.group)!, false, labeledIds.has(node.id));
      this.nodeVisuals.push(visual);
      this.networkRoot.add(visual.group);
    });

    this.applyVisualState();
  }

  setSearch(value: string) {
    this.search = value.trim().toLocaleLowerCase();
    this.applyVisualState();
  }

  focusNode(id: string) {
    const visual = this.nodeVisuals.find((candidate) => candidate.node.id === id);
    if (!visual) return;
    this.selectedId = id;
    this.autoRotate = false;
    this.velocityX = 0;
    this.velocityY = 0;
    const localDirection = visual.group.position.clone().normalize();
    const desiredDirection = new THREE.Vector3(0.08, -0.02, 1).normalize();
    this.focusStart.copy(this.root.quaternion);
    this.focusEnd.setFromUnitVectors(localDirection, desiredDirection);

    const turnAngle = this.focusStart.angleTo(this.focusEnd);
    this.focusElapsed = 0;
    this.focusDuration = THREE.MathUtils.clamp(0.52 + turnAngle * 0.3, 0.68, 1.38);
    this.focusing = !this.reducedMotion && turnAngle > 0.002;
    if (!this.focusing) this.root.quaternion.copy(this.focusEnd);
    this.applyVisualState();
  }

  private createStarfield() {
    const random = seededRandom(18);
    const count = window.innerWidth < 720 ? 700 : 1500;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      const radius = 14 + random() * 18;
      const theta = random() * Math.PI * 2;
      const phi = Math.acos(2 * random() - 1);
      positions[index * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[index * 3 + 1] = radius * Math.cos(phi);
      positions[index * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta) - 5;
      const brightness = 0.35 + random() * 0.65;
      colors[index * 3] = 0.55 * brightness;
      colors[index * 3 + 1] = 0.67 * brightness;
      colors[index * 3 + 2] = brightness;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return new THREE.Points(geometry, new THREE.PointsMaterial({
      size: 0.06,
      map: this.glowTexture,
      transparent: true,
      opacity: 0.86,
      vertexColors: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
  }

  private createTerrainGeometry(widthSegments: number, heightSegments: number) {
    const geometry = new THREE.SphereGeometry(SPHERE_RADIUS, widthSegments, heightSegments);
    const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
    const direction = new THREE.Vector3();
    for (let index = 0; index < positions.count; index += 1) {
      direction.fromBufferAttribute(positions, index).normalize();
      const radius = terrainRadius(direction);
      positions.setXYZ(index, direction.x * radius, direction.y * radius, direction.z * radius);
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    return geometry;
  }

  private createTerrainSurface() {
    const geometry = this.createTerrainGeometry(128, 96);
    const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
    const colors = new Float32Array(positions.count * 3);
    const direction = new THREE.Vector3();
    for (let index = 0; index < positions.count; index += 1) {
      direction.fromBufferAttribute(positions, index).normalize();
      const profile = terrainProfile(direction);
      const elevation = THREE.MathUtils.clamp((profile.displacement + 0.29) / 0.65, 0, 1);
      colors[index * 3] = 0.055 + elevation * 0.07 + profile.ridge * 0.12;
      colors[index * 3 + 1] = 0.08 + elevation * 0.1 + profile.ridge * 0.14;
      colors[index * 3 + 2] = 0.16 + elevation * 0.18 + profile.ridge * 0.22;
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const surface = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.66,
      roughness: 0.94,
      metalness: 0.06,
      emissive: 0x030713,
      emissiveIntensity: 0.28,
      depthWrite: false,
      side: THREE.FrontSide,
    }));
    surface.renderOrder = -2;
    return surface;
  }

  private createAtmosphere() {
    const geometry = this.createTerrainGeometry(96, 72);
    return new THREE.Mesh(
      geometry,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.FrontSide,
        uniforms: { glowColor: { value: new THREE.Color(0x4166a8) } },
        vertexShader: `
          varying vec3 vNormal;
          varying vec3 vWorldPosition;
          void main() {
            vNormal = normalize(normalMatrix * normal);
            vec4 worldPosition = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPosition.xyz;
            gl_Position = projectionMatrix * viewMatrix * worldPosition;
          }
        `,
        fragmentShader: `
          uniform vec3 glowColor;
          varying vec3 vNormal;
          varying vec3 vWorldPosition;
          void main() {
            vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
            float rim = pow(1.0 - max(dot(vNormal, viewDirection), 0.0), 3.2);
            float haze = pow(1.0 - max(dot(vNormal, viewDirection), 0.0), 1.4) * 0.055;
            gl_FragColor = vec4(glowColor, rim * 0.22 + haze * 0.45);
          }
        `,
      }),
    );
  }

  private createShellDust() {
    const random = seededRandom(91);
    const count = window.innerWidth < 720 ? 6500 : 16800;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      const direction = this.randomDirection(random);
      const profile = terrainProfile(direction);
      const radius = SPHERE_RADIUS + profile.displacement + (random() - 0.5) * (0.055 + profile.ridge * 0.08);
      positions[index * 3] = direction.x * radius;
      positions[index * 3 + 1] = direction.y * radius;
      positions[index * 3 + 2] = direction.z * radius;
      const mix = random();
      const elevation = THREE.MathUtils.clamp((profile.displacement + 0.29) / 0.65, 0, 1);
      colors[index * 3] = 0.11 + mix * 0.08 + elevation * 0.12 + profile.ridge * 0.48;
      colors[index * 3 + 1] = 0.16 + mix * 0.1 + elevation * 0.17 + profile.ridge * 0.43;
      colors[index * 3 + 2] = 0.34 + mix * 0.13 + elevation * 0.23 + profile.ridge * 0.4;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return new THREE.Points(geometry, new THREE.PointsMaterial({
      size: 0.018,
      map: this.glowTexture,
      transparent: true,
      opacity: 0.72,
      vertexColors: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      alphaTest: 0.01,
    }));
  }

  private createTerrainAccents() {
    const random = seededRandom(1312);
    const positions: number[] = [];
    const colors: number[] = [];
    const density = window.innerWidth < 720 ? 0.38 : 1;
    const addParticle = (direction: THREE.Vector3) => {
      const profile = terrainProfile(direction);
      const spray = Math.pow(random(), 5.2) * (0.035 + profile.ridge * 0.19) + (random() - 0.5) * 0.025;
      const radius = SPHERE_RADIUS + profile.displacement + spray;
      positions.push(direction.x * radius, direction.y * radius, direction.z * radius);

      const white = random() > 0.975;
      const rose = random() < 0.13 + profile.ridge * 0.28;
      const elevation = THREE.MathUtils.clamp((profile.displacement + 0.29) / 0.65, 0, 1);
      const brightness = 0.2 + elevation * 0.14 + profile.ridge * 0.58 + random() * 0.18;
      const base = white ? [0.9, 0.92, 1] : rose ? [0.78, 0.43, 0.75] : [0.38, 0.57, 0.94];
      colors.push(base[0] * brightness, base[1] * brightness, base[2] * brightness);
    };

    for (const crater of TERRAIN_CRATERS) {
      const requestedCount = Math.round((620 + crater.angularRadius * 2550) * density);
      for (let index = 0; index < requestedCount; index += 1) {
        const angle = random() * Math.PI * 2;
        const radialBias = Math.pow(random(), 0.62) * 1.28;
        const distance = crater.angularRadius * radialBias;
        const tangent = crater.tangentA.clone()
          .multiplyScalar(Math.cos(angle))
          .addScaledVector(crater.tangentB, Math.sin(angle));
        const direction = crater.center.clone()
          .multiplyScalar(Math.cos(distance))
          .addScaledVector(tangent, Math.sin(distance))
          .normalize();
        addParticle(direction);
      }
    }

    const globalCount = Math.round(5200 * density);
    for (let index = 0; index < globalCount; index += 1) {
      const direction = this.randomDirection(random);
      const profile = terrainProfile(direction);
      if (random() < 0.38 + profile.ridge * 0.58) addParticle(direction);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    return new THREE.Points(geometry, new THREE.PointsMaterial({
      size: 0.034,
      map: this.glowTexture,
      transparent: true,
      opacity: 0.9,
      vertexColors: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      alphaTest: 0.012,
      toneMapped: false,
    }));
  }

  private createInnerDust() {
    const random = seededRandom(309);
    const count = window.innerWidth < 720 ? 500 : 1100;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      const direction = this.randomDirection(random);
      const radius = SPHERE_RADIUS * Math.cbrt(random()) * 0.96;
      positions[index * 3] = direction.x * radius;
      positions[index * 3 + 1] = direction.y * radius;
      positions[index * 3 + 2] = direction.z * radius;
      const purple = random();
      colors[index * 3] = 0.27 + purple * 0.27;
      colors[index * 3 + 1] = 0.3 + purple * 0.19;
      colors[index * 3 + 2] = 0.64 + purple * 0.24;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return new THREE.Points(geometry, new THREE.PointsMaterial({
      size: 0.019,
      map: this.glowTexture,
      transparent: true,
      opacity: 0.41,
      vertexColors: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
  }

  private createSparkleShell() {
    const random = seededRandom(777);
    const count = window.innerWidth < 720 ? 900 : 2800;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      const direction = this.randomDirection(random);
      const profile = terrainProfile(direction);
      const radius = SPHERE_RADIUS + profile.displacement + (random() - 0.5) * (0.13 + profile.ridge * 0.12);
      positions[index * 3] = direction.x * radius;
      positions[index * 3 + 1] = direction.y * radius;
      positions[index * 3 + 2] = direction.z * radius;
      const magenta = random() > 0.82;
      const brightness = (0.48 + profile.ridge * 0.34) + random() * 0.18;
      colors[index * 3] = (magenta ? 0.76 : 0.52) * brightness;
      colors[index * 3 + 1] = (magenta ? 0.5 : 0.66) * brightness;
      colors[index * 3 + 2] = (magenta ? 0.74 : 0.92) * brightness;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return new THREE.Points(geometry, new THREE.PointsMaterial({
      size: 0.032,
      map: this.glowTexture,
      transparent: true,
      opacity: 0.9,
      vertexColors: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      alphaTest: 0.015,
      toneMapped: false,
    }));
  }

  private createAmbientNetwork() {
    const group = new THREE.Group();
    const random = seededRandom(2026);
    const count = window.innerWidth < 720 ? 120 : 320;
    const positions: THREE.Vector3[] = [];
    const positionArray = new Float32Array(count * 3);
    const colorArray = new Float32Array(count * 3);
    const accentPositions: number[] = [];
    const accentColors: number[] = [];
    for (let index = 0; index < count; index += 1) {
      const direction = this.fibonacciDirection(index, count);
      const radius = terrainRadius(direction) - 0.035 - random() * 0.055;
      const position = direction.multiplyScalar(radius);
      positions.push(position);
      positionArray.set([position.x, position.y, position.z], index * 3);
      const magenta = random() > 0.72;
      const color = magenta ? [0.76, 0.46, 0.72] : [0.42, 0.58, 0.88];
      colorArray.set(color, index * 3);
      if (index % 5 === 0) {
        accentPositions.push(position.x, position.y, position.z);
        accentColors.push(...color);
      }
    }
    const pointGeometry = new THREE.BufferGeometry();
    pointGeometry.setAttribute("position", new THREE.BufferAttribute(positionArray, 3));
    pointGeometry.setAttribute("color", new THREE.BufferAttribute(colorArray, 3));
    group.add(new THREE.Points(pointGeometry, new THREE.PointsMaterial({
      size: 0.065,
      map: this.glowTexture,
      transparent: true,
      opacity: 0.88,
      vertexColors: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    })));

    const accentGeometry = new THREE.BufferGeometry();
    accentGeometry.setAttribute("position", new THREE.Float32BufferAttribute(accentPositions, 3));
    accentGeometry.setAttribute("color", new THREE.Float32BufferAttribute(accentColors, 3));
    group.add(new THREE.Points(accentGeometry, new THREE.PointsMaterial({
      size: 0.115,
      map: this.nodeMarkerTexture,
      transparent: true,
      opacity: 0.9,
      vertexColors: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      alphaTest: 0.015,
      toneMapped: false,
    })));

    const linePositions: number[] = [];
    const lineColors: number[] = [];
    positions.forEach((position, index) => {
      const targets = [positions[(index + 13) % count], positions[(index + 34) % count]];
      targets.forEach((target, targetIndex) => {
        if (position.distanceTo(target) > (targetIndex === 0 ? 2.15 : 1.5)) return;
        linePositions.push(position.x, position.y, position.z, target.x, target.y, target.z);
        const color = targetIndex === 0 ? [0.3, 0.43, 0.72] : [0.53, 0.42, 0.7];
        lineColors.push(...color, ...color);
      });
    });
    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));
    lineGeometry.setAttribute("color", new THREE.Float32BufferAttribute(lineColors, 3));
    group.add(new THREE.LineSegments(lineGeometry, new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.17,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })));
    return group;
  }

  private createGraphLines(
    data: GraphData,
    orderedGroups: Array<[string, GraphNode[]]>,
    clusters: GraphNode[],
    positions: Map<string, THREE.Vector3>,
    colors: Map<string, number>,
  ) {
    const linePositions: number[] = [];
    const lineColors: number[] = [];
    const addLine = (source: THREE.Vector3, target: THREE.Vector3, sourceColor: THREE.Color, targetColor: THREE.Color) => {
      linePositions.push(source.x, source.y, source.z, target.x, target.y, target.z);
      lineColors.push(sourceColor.r, sourceColor.g, sourceColor.b, targetColor.r, targetColor.g, targetColor.b);
    };

    orderedGroups.forEach(([groupName, notes], index) => {
      const cluster = clusters[index];
      const clusterPosition = positions.get(cluster.id)!;
      const color = new THREE.Color(colors.get(groupName)!);
      notes.forEach((note) => addLine(clusterPosition, positions.get(note.id)!, color, color));
    });

    const nodeById = new Map(data.nodes.map((node) => [node.id, node]));
    data.edges.forEach((edge) => {
      const source = positions.get(edge.source);
      const target = positions.get(edge.target);
      const sourceNode = nodeById.get(edge.source);
      const targetNode = nodeById.get(edge.target);
      if (!source || !target || !sourceNode || !targetNode) return;
      addLine(source, target, new THREE.Color(colors.get(sourceNode.group)!), new THREE.Color(colors.get(targetNode.group)!));
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(lineColors, 3));
    const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    lines.userData.kind = "graph-lines";
    return lines;
  }

  private createNodeVisual(node: GraphNode, position: THREE.Vector3, colorValue: number, cluster: boolean, label: boolean): NodeVisual {
    const group = new THREE.Group();
    group.position.copy(position);
    const degree = node.kind === "cluster" ? node.noteCount ?? 1 : this.degrees.get(node.id) ?? 0;
    const radius = cluster
      ? 0.11 + Math.min(degree, 28) * 0.0021
      : 0.03 + Math.sqrt(Math.min(degree, 16)) * 0.018;
    const color = new THREE.Color(colorValue);
    const innerColor = color.clone().lerp(new THREE.Color(0xf0f4fb), cluster ? 0.76 : 0.64);
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 24, 18),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }),
    );
    const inner = new THREE.Mesh(
      new THREE.SphereGeometry(radius * (cluster ? 0.21 : 0.18), 18, 12),
      new THREE.MeshBasicMaterial({ color: innerColor, transparent: true, opacity: cluster ? 0.96 : 0.86 }),
    );
    const marker = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.nodeMarkerTexture,
      color,
      transparent: true,
      opacity: cluster ? 0.92 : 0.78,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }));
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.glowTexture,
      color,
      transparent: true,
      opacity: cluster ? 0.58 : 0.36,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }));
    marker.scale.setScalar(radius * (cluster ? 5.6 : 5));
    const glowSize = radius * (cluster ? 6.4 : 5.8);
    glow.scale.setScalar(glowSize);
    group.add(glow, marker, core, inner);

    const hit = new THREE.Mesh(
      new THREE.SphereGeometry(Math.max(radius * 2.1, 0.15), 10, 8),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    hit.userData.node = node;
    group.add(hit);
    this.hitMeshes.push(hit);

    let labelObject: CSS2DObject | undefined;
    if (label) {
      const element = document.createElement("span");
      element.className = cluster ? "graph-label graph-label--cluster" : "graph-label";
      element.textContent = node.title;
      labelObject = new CSS2DObject(element);
      labelObject.position.set(radius * 1.5, cluster ? -0.22 : -0.13, 0);
      group.add(labelObject);
    }

    return { node, group, hit, core, inner, marker, glow, label: labelObject, baseScale: cluster ? 1.06 : 1 };
  }

  private createHubRings(position: THREE.Vector3, colorValue: number) {
    const group = new THREE.Group();
    group.position.copy(position);
    group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), position.clone().normalize());
    [0.22, 0.34, 0.48, 0.63].forEach((radius, index) => {
      const points = Array.from({ length: 72 }, (_, pointIndex) => {
        const angle = (pointIndex / 72) * Math.PI * 2;
        return new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
      });
      const ring = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({
          color: colorValue,
          transparent: true,
          opacity: 0.48 - index * 0.085,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      group.add(ring);
    });
    const spokePositions: number[] = [];
    for (let index = 0; index < 20; index += 1) {
      const angle = (index / 20) * Math.PI * 2;
      spokePositions.push(0, 0, 0, Math.cos(angle) * 0.64, Math.sin(angle) * 0.64, 0);
    }
    const spokes = new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(spokePositions, 3)),
      new THREE.LineBasicMaterial({ color: colorValue, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    group.add(spokes);
    return group;
  }

  private applyVisualState() {
    for (const visual of this.nodeVisuals) {
      const { node, group, label } = visual;
      const matches = !this.search
        || node.title.toLocaleLowerCase().includes(this.search)
        || node.path.toLocaleLowerCase().includes(this.search)
        || node.group.toLocaleLowerCase().includes(this.search);
      const selected = node.id === this.selectedId;
      const hovered = node.id === this.hoveredId;
      group.userData.visualState = { matches, selected, hovered };
      group.userData.targetScale = visual.baseScale * (selected ? 1.48 : hovered ? 1.25 : 1);
      if (label) {
        const element = label.element;
        element.classList.toggle("is-selected", selected);
        element.dataset.searchMatch = matches ? "true" : "false";
      }
    }
  }

  private updateNodeVisuals(elapsed: number, delta: number) {
    this.root.updateMatrixWorld(true);
    for (const visual of this.nodeVisuals) {
      const { node, group, core, inner, marker, glow, label } = visual;
      const state = group.userData.visualState as { matches: boolean; selected: boolean; hovered: boolean } | undefined;
      const matches = state?.matches ?? true;
      const selected = state?.selected ?? false;
      const hovered = state?.hovered ?? false;

      group.getWorldPosition(this.tempWorld);
      this.tempNormal.copy(group.position).normalize().transformDirection(this.root.matrixWorld);
      this.tempCameraDirection.copy(this.camera.position).sub(this.tempWorld).normalize();
      const facing = this.tempNormal.dot(this.tempCameraDirection);
      const depth = 0.24 + THREE.MathUtils.smoothstep(facing, -0.42, 0.38) * 0.76;
      const visibility = (matches ? 1 : 0.075) * depth;
      const isCluster = node.kind === "cluster";

      core.material.opacity = visibility * (isCluster ? 0.92 : 0.78);
      inner.material.opacity = visibility * (isCluster ? 0.98 : 0.88);
      (marker.material as THREE.SpriteMaterial).opacity = visibility * (selected || hovered ? 1 : isCluster ? 0.88 : 0.72);
      (glow.material as THREE.SpriteMaterial).opacity = visibility * (selected || hovered ? 0.78 : isCluster ? 0.5 : 0.3);

      const pulse = selected && !this.reducedMotion ? 1 + Math.sin(elapsed * 2.4) * 0.022 : 1;
      const targetScale = ((group.userData.targetScale as number | undefined) ?? visual.baseScale) * pulse;
      const easing = this.reducedMotion ? 1 : 1 - Math.exp(-delta * 13);
      group.scale.setScalar(THREE.MathUtils.lerp(group.scale.x, targetScale, easing));

      if (label) {
        const searchMatch = label.element.dataset.searchMatch !== "false";
        const opacity = searchMatch ? THREE.MathUtils.smoothstep(facing, -0.12, 0.34) : 0;
        label.element.style.opacity = String(opacity);
        label.element.style.visibility = opacity < 0.06 ? "hidden" : "visible";
      }
    }
  }

  private bindEvents() {
    this.canvas.addEventListener("pointerdown", (event) => {
      this.dragging = true;
      this.moved = false;
      this.focusing = false;
      this.lastX = event.clientX;
      this.lastY = event.clientY;
      this.velocityX = 0;
      this.velocityY = 0;
      this.autoRotate = false;
      this.canvas.setPointerCapture(event.pointerId);
    });
    this.canvas.addEventListener("pointermove", (event) => {
      if (this.dragging) {
        const dx = event.clientX - this.lastX;
        const dy = event.clientY - this.lastY;
        if (Math.abs(dx) + Math.abs(dy) > 2) this.moved = true;
        this.velocityY = dx * 0.0035;
        this.velocityX = dy * 0.0035;
        this.root.rotation.y += this.velocityY;
        this.root.rotation.x += this.velocityX;
        this.lastX = event.clientX;
        this.lastY = event.clientY;
      }
      this.updatePointer(event);
      const hit = this.pickNode();
      const node = hit?.userData.node as GraphNode | undefined;
      const id = node?.id ?? null;
      if (id !== this.hoveredId) {
        this.hoveredId = id;
        this.canvas.classList.toggle("is-hovering-node", Boolean(id));
        this.applyVisualState();
      }
      this.onHover(node ?? null, event.clientX, event.clientY);
    });
    this.canvas.addEventListener("pointerup", (event) => {
      this.dragging = false;
      this.canvas.releasePointerCapture(event.pointerId);
      if (this.moved) return;
      this.updatePointer(event);
      const hit = this.pickNode();
      const node = hit?.userData.node as GraphNode | undefined;
      if (node) {
        this.focusNode(node.id);
      } else {
        this.selectedId = null;
        this.applyVisualState();
      }
      this.onSelect(node ?? null);
    });
    this.canvas.addEventListener("pointerleave", () => {
      this.dragging = false;
      this.hoveredId = null;
      this.canvas.classList.remove("is-hovering-node");
      this.applyVisualState();
      this.onHover(null, 0, 0);
    });
    this.canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      this.camera.position.z = THREE.MathUtils.clamp(this.camera.position.z + event.deltaY * 0.007, 7.1, 26);
      this.autoRotate = false;
      this.focusing = false;
    }, { passive: false });
  }

  private updatePointer(event: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private pickNode() {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObjects(this.hitMeshes, false)[0]?.object as THREE.Mesh | undefined;
  }

  private resize() {
    const parent = this.canvas.parentElement ?? this.canvas;
    const width = Math.max(parent.clientWidth, 1);
    const height = Math.max(parent.clientHeight, 1);
    this.camera.aspect = width / height;
    this.camera.position.z = width < 720 ? 21.5 : 12;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    this.labelRenderer.setSize(width, height);
  }

  private animate = () => {
    const delta = Math.min(this.clock.getDelta(), 0.05);
    const elapsed = this.clock.elapsedTime;
    if (!this.dragging) {
      if (this.focusing) {
        this.focusElapsed = Math.min(this.focusElapsed + delta, this.focusDuration);
        const progress = this.focusElapsed / this.focusDuration;
        const eased = progress * progress * progress * (progress * (progress * 6 - 15) + 10);
        this.root.quaternion.slerpQuaternions(this.focusStart, this.focusEnd, eased);
        if (progress >= 1) this.focusing = false;
      } else {
        this.root.rotation.y += this.autoRotate ? delta * 0.035 : this.velocityY;
        this.root.rotation.x += this.velocityX;
        this.velocityX *= 0.92;
        this.velocityY *= 0.92;
      }
    }
    this.updateNodeVisuals(elapsed, delta);
    this.composer.render();
    this.labelRenderer.render(this.scene, this.camera);
    this.animationFrame = requestAnimationFrame(this.animate);
  };

  private fibonacciDirection(index: number, count: number) {
    const safeCount = Math.max(count, 1);
    const y = 1 - ((index + 0.5) / safeCount) * 2;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const angle = Math.PI * (3 - Math.sqrt(5)) * index;
    return new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
  }

  private randomDirection(random: () => number) {
    const y = random() * 2 - 1;
    const angle = random() * Math.PI * 2;
    const radius = Math.sqrt(1 - y * y);
    return new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
  }

  private clearNetwork() {
    this.nodeVisuals.length = 0;
    this.hitMeshes.length = 0;
    this.networkRoot.traverse((object) => {
      if (object instanceof CSS2DObject) object.element.remove();
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose();
      if (Array.isArray(mesh.material)) mesh.material.forEach((material) => material.dispose());
      else mesh.material?.dispose();
    });
    this.networkRoot.clear();
  }

  destroy() {
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    this.clearNetwork();
    this.labelRenderer.domElement.remove();
    this.glowTexture.dispose();
    this.nodeMarkerTexture.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }
}
