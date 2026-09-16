import * as THREE from "three";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import {
  buildNoteAdjacency,
  focusDistances,
  focusedNoteCount,
  normalizeFocusDepth,
  type FocusDepth,
  type NoteAdjacency,
} from "./focus";
import { performanceProfileFor, sampleEvenly, type PerformanceProfile, type PerformanceTier } from "./performance";
import type { GraphData, GraphNode } from "../types";

type SelectHandler = (node: GraphNode | null) => void;
type HoverHandler = (node: GraphNode | null, x: number, y: number) => void;
export type SphereStyle = "calm" | "radiant";
export type LabelMode = "none" | "important" | "all";

type NodeVisual = {
  node: GraphNode;
  group: THREE.Group;
  hit: THREE.Mesh;
  core: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  inner: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  marker: THREE.Sprite;
  glow: THREE.Sprite;
  label?: CSS2DObject;
  importantLabel: boolean;
  baseScale: number;
  calmColor: THREE.Color;
  radiantColor: THREE.Color;
};

type BatchedLabel = {
  node: GraphNode;
  object: CSS2DObject;
  important: boolean;
  base: boolean;
};

type BatchedNodeCloud = {
  points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  nodes: GraphNode[];
  indexById: Map<string, number>;
  calmColors: THREE.BufferAttribute;
  radiantColors: THREE.BufferAttribute;
  visibility: THREE.BufferAttribute;
  scale: THREE.BufferAttribute;
};

const SPHERE_RADIUS = 3.66;
const RADIANT_NOTE_COLORS = [0x8fdcff, 0x718dff, 0xa980ff, 0xea87e6, 0x71e0df, 0xc4a1ff];
const CALM_NOTE_COLORS = [0xa6c9ff, 0x7796ef, 0xa79de9, 0xd3a0be, 0x7db8c2, 0xbdacd9];
const RADIANT_PRIMARY_COLOR = 0xff91dc;
const CALM_PRIMARY_COLOR = 0xe2a0c5;
const NODE_HIGHLIGHT_COLOR = new THREE.Color(0xf0f4fb);

type TerrainProfile = { displacement: number; ridge: number };

type StyledPointCloud = {
  points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  calmColors: THREE.BufferAttribute;
  radiantColors: THREE.BufferAttribute;
  calmOpacity: number;
  radiantOpacity: number;
  calmSize: number;
  radiantSize: number;
};

type StyledLineMaterial = {
  material: THREE.LineBasicMaterial;
  calmColor: THREE.Color;
  radiantColor: THREE.Color;
};

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
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

function createCosmicBackgroundTexture(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d")!;
  const random = seededRandom(0x5ca1ab1e);

  const clamp = (value: number, minimum = 0, maximum = 1) => Math.max(minimum, Math.min(maximum, value));
  const smoothstep = (value: number) => value * value * (3 - 2 * value);
  const noiseHash = (x: number, y: number) => {
    let value = Math.imul(x, 374761393) + Math.imul(y, 668265263) + 0x5ca1ab1e;
    value = Math.imul(value ^ (value >>> 13), 1274126177);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
  };
  const valueNoise = (x: number, y: number) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = smoothstep(x - x0);
    const ty = smoothstep(y - y0);
    const top = noiseHash(x0, y0) * (1 - tx) + noiseHash(x0 + 1, y0) * tx;
    const bottom = noiseHash(x0, y0 + 1) * (1 - tx) + noiseHash(x0 + 1, y0 + 1) * tx;
    return top * (1 - ty) + bottom * ty;
  };
  const fractalNoise = (x: number, y: number) => {
    let amplitude = 0.55;
    let frequency = 1;
    let total = 0;
    let normalization = 0;
    for (let octave = 0; octave < 5; octave += 1) {
      total += valueNoise(x * frequency, y * frequency) * amplitude;
      normalization += amplitude;
      amplitude *= 0.52;
      frequency *= 2.03;
    }
    return total / normalization;
  };

  const base = context.createLinearGradient(0, 0, width, height);
  base.addColorStop(0, "#010416");
  base.addColorStop(0.34, "#020824");
  base.addColorStop(0.68, "#050526");
  base.addColorStop(1, "#01020d");
  context.fillStyle = base;
  context.fillRect(0, 0, width, height);

  const paintGlow = (
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    core: string,
    fringe: string,
    opacity: number,
  ) => {
    context.save();
    context.translate(x, y);
    context.scale(radiusX, radiusY);
    context.globalCompositeOperation = "screen";
    context.globalAlpha = opacity;
    const glow = context.createRadialGradient(0, 0, 0, 0, 0, 1);
    glow.addColorStop(0, core);
    glow.addColorStop(0.32, fringe);
    glow.addColorStop(1, "rgba(0,0,0,0)");
    context.fillStyle = glow;
    context.fillRect(-1, -1, 2, 2);
    context.restore();
  };

  paintGlow(width * 0.02, height * 0.72, width * 0.52, height * 0.56, "rgba(30,107,255,.74)", "rgba(13,34,129,.3)", 0.82);
  paintGlow(width * 0.98, height * 0.27, width * 0.5, height * 0.48, "rgba(54,105,255,.68)", "rgba(43,31,145,.28)", 0.78);
  paintGlow(width * 0.88, height * 0.58, width * 0.34, height * 0.32, "rgba(242,56,221,.58)", "rgba(98,32,159,.22)", 0.64);
  paintGlow(width * 0.34, height * 0.03, width * 0.5, height * 0.3, "rgba(40,123,255,.58)", "rgba(29,44,145,.22)", 0.72);

  // A low-resolution fractal cloud layer produces fine structure without storing
  // a large image asset or adding work to the animation loop.
  const cloudCanvas = document.createElement("canvas");
  cloudCanvas.width = Math.max(260, Math.min(480, Math.round(width * 0.3)));
  cloudCanvas.height = Math.max(150, Math.min(300, Math.round(height * 0.3)));
  const cloudContext = cloudCanvas.getContext("2d")!;
  const cloudImage = cloudContext.createImageData(cloudCanvas.width, cloudCanvas.height);
  for (let y = 0; y < cloudCanvas.height; y += 1) {
    for (let x = 0; x < cloudCanvas.width; x += 1) {
      const u = x / Math.max(cloudCanvas.width - 1, 1);
      const v = y / Math.max(cloudCanvas.height - 1, 1);
      const coarse = fractalNoise(u * 4.3 + 11.2, v * 4.3 + 3.7);
      const detail = fractalNoise(u * 10.7 + 31.6, v * 10.7 + 17.4);
      const ridges = Math.pow(1 - Math.abs(detail * 2 - 1), 3.1);
      const sweepCenter = 0.91 - u * 0.66 + Math.sin(u * 12.4) * 0.045;
      const sweep = Math.exp(-Math.pow((v - sweepCenter) / 0.18, 2));
      const upperVeil = Math.exp(-Math.pow((v - (0.06 + u * 0.13)) / 0.21, 2)) * (1 - u * 0.32);
      const rightCloud = Math.exp(-Math.pow((u - 0.88) / 0.2, 2) - Math.pow((v - 0.56) / 0.3, 2));
      const leftCloud = Math.exp(-Math.pow((u - 0.08) / 0.24, 2) - Math.pow((v - 0.48) / 0.38, 2));
      const field = clamp(sweep * 0.94 + upperVeil * 0.52 + rightCloud * 0.76 + leftCloud * 0.58);
      const cloud = clamp((coarse - 0.3) * 1.9) * field;
      const filament = clamp((ridges - 0.43) * 2.5) * field * (0.35 + cloud * 0.75);
      const density = clamp(cloud * 0.68 + filament * 0.62);
      const magenta = clamp(rightCloud * 0.86 + sweep * (0.28 + 0.28 * Math.sin(u * 13.5 + v * 4.2)));
      const offset = (y * cloudCanvas.width + x) * 4;
      cloudImage.data[offset] = Math.round(21 + density * 62 + magenta * 71);
      cloudImage.data[offset + 1] = Math.round(48 + density * 63 + (1 - magenta) * 24);
      cloudImage.data[offset + 2] = Math.round(132 + density * 108 + magenta * 39);
      cloudImage.data[offset + 3] = Math.round(density * 194);
    }
  }
  cloudContext.putImageData(cloudImage, 0, 0);
  context.save();
  context.globalCompositeOperation = "screen";
  context.globalAlpha = 0.58;
  context.filter = `blur(${Math.max(7, Math.round(width / 190))}px)`;
  context.drawImage(cloudCanvas, -width * 0.015, -height * 0.015, width * 1.03, height * 1.03);
  context.globalAlpha = 0.92;
  context.filter = "none";
  context.drawImage(cloudCanvas, 0, 0, width, height);
  context.restore();

  const paintWisp = (
    points: [[number, number], [number, number], [number, number], [number, number]],
    color: string,
    thickness: number,
    opacity: number,
  ) => {
    context.save();
    context.globalCompositeOperation = "screen";
    context.lineCap = "round";
    for (let layer = 5; layer >= 1; layer -= 1) {
      const offset = (random() - 0.5) * thickness * 1.9;
      context.beginPath();
      context.moveTo(points[0][0], points[0][1] + offset);
      context.bezierCurveTo(
        points[1][0], points[1][1] + offset,
        points[2][0], points[2][1] - offset * 0.4,
        points[3][0], points[3][1] - offset * 0.2,
      );
      context.strokeStyle = color;
      context.globalAlpha = opacity / (5.2 + layer * 1.4);
      context.lineWidth = thickness * (1.8 + layer * 2.15);
      context.shadowColor = color;
      context.shadowBlur = thickness * (2.2 + layer * 2.35);
      context.stroke();
    }
    context.restore();
  };

  paintWisp(
    [[-width * 0.08, height * 0.86], [width * 0.16, height * 0.62], [width * 0.27, height * 0.98], [width * 0.5, height * 0.77]],
    "rgba(73,153,255,.9)",
    Math.max(1.6, width * 0.0017),
    0.46,
  );
  paintWisp(
    [[width * 0.63, height * 0.88], [width * 0.74, height * 0.62], [width * 0.78, height * 0.36], [width * 1.08, height * 0.43]],
    "rgba(242,72,225,.86)",
    Math.max(1.5, width * 0.00155),
    0.4,
  );
  paintWisp(
    [[width * 0.15, -height * 0.07], [width * 0.27, height * 0.18], [width * 0.48, -height * 0.04], [width * 0.64, height * 0.17]],
    "rgba(64,135,255,.72)",
    Math.max(1.35, width * 0.0013),
    0.32,
  );

  const paintGalaxy = (
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    hue: "blue" | "violet",
    seed: number,
  ) => {
    const galaxyRandom = seededRandom(seed);
    const cool = hue === "blue";
    context.save();
    context.translate(x, y);
    context.rotate(rotation);
    context.scale(radiusX, radiusY);
    context.globalCompositeOperation = "screen";

    const halo = context.createRadialGradient(0, 0, 0, 0, 0, 1);
    halo.addColorStop(0, cool ? "rgba(255,246,226,.98)" : "rgba(255,231,248,.96)");
    halo.addColorStop(0.06, cool ? "rgba(205,229,255,.9)" : "rgba(255,184,244,.82)");
    halo.addColorStop(0.2, cool ? "rgba(80,158,255,.52)" : "rgba(210,96,255,.52)");
    halo.addColorStop(0.55, cool ? "rgba(33,78,212,.2)" : "rgba(111,49,201,.2)");
    halo.addColorStop(1, "rgba(0,0,0,0)");
    context.fillStyle = halo;
    context.fillRect(-1, -1, 2, 2);
    context.restore();

    context.save();
    context.globalCompositeOperation = "screen";
    const cosine = Math.cos(rotation);
    const sine = Math.sin(rotation);
    const particleCount = Math.round(620 + (radiusX / width) * 1900);
    for (let index = 0; index < particleCount; index += 1) {
      const progress = Math.pow(galaxyRandom(), 0.72);
      const arm = index % 4;
      const angle = arm * Math.PI * 0.5
        + progress * Math.PI * 3.9
        + (galaxyRandom() - galaxyRandom()) * (0.12 + progress * 0.28);
      const radius = 0.035 + progress * 0.91;
      const spread = (galaxyRandom() - galaxyRandom()) * (0.028 + progress * 0.055);
      const localX = Math.cos(angle) * radius * radiusX;
      const localY = (Math.sin(angle) * radius + spread) * radiusY;
      const px = x + localX * cosine - localY * sine;
      const py = y + localX * sine + localY * cosine;
      const alpha = (0.1 + galaxyRandom() * 0.48) * (1 - progress * 0.52);
      const particleRadius = Math.max(0.26, (0.28 + galaxyRandom() * 0.9) * width / 1600);
      context.fillStyle = cool
        ? `rgba(${150 + Math.round(galaxyRandom() * 85)},${190 + Math.round(galaxyRandom() * 60)},255,${alpha})`
        : `rgba(255,${145 + Math.round(galaxyRandom() * 85)},${224 + Math.round(galaxyRandom() * 31)},${alpha})`;
      context.beginPath();
      context.arc(px, py, particleRadius, 0, Math.PI * 2);
      context.fill();
    }

    const core = context.createRadialGradient(x, y, 0, x, y, Math.max(2, radiusY * 0.34));
    core.addColorStop(0, "rgba(255,252,238,.98)");
    core.addColorStop(0.1, cool ? "rgba(211,229,255,.9)" : "rgba(255,198,243,.9)");
    core.addColorStop(0.38, cool ? "rgba(82,153,255,.38)" : "rgba(220,89,255,.38)");
    core.addColorStop(1, "rgba(0,0,0,0)");
    context.fillStyle = core;
    context.fillRect(x - radiusY, y - radiusY, radiusY * 2, radiusY * 2);
    context.restore();
  };

  paintGalaxy(width * 0.91, height * 0.28, width * 0.13, height * 0.073, -0.48, "blue", 0x41a7b3);
  paintGalaxy(width * 0.12, height * 0.82, width * 0.115, height * 0.067, 0.31, "violet", 0x93f14d);

  context.globalCompositeOperation = "screen";
  const starCount = Math.round(920 + Math.sqrt(width * height) * 0.72);
  for (let index = 0; index < starCount; index += 1) {
    const x = random() * width;
    const y = random() * height;
    const bright = random() > 0.973;
    const radius = bright ? 0.8 + random() * 1.75 : 0.2 + Math.pow(random(), 4) * 0.78;
    const alpha = bright ? 0.66 + random() * 0.3 : 0.14 + random() * 0.55;
    const temperature = random();
    context.fillStyle = temperature > 0.25
      ? `rgba(177,215,255,${alpha})`
      : temperature > 0.08
        ? `rgba(239,244,255,${alpha})`
        : `rgba(255,190,238,${alpha * 0.82})`;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
    if (!bright) continue;
    const halo = context.createRadialGradient(x, y, 0, x, y, radius * 7.5);
    halo.addColorStop(0, `rgba(214,234,255,${alpha * 0.42})`);
    halo.addColorStop(1, "rgba(120,165,255,0)");
    context.fillStyle = halo;
    context.fillRect(x - radius * 8, y - radius * 8, radius * 16, radius * 16);
    context.strokeStyle = `rgba(194,222,255,${alpha * 0.44})`;
    context.lineWidth = Math.max(0.45, width / 2600);
    context.beginPath();
    context.moveTo(x - radius * 6.8, y);
    context.lineTo(x + radius * 6.8, y);
    context.moveTo(x, y - radius * 6.8);
    context.lineTo(x, y + radius * 6.8);
    context.stroke();
  }

  // Dense dust-lane stars make the blue/magenta sweep read as a real Milky Way band.
  for (let index = 0; index < 720; index += 1) {
    const progress = random();
    const x = progress * width;
    const centerY = height * (0.91 - progress * 0.66 + Math.sin(progress * 12.4) * 0.045);
    const y = centerY + (random() - random()) * height * 0.17;
    const alpha = 0.13 + random() * 0.47;
    const radius = 0.18 + Math.pow(random(), 3.4) * 0.72;
    context.fillStyle = random() > 0.18
      ? `rgba(173,215,255,${alpha})`
      : `rgba(255,169,240,${alpha * 0.82})`;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }

  const vignette = context.createRadialGradient(width * 0.5, height * 0.48, height * 0.08, width * 0.5, height * 0.48, Math.max(width, height) * 0.72);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(0.66, "rgba(0,0,8,.04)");
  vignette.addColorStop(1, "rgba(0,0,8,.42)");
  context.globalCompositeOperation = "source-over";
  context.fillStyle = vignette;
  context.fillRect(0, 0, width, height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.name = "CosmoGraph cosmic background";
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
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

function displayGroupName(value: string) {
  const leaf = value.split("/").at(-1) ?? value;
  return leaf.replace(/^\d+[.]?\s*/, "") || "Заметки";
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
  private readonly animatedMaterials: THREE.ShaderMaterial[] = [];
  private readonly styledPointClouds: StyledPointCloud[] = [];
  private readonly styledLineMaterials: StyledLineMaterial[] = [];
  private terrainSurface!: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  private calmSurfaceMaterial!: THREE.MeshStandardMaterial;
  private radiantSurfaceMaterial!: THREE.ShaderMaterial;
  private atmosphere!: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  private calmAtmosphereMaterial!: THREE.ShaderMaterial;
  private radiantAtmosphereMaterial!: THREE.ShaderMaterial;
  private outerAura!: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private outerAuraMaterial!: THREE.ShaderMaterial;
  private orbitingMotes!: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private orbitingMoteCalmColors!: THREE.BufferAttribute;
  private orbitingMoteRadiantColors!: THREE.BufferAttribute;
  private sphereStyle: SphereStyle = "radiant";
  private labelMode: LabelMode = "important";
  private readonly nodeVisuals: NodeVisual[] = [];
  private batchedNodeCloud: BatchedNodeCloud | null = null;
  private readonly batchedLabels = new Map<string, BatchedLabel>();
  private readonly virtualLabelIds = new Set<string>();
  private performanceProfile: PerformanceProfile = performanceProfileFor(0);
  private readonly hitMeshes: THREE.Mesh[] = [];
  private readonly degrees = new Map<string, number>();
  private readonly nodesById = new Map<string, GraphNode>();
  private currentData: GraphData = { nodes: [], edges: [] };
  private noteAdjacency: NoteAdjacency = new Map();
  private readonly nodePositions = new Map<string, THREE.Vector3>();
  private readonly radiantColorsByGroup = new Map<string, number>();
  private readonly calmColorsByGroup = new Map<string, number>();
  private focusLineRoot = new THREE.Group();
  private graphLineMaterial: THREE.LineBasicMaterial | null = null;
  private focusedId: string | null = null;
  private focusDepth: FocusDepth = 1;
  private focusNodeDistances = new Map<string, number>();
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
  private cameraTweening = false;
  private cameraTweenStart = 12;
  private cameraTweenEnd = 12;
  private cameraTweenElapsed = 0;
  private cameraTweenDuration = 0.8;
  private defaultCameraZ = 12;
  private animationFrame = 0;
  private frameAccumulator = 0;
  private labelRefreshAccumulator = 0;
  private cosmicBackgroundEnabled = false;
  private cosmicBackgroundTexture: THREE.CanvasTexture | null = null;
  private cosmicBackgroundAspect = 0;
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
    this.renderer.toneMappingExposure = 0.96;
    this.renderer.setClearColor(0x02020b, 1);
    this.camera.position.set(0, 0, 12);
    this.raycaster.params.Points = { threshold: 0.14 };

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.82, 0.5, 0.62);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    this.labelRenderer.domElement.className = "graph-label-layer";
    (canvas.parentElement ?? document.body).appendChild(this.labelRenderer.domElement);

    this.scene.add(this.createStarfield());
    this.scene.add(new THREE.HemisphereLight(0x8abaff, 0x060214, 0.34));
    const terrainLight = new THREE.DirectionalLight(0xdbe8ff, 2.9);
    terrainLight.position.set(-4.5, 6.5, 8);
    this.scene.add(terrainLight);
    this.scene.add(this.root);
    this.terrainSurface = this.createTerrainSurface();
    this.atmosphere = this.createAtmosphere();
    this.outerAura = this.createOuterAura();
    this.root.add(this.outerAura);
    this.root.add(this.terrainSurface);
    this.root.add(this.atmosphere);
    this.root.add(this.createShellDust());
    this.root.add(this.createTerrainAccents());
    this.root.add(this.createSparkleShell());
    this.root.add(this.createInnerDust());
    this.orbitingMotes = this.createOrbitingMotes();
    this.root.add(this.orbitingMotes);
    this.root.add(this.networkRoot);
    this.root.rotation.set(-0.035, -0.12, 0.015);
    this.setSphereStyle("radiant");

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

  setLabelMode(mode: LabelMode) {
    this.labelMode = mode;
    const hidden = mode === "none" && !this.focusedId;
    this.labelRenderer.domElement.classList.toggle("is-hidden", hidden);
    this.labelRenderer.domElement.setAttribute("aria-hidden", String(hidden));
    if (mode === "all") this.refreshVisibleBatchedLabels();
    else {
      this.virtualLabelIds.clear();
      this.syncTransientBatchedLabels();
    }
  }

  getPrimaryNode() {
    return this.primaryNode;
  }

  getPerformanceTier(): PerformanceTier {
    return this.performanceProfile.tier;
  }

  setCosmicBackground(enabled: boolean) {
    this.cosmicBackgroundEnabled = enabled;
    if (!enabled) {
      this.scene.background = null;
      return;
    }
    this.refreshCosmicBackground();
  }

  setSphereStyle(style: SphereStyle) {
    this.sphereStyle = style;
    const radiant = style === "radiant";
    this.terrainSurface.material = radiant ? this.radiantSurfaceMaterial : this.calmSurfaceMaterial;
    this.atmosphere.material = radiant ? this.radiantAtmosphereMaterial : this.calmAtmosphereMaterial;
    this.renderer.toneMappingExposure = radiant ? 0.98 : 0.97;
    const bloomScale = this.performanceProfile.tier === "massive" ? 0.7 : this.performanceProfile.tier === "balanced" ? 0.88 : 1;
    this.bloomPass.strength = (radiant ? 0.92 : 0.86) * bloomScale;
    this.bloomPass.radius = radiant ? 0.55 : 0.46;
    this.bloomPass.threshold = radiant ? 0.56 : 0.5;
    if (this.outerAuraMaterial) this.outerAuraMaterial.uniforms.uIntensity.value = radiant ? 0.68 : 0.12;
    this.styledPointClouds.forEach((entry) => {
      entry.points.geometry.setAttribute("color", radiant ? entry.radiantColors : entry.calmColors);
      entry.points.material.opacity = radiant ? entry.radiantOpacity : entry.calmOpacity;
      entry.points.material.size = radiant ? entry.radiantSize : entry.calmSize;
      entry.points.material.needsUpdate = true;
    });
    if (this.orbitingMotes) {
      this.orbitingMotes.geometry.setAttribute("color", radiant ? this.orbitingMoteRadiantColors : this.orbitingMoteCalmColors);
      this.orbitingMotes.material.uniforms.uOpacity.value = radiant ? 0.88 : 0.62;
      this.orbitingMotes.material.uniforms.uPointSize.value = radiant ? 0.031 : 0.024;
      this.orbitingMotes.material.uniforms.uMotionScale.value = radiant ? 1 : 0.64;
    }
    if (this.batchedNodeCloud) {
      this.batchedNodeCloud.points.geometry.setAttribute(
        "color",
        radiant ? this.batchedNodeCloud.radiantColors : this.batchedNodeCloud.calmColors,
      );
      this.batchedNodeCloud.points.material.uniforms.uEnergy.value = radiant ? 1 : 0.78;
    }
    this.applyNodePalette();
    if (this.focusedId) {
      const focusedNode = this.nodesById.get(this.focusedId);
      if (focusedNode) this.updateFocusLines(focusedNode);
    }
  }

  private applyNodePalette() {
    const radiant = this.sphereStyle === "radiant";
    this.nodeVisuals.forEach((visual) => {
      const color = radiant ? visual.radiantColor : visual.calmColor;
      visual.core.material.color.copy(color);
      visual.inner.material.color.copy(color).lerp(NODE_HIGHLIGHT_COLOR, visual.node.kind === "cluster" ? 0.76 : 0.64);
      visual.marker.material.color.copy(color);
      visual.glow.material.color.copy(color);
    });
    this.styledLineMaterials.forEach((entry) => {
      entry.material.color.copy(radiant ? entry.radiantColor : entry.calmColor);
    });
  }

  setData(data: GraphData) {
    this.performanceProfile = performanceProfileFor(data.nodes.length);
    const pixelRatio = Math.min(window.devicePixelRatio, this.performanceProfile.maxPixelRatio);
    this.renderer.setPixelRatio(pixelRatio);
    this.composer.setPixelRatio(pixelRatio);
    this.currentData = data;
    this.noteAdjacency = buildNoteAdjacency(data);
    this.selectedId = null;
    this.hoveredId = null;
    this.primaryNode = null;
    this.focusedId = null;
    this.focusNodeDistances.clear();
    this.focusing = false;
    this.cameraTweening = false;
    this.camera.position.z = this.defaultCameraZ;
    this.degrees.clear();
    this.nodesById.clear();
    this.nodePositions.clear();
    this.radiantColorsByGroup.clear();
    this.calmColorsByGroup.clear();
    this.batchedNodeCloud = null;
    this.batchedLabels.clear();
    this.virtualLabelIds.clear();
    data.nodes.forEach((node) => {
      this.degrees.set(node.id, 0);
      this.nodesById.set(node.id, node);
    });
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
    const radiantColorByGroup = new Map<string, number>();
    const calmColorByGroup = new Map<string, number>();
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
      this.nodesById.set(cluster.id, cluster);
      const radiantColor = groupIndex === 0
        ? RADIANT_PRIMARY_COLOR
        : RADIANT_NOTE_COLORS[(groupIndex - 1) % RADIANT_NOTE_COLORS.length];
      const calmColor = groupIndex === 0
        ? CALM_PRIMARY_COLOR
        : CALM_NOTE_COLORS[(groupIndex - 1) % CALM_NOTE_COLORS.length];
      radiantColorByGroup.set(groupName, radiantColor);
      calmColorByGroup.set(groupName, calmColor);
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

    positions.forEach((position, id) => this.nodePositions.set(id, position.clone()));
    radiantColorByGroup.forEach((color, group) => this.radiantColorsByGroup.set(group, color));
    calmColorByGroup.forEach((color, group) => this.calmColorsByGroup.set(group, color));

    this.networkRoot.add(this.createAmbientNetwork());
    const graphLines = this.createGraphLines(data, orderedGroups, clusterNodes, positions, radiantColorByGroup);
    this.graphLineMaterial = graphLines.material;
    this.networkRoot.add(graphLines);
    this.focusLineRoot = new THREE.Group();
    this.focusLineRoot.renderOrder = 4;
    this.networkRoot.add(this.focusLineRoot);

    const rankedNotes = [...data.nodes]
      .sort((a, b) => (this.degrees.get(b.id) ?? 0) - (this.degrees.get(a.id) ?? 0));
    const importantLabelCount = Math.min(15, Math.max(8, Math.round(Math.sqrt(data.nodes.length) * 2.8)));
    const importantLabelIds = new Set(rankedNotes.slice(0, importantLabelCount).map((node) => node.id));

    clusterNodes.forEach((cluster, index) => {
      const visual = this.createNodeVisual(
        cluster,
        positions.get(cluster.id)!,
        radiantColorByGroup.get(cluster.group)!,
        calmColorByGroup.get(cluster.group)!,
        true,
        true,
      );
      this.nodeVisuals.push(visual);
      this.networkRoot.add(visual.group);
      if (index === 0) {
        this.networkRoot.add(this.createHubRings(
          positions.get(cluster.id)!,
          radiantColorByGroup.get(cluster.group)!,
          calmColorByGroup.get(cluster.group)!,
        ));
      }
    });

    if (this.performanceProfile.batchedNotes) {
      this.batchedNodeCloud = this.createBatchedNodeCloud(
        data.nodes,
        positions,
        radiantColorByGroup,
        calmColorByGroup,
        rankedNotes,
        importantLabelIds,
      );
      this.networkRoot.add(this.batchedNodeCloud.points);
    } else {
      data.nodes.forEach((node) => {
        const visual = this.createNodeVisual(
          node,
          positions.get(node.id)!,
          radiantColorByGroup.get(node.group)!,
          calmColorByGroup.get(node.group)!,
          false,
          importantLabelIds.has(node.id),
        );
        this.nodeVisuals.push(visual);
        this.networkRoot.add(visual.group);
      });
    }

    this.setSphereStyle(this.sphereStyle);
    if (this.labelMode === "all") this.refreshVisibleBatchedLabels();
    this.applyVisualState();
    this.resize();
  }

  setSearch(value: string) {
    this.search = value.trim().toLocaleLowerCase();
    if (this.labelMode === "all") this.refreshVisibleBatchedLabels();
    this.applyVisualState();
  }

  setFocus(id: string, depth: number = this.focusDepth) {
    const focusedNode = this.nodesById.get(id);
    if (!focusedNode) return 0;
    this.focusDepth = normalizeFocusDepth(depth);
    this.focusedId = id;
    this.virtualLabelIds.clear();
    this.labelRenderer.domElement.classList.remove("is-hidden");
    this.labelRenderer.domElement.setAttribute("aria-hidden", "false");
    this.focusNodeDistances = focusDistances(this.currentData, focusedNode, this.focusDepth, this.noteAdjacency);
    this.focusNode(id);
    this.startCameraTween(this.canvas.clientWidth < 720 ? 18.8 : 10.45, 0.9);
    this.updateFocusLines(focusedNode);
    this.applyVisualState();
    return focusedNoteCount(this.currentData, this.focusNodeDistances);
  }

  setFocusDepth(depth: number) {
    if (!this.focusedId) return 0;
    return this.setFocus(this.focusedId, depth);
  }

  clearFocus(clearSelection = false) {
    this.focusedId = null;
    this.focusNodeDistances.clear();
    if (clearSelection) this.selectedId = null;
    this.clearFocusLines();
    if (this.graphLineMaterial) this.graphLineMaterial.opacity = 0.25;
    const labelsHidden = this.labelMode === "none";
    this.labelRenderer.domElement.classList.toggle("is-hidden", labelsHidden);
    this.labelRenderer.domElement.setAttribute("aria-hidden", String(labelsHidden));
    this.startCameraTween(this.defaultCameraZ, 0.76);
    if (this.labelMode === "all") this.refreshVisibleBatchedLabels();
    this.applyVisualState();
  }

  focusNode(id: string) {
    const position = this.nodePositions.get(id);
    if (!position) return;
    this.selectedId = id;
    this.autoRotate = false;
    this.velocityX = 0;
    this.velocityY = 0;
    const localDirection = position.clone().normalize();
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

  private startCameraTween(target: number, duration: number) {
    this.cameraTweenStart = this.camera.position.z;
    this.cameraTweenEnd = target;
    this.cameraTweenElapsed = 0;
    this.cameraTweenDuration = duration;
    this.cameraTweening = !this.reducedMotion && Math.abs(this.cameraTweenStart - target) > 0.01;
    if (!this.cameraTweening) this.camera.position.z = target;
  }

  private clearFocusLines() {
    this.focusLineRoot.traverse((object) => {
      if (object === this.focusLineRoot) return;
      const line = object as THREE.LineSegments;
      line.geometry?.dispose();
      if (Array.isArray(line.material)) line.material.forEach((material) => material.dispose());
      else line.material?.dispose();
    });
    this.focusLineRoot.clear();
  }

  private updateFocusLines(focusedNode: GraphNode) {
    this.clearFocusLines();
    if (this.graphLineMaterial) this.graphLineMaterial.opacity = 0.055;

    const linePositions: number[] = [];
    const lineColors: number[] = [];
    const addLine = (sourceId: string, targetId: string) => {
      const source = this.nodePositions.get(sourceId);
      const target = this.nodePositions.get(targetId);
      const sourceNode = this.nodesById.get(sourceId);
      const targetNode = this.nodesById.get(targetId);
      if (!source || !target || !sourceNode || !targetNode) return;
      const sourceDistance = this.focusNodeDistances.get(sourceId) ?? this.focusDepth;
      const targetDistance = this.focusNodeDistances.get(targetId) ?? this.focusDepth;
      const energy = 1 - Math.max(sourceDistance, targetDistance) * 0.16;
      const colors = this.sphereStyle === "radiant" ? this.radiantColorsByGroup : this.calmColorsByGroup;
      const fallback = this.sphereStyle === "radiant" ? RADIANT_PRIMARY_COLOR : CALM_PRIMARY_COLOR;
      const sourceColor = new THREE.Color(colors.get(sourceNode.group) ?? fallback)
        .lerp(NODE_HIGHLIGHT_COLOR, 0.28)
        .multiplyScalar(energy);
      const targetColor = new THREE.Color(colors.get(targetNode.group) ?? fallback)
        .lerp(NODE_HIGHLIGHT_COLOR, 0.28)
        .multiplyScalar(energy);
      linePositions.push(source.x, source.y, source.z, target.x, target.y, target.z);
      lineColors.push(sourceColor.r, sourceColor.g, sourceColor.b, targetColor.r, targetColor.g, targetColor.b);
    };

    const visitedEdges = new Set<string>();
    for (const sourceId of this.focusNodeDistances.keys()) {
      this.noteAdjacency.get(sourceId)?.forEach((targetId) => {
        if (!this.focusNodeDistances.has(targetId)) return;
        const edgeKey = sourceId < targetId ? `${sourceId}\u0000${targetId}` : `${targetId}\u0000${sourceId}`;
        if (visitedEdges.has(edgeKey)) return;
        visitedEdges.add(edgeKey);
        addLine(sourceId, targetId);
      });
    }

    if (focusedNode.kind === "cluster") {
      this.currentData.nodes
        .filter((node) => node.group === focusedNode.group && this.focusNodeDistances.get(node.id) === 1)
        .forEach((node) => addLine(focusedNode.id, node.id));
    } else {
      const clusterId = `@cluster/${focusedNode.group}`;
      if (this.focusNodeDistances.has(clusterId)) addLine(focusedNode.id, clusterId);
    }

    if (linePositions.length === 0) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(lineColors, 3));
    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: this.sphereStyle === "radiant" ? 0.82 : 0.68,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.focusLineRoot.add(new THREE.LineSegments(geometry, material));
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
      alphaTest: 0.01,
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
    const elevations = new Float32Array(positions.count);
    const ridges = new Float32Array(positions.count);
    const directions = new Float32Array(positions.count * 3);
    const calmColors = new Float32Array(positions.count * 3);
    const direction = new THREE.Vector3();
    for (let index = 0; index < positions.count; index += 1) {
      direction.fromBufferAttribute(positions, index).normalize();
      const profile = terrainProfile(direction);
      elevations[index] = THREE.MathUtils.clamp((profile.displacement + 0.29) / 0.65, 0, 1);
      ridges[index] = profile.ridge;
      directions.set([direction.x, direction.y, direction.z], index * 3);
      calmColors[index * 3] = 0.055 + elevations[index] * 0.07 + profile.ridge * 0.12;
      calmColors[index * 3 + 1] = 0.08 + elevations[index] * 0.1 + profile.ridge * 0.14;
      calmColors[index * 3 + 2] = 0.16 + elevations[index] * 0.18 + profile.ridge * 0.22;
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(calmColors, 3));
    geometry.setAttribute("aElevation", new THREE.BufferAttribute(elevations, 1));
    geometry.setAttribute("aRidge", new THREE.BufferAttribute(ridges, 1));
    geometry.setAttribute("aDirection", new THREE.BufferAttribute(directions, 3));

    this.calmSurfaceMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.66,
      roughness: 0.94,
      metalness: 0.06,
      emissive: 0x030713,
      emissiveIntensity: 0.28,
      depthWrite: false,
      side: THREE.FrontSide,
    });

    this.radiantSurfaceMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
      uniforms: {
        uTime: { value: 0 },
        uDeepIndigo: { value: new THREE.Color(0x08062d) },
        uElectricBlue: { value: new THREE.Color(0x286dff) },
        uCyan: { value: new THREE.Color(0x55ddff) },
        uViolet: { value: new THREE.Color(0x8b50ff) },
        uMagenta: { value: new THREE.Color(0xff52d2) },
        uHot: { value: new THREE.Color(0xf2f7ff) },
      },
      vertexShader: `
        attribute float aElevation;
        attribute float aRidge;
        attribute vec3 aDirection;
        varying float vElevation;
        varying float vRidge;
        varying vec3 vDirection;
        varying vec3 vWorldNormal;
        varying vec3 vWorldPosition;
        void main() {
          vElevation = aElevation;
          vRidge = aRidge;
          vDirection = aDirection;
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uDeepIndigo;
        uniform vec3 uElectricBlue;
        uniform vec3 uCyan;
        uniform vec3 uViolet;
        uniform vec3 uMagenta;
        uniform vec3 uHot;
        varying float vElevation;
        varying float vRidge;
        varying vec3 vDirection;
        varying vec3 vWorldNormal;
        varying vec3 vWorldPosition;

        float hash31(vec3 p) {
          p = fract(p * 0.1031);
          p += dot(p, p.yzx + 33.33);
          return fract((p.x + p.y) * p.z);
        }

        float noise3(vec3 p) {
          vec3 i = floor(p);
          vec3 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(mix(hash31(i), hash31(i + vec3(1, 0, 0)), f.x),
                mix(hash31(i + vec3(0, 1, 0)), hash31(i + vec3(1, 1, 0)), f.x), f.y),
            mix(mix(hash31(i + vec3(0, 0, 1)), hash31(i + vec3(1, 0, 1)), f.x),
                mix(hash31(i + vec3(0, 1, 1)), hash31(i + vec3(1, 1, 1)), f.x), f.y),
            f.z
          );
        }

        float fbm(vec3 p) {
          float value = 0.0;
          float amplitude = 0.54;
          for (int i = 0; i < 5; i++) {
            value += noise3(p) * amplitude;
            p = p * 2.03 + vec3(1.7, -2.3, 0.9);
            amplitude *= 0.48;
          }
          return value;
        }

        void main() {
          vec3 direction = normalize(vDirection);
          float flowTime = uTime * 0.035;
          float broad = fbm(direction * 1.75 + vec3(flowTime, -flowTime * 0.7, flowTime * 0.45));
          float fold = fbm(direction * 3.6 + vec3(broad * 2.25, -broad * 1.4, broad * 1.8));
          float fine = fbm(direction * 7.8 + vec3(fold * 1.65));

          float contourPhase = broad * 3.65 + fold * 1.32 + direction.y * 0.29 + direction.x * 0.14;
          float contour = 1.0 - abs(fract(contourPhase) - 0.5) * 2.0;
          float ribbons = smoothstep(0.42, 0.88, contour) * smoothstep(0.3, 0.76, fold);
          float ribbonCore = pow(smoothstep(0.78, 0.995, contour), 1.9) * smoothstep(0.42, 0.86, fold);
          float vein = smoothstep(0.67, 0.94, fine + contour * 0.19);
          float filament = smoothstep(0.73, 0.97, fine + ribbonCore * 0.24) * smoothstep(0.45, 0.84, fold);
          float reliefGlow = smoothstep(0.16, 0.7, vRidge + ribbons * 0.48);

          vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
          vec3 normalDirection = normalize(vWorldNormal);
          vec3 lightDirection = normalize(vec3(-0.36, 0.68, 0.94));
          float facing = max(dot(normalDirection, viewDirection), 0.0);
          float fresnel = pow(1.0 - facing, 1.9);
          float hardRim = pow(1.0 - facing, 5.4);
          float lightFacing = max(dot(normalDirection, lightDirection), 0.0);
          float light = 0.22 + lightFacing * 0.78;
          vec3 halfVector = normalize(viewDirection + lightDirection);
          float broadSheen = pow(max(dot(normalDirection, halfVector), 0.0), 4.5);
          float sharpSheen = pow(max(dot(normalDirection, halfVector), 0.0), 22.0);

          float chroma = clamp(fbm(direction * 2.55 + vec3(-1.2, 2.4, 0.6)) * 1.25 - 0.12, 0.0, 1.0);
          vec3 coolFlow = mix(uElectricBlue, uCyan, smoothstep(0.2, 0.78, chroma));
          vec3 warmFlow = mix(uViolet, uMagenta, smoothstep(0.34, 0.76, fold));
          vec3 ribbonColor = mix(coolFlow, warmFlow, smoothstep(0.3, 0.7, broad + direction.x * 0.13));
          vec3 rimColor = mix(uCyan, uMagenta, smoothstep(-0.55, 0.68, direction.y + broad * 0.5));

          vec3 color = uDeepIndigo * (0.46 + light * 0.58);
          color += mix(uElectricBlue, uViolet, chroma) * (0.075 + vElevation * 0.16 + broad * 0.1);
          color += ribbonColor * ribbons * (0.44 + reliefGlow * 0.42);
          color += mix(uCyan, uMagenta, broad) * vein * (0.12 + vRidge * 0.32);
          color += mix(uHot, ribbonColor, 0.7) * ribbonCore * (0.2 + reliefGlow * 0.38);
          color += mix(uCyan, uMagenta, fold) * filament * (0.12 + ribbonCore * 0.24);
          color += rimColor * (fresnel * (0.27 + ribbons * 0.28) + hardRim * 0.58);
          color += mix(uHot, uCyan, 0.46) * broadSheen * (0.045 + ribbons * 0.11);
          color += uHot * sharpSheen * (0.12 + ribbonCore * 0.34);

          float hotCore = pow(clamp(ribbonCore * 0.68 + filament * 0.16 + vRidge * 0.32, 0.0, 1.0), 7.1);
          color = mix(color, uHot * 0.86 + ribbonColor * 0.78, hotCore * 0.24);
          float alpha = 0.76 + vElevation * 0.05 + ribbons * 0.06 + fresnel * 0.105;
          color = clamp(color, vec3(0.0), vec3(1.65));
          gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));
        }
      `,
    });
    this.animatedMaterials.push(this.radiantSurfaceMaterial);
    const surface = new THREE.Mesh(geometry, this.radiantSurfaceMaterial);
    surface.renderOrder = -2;
    return surface;
  }

  private createAtmosphere() {
    const geometry = this.createTerrainGeometry(96, 72);
    const sharedVertexShader = `
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;
      varying vec3 vDirection;
      void main() {
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vDirection = normalize(position);
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `;
    this.calmAtmosphereMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.FrontSide,
      uniforms: { glowColor: { value: new THREE.Color(0x4166a8) } },
      vertexShader: sharedVertexShader,
      fragmentShader: `
        uniform vec3 glowColor;
        varying vec3 vWorldNormal;
        varying vec3 vWorldPosition;
        void main() {
          vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
          float rim = pow(1.0 - max(dot(normalize(vWorldNormal), viewDirection), 0.0), 3.2);
          float haze = pow(1.0 - max(dot(normalize(vWorldNormal), viewDirection), 0.0), 1.4) * 0.055;
          gl_FragColor = vec4(glowColor, clamp(rim * 0.22 + haze * 0.45, 0.0, 1.0));
        }
      `,
    });
    this.radiantAtmosphereMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.FrontSide,
      uniforms: { uTime: { value: 0 } },
      vertexShader: sharedVertexShader,
      fragmentShader: `
        uniform float uTime;
        varying vec3 vWorldNormal;
        varying vec3 vWorldPosition;
        varying vec3 vDirection;
        float pattern(vec3 p) {
          return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
        }
        void main() {
          vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
          float rim = pow(1.0 - max(dot(normalize(vWorldNormal), viewDirection), 0.0), 2.55);
          float hueNoise = pattern(floor(vDirection * 7.0 + uTime * 0.025));
          vec3 cyan = vec3(0.25, 0.78, 1.0);
          vec3 violet = vec3(0.55, 0.27, 1.0);
          vec3 magenta = vec3(1.0, 0.38, 0.82);
          vec3 rimColor = mix(cyan, violet, smoothstep(0.15, 0.78, vDirection.y * 0.5 + 0.5));
          rimColor = mix(rimColor, magenta, smoothstep(0.7, 0.96, hueNoise) * 0.58);
          float edgeFlow = 0.84 + sin(dot(vDirection, vec3(8.0, 13.0, 5.0)) + uTime * 0.11) * 0.16;
          float spark = smoothstep(0.84, 0.985, hueNoise) * pow(rim, 2.4);
          float energy = (pow(rim, 1.4) * 0.62 + pow(rim, 4.8) * 0.94) * edgeFlow + spark * 0.46;
          float alpha = rim * 0.22 + pow(rim, 5.2) * 0.12 + spark * 0.045;
          gl_FragColor = vec4(clamp(rimColor * energy + vec3(0.84, 0.92, 1.0) * spark * 0.64, vec3(0.0), vec3(1.72)), clamp(alpha, 0.0, 0.42));
        }
      `,
    });
    this.animatedMaterials.push(this.radiantAtmosphereMaterial);
    const atmosphere = new THREE.Mesh(geometry, this.radiantAtmosphereMaterial);
    atmosphere.scale.setScalar(1.012);
    atmosphere.renderOrder = -1;
    return atmosphere;
  }

  private createOuterAura() {
    const geometry = this.createTerrainGeometry(96, 72);
    this.outerAuraMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 1 },
      },
      vertexShader: `
        varying vec3 vWorldNormal;
        varying vec3 vWorldPosition;
        varying vec3 vDirection;
        void main() {
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          vDirection = normalize(position);
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uIntensity;
        varying vec3 vWorldNormal;
        varying vec3 vWorldPosition;
        varying vec3 vDirection;
        void main() {
          vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
          float facing = abs(dot(normalize(vWorldNormal), viewDirection));
          float rim = clamp(1.0 - facing, 0.0, 1.0);
          float softEdge = pow(rim, 1.2);
          float hotEdge = pow(rim, 5.0);
          float flow = 0.5 + 0.5 * sin(vDirection.x * 13.0 + vDirection.y * 8.0 - vDirection.z * 11.0 + uTime * 0.075);
          vec3 cyan = vec3(0.2, 0.7, 1.0);
          vec3 violet = vec3(0.56, 0.25, 1.0);
          vec3 magenta = vec3(1.0, 0.3, 0.82);
          vec3 auraColor = mix(cyan, violet, smoothstep(-0.72, 0.5, vDirection.y));
          auraColor = mix(auraColor, magenta, smoothstep(0.58, 0.96, flow) * 0.54);
          float energy = (softEdge * 0.26 + hotEdge * 0.92) * (0.88 + flow * 0.18) * uIntensity;
          float alpha = (softEdge * 0.08 + hotEdge * 0.18) * uIntensity;
          gl_FragColor = vec4(auraColor * energy, clamp(alpha, 0.0, 0.3));
        }
      `,
    });
    this.animatedMaterials.push(this.outerAuraMaterial);
    const aura = new THREE.Mesh(geometry, this.outerAuraMaterial);
    aura.scale.setScalar(1.032);
    aura.renderOrder = -4;
    return aura;
  }

  private registerStyledPointCloud(
    points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>,
    calmColors: THREE.BufferAttribute,
    radiantColors: THREE.BufferAttribute,
    calmOpacity: number,
    radiantOpacity: number,
    calmSize: number,
    radiantSize: number,
  ) {
    this.styledPointClouds.push({
      points,
      calmColors,
      radiantColors,
      calmOpacity,
      radiantOpacity,
      calmSize,
      radiantSize,
    });
    return points;
  }

  private createShellDust() {
    const random = seededRandom(91);
    const count = window.innerWidth < 720 ? 6500 : 16800;
    const positions = new Float32Array(count * 3);
    const radiantColors = new Float32Array(count * 3);
    const calmColors = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      const direction = this.randomDirection(random);
      const profile = terrainProfile(direction);
      const radius = SPHERE_RADIUS + profile.displacement + (random() - 0.5) * (0.055 + profile.ridge * 0.08);
      positions[index * 3] = direction.x * radius;
      positions[index * 3 + 1] = direction.y * radius;
      positions[index * 3 + 2] = direction.z * radius;
      const mix = random();
      const elevation = THREE.MathUtils.clamp((profile.displacement + 0.29) / 0.65, 0, 1);
      const magenta = mix > 0.78;
      const cyan = mix < 0.3;
      const base = magenta ? [0.78, 0.23, 0.9] : cyan ? [0.2, 0.7, 1] : [0.3, 0.34, 1];
      const brightness = 0.42 + elevation * 0.24 + profile.ridge * 0.88;
      radiantColors[index * 3] = base[0] * brightness;
      radiantColors[index * 3 + 1] = base[1] * brightness;
      radiantColors[index * 3 + 2] = base[2] * brightness;
      calmColors[index * 3] = 0.11 + mix * 0.08 + elevation * 0.12 + profile.ridge * 0.48;
      calmColors[index * 3 + 1] = 0.16 + mix * 0.1 + elevation * 0.17 + profile.ridge * 0.43;
      calmColors[index * 3 + 2] = 0.34 + mix * 0.13 + elevation * 0.23 + profile.ridge * 0.4;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const radiantAttribute = new THREE.BufferAttribute(radiantColors, 3);
    const calmAttribute = new THREE.BufferAttribute(calmColors, 3);
    geometry.setAttribute("color", radiantAttribute);
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({
      size: 0.02,
      map: this.glowTexture,
      transparent: true,
      opacity: 0.82,
      vertexColors: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      alphaTest: 0.01,
      toneMapped: false,
    }));
    return this.registerStyledPointCloud(points, calmAttribute, radiantAttribute, 0.72, 0.9, 0.018, 0.024);
  }

  private createTerrainAccents() {
    const random = seededRandom(1312);
    const positions: number[] = [];
    const radiantColors: number[] = [];
    const calmColors: number[] = [];
    const density = window.innerWidth < 720 ? 0.38 : 1;
    const addParticle = (direction: THREE.Vector3) => {
      const profile = terrainProfile(direction);
      const spray = Math.pow(random(), 5.2) * (0.035 + profile.ridge * 0.19) + (random() - 0.5) * 0.025;
      const radius = SPHERE_RADIUS + profile.displacement + spray;
      positions.push(direction.x * radius, direction.y * radius, direction.z * radius);

      const whiteChance = random();
      const roseChance = random();
      const white = whiteChance > 0.955;
      const rose = roseChance < 0.22 + profile.ridge * 0.34;
      const elevation = THREE.MathUtils.clamp((profile.displacement + 0.29) / 0.65, 0, 1);
      const brightnessNoise = random();
      const brightness = 0.28 + elevation * 0.15 + profile.ridge * 0.6 + brightnessNoise * 0.2;
      const base = white ? [0.96, 1.0, 1.08] : rose ? [0.96, 0.3, 0.88] : [0.28, 0.72, 1.0];
      radiantColors.push(base[0] * brightness, base[1] * brightness, base[2] * brightness);

      const calmWhite = whiteChance > 0.975;
      const calmRose = roseChance < 0.13 + profile.ridge * 0.28;
      const calmBrightness = 0.2 + elevation * 0.14 + profile.ridge * 0.58 + brightnessNoise * 0.18;
      const calmBase = calmWhite ? [0.9, 0.92, 1] : calmRose ? [0.78, 0.43, 0.75] : [0.38, 0.57, 0.94];
      calmColors.push(calmBase[0] * calmBrightness, calmBase[1] * calmBrightness, calmBase[2] * calmBrightness);
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
    const radiantAttribute = new THREE.Float32BufferAttribute(radiantColors, 3);
    const calmAttribute = new THREE.Float32BufferAttribute(calmColors, 3);
    geometry.setAttribute("color", radiantAttribute);
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({
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
    return this.registerStyledPointCloud(points, calmAttribute, radiantAttribute, 0.88, 0.96, 0.032, 0.039);
  }

  private createInnerDust() {
    const random = seededRandom(309);
    const count = window.innerWidth < 720 ? 500 : 1100;
    const positions = new Float32Array(count * 3);
    const radiantColors = new Float32Array(count * 3);
    const calmColors = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      const direction = this.randomDirection(random);
      const radius = SPHERE_RADIUS * Math.cbrt(random()) * 0.96;
      positions[index * 3] = direction.x * radius;
      positions[index * 3 + 1] = direction.y * radius;
      positions[index * 3 + 2] = direction.z * radius;
      const purple = random();
      radiantColors[index * 3] = 0.24 + purple * 0.46;
      radiantColors[index * 3 + 1] = 0.31 + (1 - purple) * 0.28;
      radiantColors[index * 3 + 2] = 0.78 + purple * 0.32;
      calmColors[index * 3] = 0.27 + purple * 0.27;
      calmColors[index * 3 + 1] = 0.3 + purple * 0.19;
      calmColors[index * 3 + 2] = 0.64 + purple * 0.24;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const radiantAttribute = new THREE.BufferAttribute(radiantColors, 3);
    const calmAttribute = new THREE.BufferAttribute(calmColors, 3);
    geometry.setAttribute("color", radiantAttribute);
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({
      size: 0.019,
      map: this.glowTexture,
      transparent: true,
      opacity: 0.54,
      vertexColors: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      alphaTest: 0.01,
    }));
    return this.registerStyledPointCloud(points, calmAttribute, radiantAttribute, 0.41, 0.54, 0.019, 0.019);
  }

  private createSparkleShell() {
    const random = seededRandom(777);
    const count = window.innerWidth < 720 ? 900 : 2800;
    const positions = new Float32Array(count * 3);
    const radiantColors = new Float32Array(count * 3);
    const calmColors = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      const direction = this.randomDirection(random);
      const profile = terrainProfile(direction);
      const radius = SPHERE_RADIUS + profile.displacement + (random() - 0.5) * (0.13 + profile.ridge * 0.12);
      positions[index * 3] = direction.x * radius;
      positions[index * 3 + 1] = direction.y * radius;
      positions[index * 3 + 2] = direction.z * radius;
      const magenta = random() > 0.74;
      const white = random() > 0.95;
      const brightness = (0.58 + profile.ridge * 0.48) + random() * 0.3;
      const base = white ? [0.96, 1.0, 1.08] : magenta ? [0.96, 0.34, 0.86] : [0.32, 0.76, 1.0];
      radiantColors[index * 3] = base[0] * brightness;
      radiantColors[index * 3 + 1] = base[1] * brightness;
      radiantColors[index * 3 + 2] = base[2] * brightness;
      const calmBrightness = (0.48 + profile.ridge * 0.34) + Math.max(0, brightness - 0.58 - profile.ridge * 0.48) * 0.6;
      calmColors[index * 3] = (magenta ? 0.76 : 0.52) * calmBrightness;
      calmColors[index * 3 + 1] = (magenta ? 0.5 : 0.66) * calmBrightness;
      calmColors[index * 3 + 2] = (magenta ? 0.74 : 0.92) * calmBrightness;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const radiantAttribute = new THREE.BufferAttribute(radiantColors, 3);
    const calmAttribute = new THREE.BufferAttribute(calmColors, 3);
    geometry.setAttribute("color", radiantAttribute);
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({
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
    return this.registerStyledPointCloud(points, calmAttribute, radiantAttribute, 0.86, 0.98, 0.03, 0.04);
  }

  private createOrbitingMotes() {
    const random = seededRandom(2468);
    const count = window.innerWidth < 720 ? 760 : 2200;
    const positions = new Float32Array(count * 3);
    const radiantColors = new Float32Array(count * 3);
    const calmColors = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    const speeds = new Float32Array(count);
    const drifts = new Float32Array(count);
    const lifts = new Float32Array(count);
    const sizes = new Float32Array(count);

    for (let index = 0; index < count; index += 1) {
      const direction = this.randomDirection(random);
      const profile = terrainProfile(direction);
      const altitude = -0.012 + Math.pow(random(), 1.7) * (0.16 + profile.ridge * 0.14);
      const radius = SPHERE_RADIUS + profile.displacement + altitude;
      positions[index * 3] = direction.x * radius;
      positions[index * 3 + 1] = direction.y * radius;
      positions[index * 3 + 2] = direction.z * radius;

      const palette = random();
      const brightness = 0.58 + random() * 0.5 + profile.ridge * 0.32;
      const radiantBase = palette < 0.38
        ? [0.3, 0.84, 1.08]
        : palette < 0.73
          ? [0.64, 0.38, 1.04]
          : palette < 0.94
            ? [1.02, 0.34, 0.86]
            : [1.08, 1.12, 1.2];
      const calmBase = palette < 0.5 ? [0.48, 0.64, 0.94] : palette < 0.88 ? [0.62, 0.55, 0.9] : [0.82, 0.75, 0.9];
      radiantColors[index * 3] = radiantBase[0] * brightness;
      radiantColors[index * 3 + 1] = radiantBase[1] * brightness;
      radiantColors[index * 3 + 2] = radiantBase[2] * brightness;
      calmColors[index * 3] = calmBase[0] * brightness * 0.72;
      calmColors[index * 3 + 1] = calmBase[1] * brightness * 0.72;
      calmColors[index * 3 + 2] = calmBase[2] * brightness * 0.72;

      phases[index] = random() * Math.PI * 2;
      speeds[index] = 0.34 + random() * 0.72;
      drifts[index] = 0.018 + Math.pow(random(), 1.6) * 0.075;
      lifts[index] = 0.012 + random() * 0.052;
      sizes[index] = 0.62 + Math.pow(random(), 2.2) * 1.42;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.orbitingMoteRadiantColors = new THREE.BufferAttribute(radiantColors, 3);
    this.orbitingMoteCalmColors = new THREE.BufferAttribute(calmColors, 3);
    geometry.setAttribute("color", this.orbitingMoteRadiantColors);
    geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    geometry.setAttribute("aSpeed", new THREE.BufferAttribute(speeds, 1));
    geometry.setAttribute("aDrift", new THREE.BufferAttribute(drifts, 1));
    geometry.setAttribute("aLift", new THREE.BufferAttribute(lifts, 1));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      toneMapped: false,
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: 0.88 },
        uPointSize: { value: 0.031 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, this.performanceProfile.maxPixelRatio) },
        uMotionScale: { value: 1 },
      },
      vertexShader: `
        uniform float uTime;
        uniform float uPointSize;
        uniform float uPixelRatio;
        uniform float uMotionScale;
        attribute float aPhase;
        attribute float aSpeed;
        attribute float aDrift;
        attribute float aLift;
        attribute float aSize;
        varying vec3 vColor;
        varying float vFacing;
        varying float vTwinkle;

        void main() {
          vec3 direction = normalize(position);
          vec3 guide = abs(direction.y) > 0.86 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
          vec3 tangent = normalize(cross(direction, guide));
          vec3 bitangent = normalize(cross(direction, tangent));
          float time = uTime * aSpeed + aPhase;
          float primary = sin(time);
          float secondary = cos(time * 0.73 + aPhase * 1.71);
          float radial = sin(time * 0.57 + aPhase * 0.43);
          vec3 displaced = position
            + tangent * primary * aDrift * uMotionScale
            + bitangent * secondary * aDrift * 0.58 * uMotionScale
            + direction * radial * aLift * uMotionScale;

          vec4 worldPosition = modelMatrix * vec4(displaced, 1.0);
          vec3 worldDirection = normalize(mat3(modelMatrix) * direction);
          vec3 viewDirection = normalize(cameraPosition - worldPosition.xyz);
          vFacing = smoothstep(-0.2, 0.24, dot(worldDirection, viewDirection));
          vTwinkle = 0.72 + sin(time * 1.43 + aPhase * 2.2) * 0.28;
          vColor = color;

          vec4 viewPosition = viewMatrix * worldPosition;
          gl_Position = projectionMatrix * viewPosition;
          gl_PointSize = max(1.0, uPointSize * aSize * uPixelRatio * (300.0 / max(1.0, -viewPosition.z)));
        }
      `,
      fragmentShader: `
        uniform float uOpacity;
        varying vec3 vColor;
        varying float vFacing;
        varying float vTwinkle;

        void main() {
          vec2 centered = gl_PointCoord - vec2(0.5);
          float distanceToCenter = length(centered) * 2.0;
          float halo = 1.0 - smoothstep(0.12, 1.0, distanceToCenter);
          float core = 1.0 - smoothstep(0.0, 0.34, distanceToCenter);
          float alpha = (halo * 0.7 + core * 0.3) * uOpacity * vFacing * vTwinkle;
          if (alpha < 0.018) discard;
          vec3 color = vColor * (0.62 + core * 0.74);
          gl_FragColor = vec4(clamp(color, vec3(0.0), vec3(1.4)), alpha);
        }
      `,
    });
    this.animatedMaterials.push(material);
    const points = new THREE.Points(geometry, material);
    points.renderOrder = 1;
    return points;
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
      alphaTest: 0.01,
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
      const color = new THREE.Color(colors.get(groupName));
      notes.forEach((note) => addLine(clusterPosition, positions.get(note.id)!, color, color));
    });

    const nodeById = new Map(data.nodes.map((node) => [node.id, node]));
    sampleEvenly(data.edges, this.performanceProfile.maxGraphEdges).forEach((edge) => {
      const source = positions.get(edge.source);
      const target = positions.get(edge.target);
      const sourceNode = nodeById.get(edge.source);
      const targetNode = nodeById.get(edge.target);
      if (!source || !target || !sourceNode || !targetNode) return;
      addLine(source, target, new THREE.Color(colors.get(sourceNode.group)), new THREE.Color(colors.get(targetNode.group)));
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

  private createBatchedNodeCloud(
    nodes: GraphNode[],
    positions: Map<string, THREE.Vector3>,
    radiantColorsByGroup: Map<string, number>,
    calmColorsByGroup: Map<string, number>,
    rankedNodes: GraphNode[],
    importantLabelIds: Set<string>,
  ): BatchedNodeCloud {
    const count = nodes.length;
    const pointPositions = new Float32Array(count * 3);
    const radiantColors = new Float32Array(count * 3);
    const calmColors = new Float32Array(count * 3);
    const radius = new Float32Array(count);
    const visibility = new Float32Array(count).fill(1);
    const scale = new Float32Array(count).fill(1);
    const indexById = new Map<string, number>();

    nodes.forEach((node, index) => {
      const position = positions.get(node.id)!;
      const radiantColor = new THREE.Color(radiantColorsByGroup.get(node.group) ?? RADIANT_PRIMARY_COLOR);
      const calmColor = new THREE.Color(calmColorsByGroup.get(node.group) ?? CALM_PRIMARY_COLOR);
      const degree = this.degrees.get(node.id) ?? 0;
      const nodeRadius = 0.03 + Math.sqrt(Math.min(degree, 16)) * 0.018;
      position.toArray(pointPositions, index * 3);
      radiantColor.toArray(radiantColors, index * 3);
      calmColor.toArray(calmColors, index * 3);
      radius[index] = nodeRadius * 5.2 * this.performanceProfile.pointSizeScale;
      indexById.set(node.id, index);
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(pointPositions, 3));
    const radiantAttribute = new THREE.BufferAttribute(radiantColors, 3);
    const calmAttribute = new THREE.BufferAttribute(calmColors, 3);
    const visibilityAttribute = new THREE.BufferAttribute(visibility, 1);
    const scaleAttribute = new THREE.BufferAttribute(scale, 1);
    geometry.setAttribute("color", this.sphereStyle === "radiant" ? radiantAttribute : calmAttribute);
    geometry.setAttribute("aRadius", new THREE.BufferAttribute(radius, 1));
    geometry.setAttribute("aVisibility", visibilityAttribute);
    geometry.setAttribute("aScale", scaleAttribute);

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uPixelRatio: { value: Math.min(window.devicePixelRatio, this.performanceProfile.maxPixelRatio) },
        uViewportHeight: { value: Math.max(this.canvas.clientHeight, 1) },
        uEnergy: { value: this.sphereStyle === "radiant" ? 1 : 0.78 },
      },
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        uniform float uPixelRatio;
        uniform float uViewportHeight;
        attribute float aRadius;
        attribute float aVisibility;
        attribute float aScale;
        varying vec3 vColor;
        varying float vVisibility;

        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          float projectedSize = aRadius * uViewportHeight * uPixelRatio / (0.767 * max(1.0, -mvPosition.z));
          gl_PointSize = clamp(projectedSize * aScale, 1.25, 54.0);
          gl_Position = projectionMatrix * mvPosition;
          vColor = color;
          vVisibility = aVisibility;
        }
      `,
      fragmentShader: `
        uniform float uEnergy;
        varying vec3 vColor;
        varying float vVisibility;

        void main() {
          vec2 centered = gl_PointCoord * 2.0 - 1.0;
          float distanceToCenter = length(centered);
          if (distanceToCenter > 1.0) discard;
          float halo = pow(max(0.0, 1.0 - distanceToCenter), 2.4);
          float core = 1.0 - smoothstep(0.08, 0.34, distanceToCenter);
          float ring = smoothstep(0.76, 0.58, distanceToCenter) * smoothstep(0.42, 0.58, distanceToCenter);
          float alpha = (halo * 0.46 + core * 0.9 + ring * 0.2) * vVisibility;
          vec3 color = vColor * (0.7 + halo * 0.75 + core * 1.45) * uEnergy;
          gl_FragColor = vec4(color, alpha);
        }
      `,
    });
    const points = new THREE.Points(geometry, material);
    points.renderOrder = 3;
    points.userData.kind = "batched-notes";

    rankedNodes
      .filter((node) => importantLabelIds.has(node.id))
      .forEach((node) => this.ensureBatchedLabel(node, positions.get(node.id)!, true, true));

    return {
      points,
      nodes,
      indexById,
      calmColors: calmAttribute,
      radiantColors: radiantAttribute,
      visibility: visibilityAttribute,
      scale: scaleAttribute,
    };
  }

  private ensureBatchedLabel(node: GraphNode, position: THREE.Vector3, important: boolean, base: boolean) {
    const existing = this.batchedLabels.get(node.id);
    if (existing) {
      existing.important ||= important;
      existing.base ||= base;
      return existing;
    }
    const element = document.createElement("span");
    element.className = "graph-label graph-label--batched";
    element.textContent = node.title;
    const object = new CSS2DObject(element);
    object.position.copy(position);
    object.center.set(0, 1.15);
    this.networkRoot.add(object);
    const entry: BatchedLabel = { node, object, important, base };
    this.batchedLabels.set(node.id, entry);
    return entry;
  }

  private nodeMatchesSearch(node: GraphNode) {
    return !this.search
      || node.title.toLocaleLowerCase().includes(this.search)
      || node.path.toLocaleLowerCase().includes(this.search)
      || node.group.toLocaleLowerCase().includes(this.search);
  }

  private syncTransientBatchedLabels() {
    if (!this.batchedNodeCloud) return;
    const requested = new Set<string>();
    this.virtualLabelIds.forEach((id) => requested.add(id));
    if (this.selectedId) requested.add(this.selectedId);
    if (this.hoveredId) requested.add(this.hoveredId);

    if (this.focusedId) {
      let remaining = this.performanceProfile.focusLabelBudget;
      for (const node of this.batchedNodeCloud.nodes) {
        if (remaining <= 0) break;
        if (!this.focusNodeDistances.has(node.id)) continue;
        requested.add(node.id);
        remaining -= 1;
      }
    }

    if (this.search) {
      let remaining = Math.min(80, this.performanceProfile.focusLabelBudget);
      for (const node of this.batchedNodeCloud.nodes) {
        if (remaining <= 0) break;
        if (!this.nodeMatchesSearch(node)) continue;
        requested.add(node.id);
        remaining -= 1;
      }
    }

    for (const [id, entry] of this.batchedLabels) {
      if (entry.base || requested.has(id)) continue;
      entry.object.removeFromParent();
      entry.object.element.remove();
      this.batchedLabels.delete(id);
    }
    requested.forEach((id) => {
      const node = this.nodesById.get(id);
      const position = this.nodePositions.get(id);
      if (node && position && node.kind !== "cluster") this.ensureBatchedLabel(node, position, false, false);
    });
  }

  private refreshVisibleBatchedLabels() {
    const cloud = this.batchedNodeCloud;
    this.virtualLabelIds.clear();
    if (!cloud || this.labelMode !== "all" || this.focusedId || this.search) {
      this.syncTransientBatchedLabels();
      return;
    }

    this.root.updateMatrixWorld(true);
    const frontFacing: string[] = [];
    for (const node of cloud.nodes) {
      const position = this.nodePositions.get(node.id);
      if (!position) continue;
      this.tempWorld.copy(position).applyMatrix4(this.root.matrixWorld);
      this.tempNormal.copy(position).normalize().transformDirection(this.root.matrixWorld);
      this.tempCameraDirection.copy(this.camera.position).sub(this.tempWorld).normalize();
      if (this.tempNormal.dot(this.tempCameraDirection) > 0.08) frontFacing.push(node.id);
    }
    sampleEvenly(frontFacing, this.performanceProfile.baseLabelBudget)
      .forEach((id) => this.virtualLabelIds.add(id));
    this.syncTransientBatchedLabels();
  }

  private applyBatchedVisualState() {
    const cloud = this.batchedNodeCloud;
    if (!cloud) return;
    cloud.nodes.forEach((node, index) => {
      const matches = this.nodeMatchesSearch(node);
      const selected = node.id === this.selectedId;
      const hovered = node.id === this.hoveredId;
      const focusDistance = this.focusedId ? this.focusNodeDistances.get(node.id) : undefined;
      const inFocus = !this.focusedId || focusDistance !== undefined;
      const focusVisibility = !this.focusedId
        ? 1
        : !inFocus
          ? 0.022
          : focusDistance === 0
            ? 1
            : Math.max(0.34, 1 - (focusDistance ?? 0) * 0.2);
      const visibility = (matches ? 1 : 0.045) * focusVisibility;
      const focusScale = focusDistance === 1 ? 1.14 : focusDistance === 2 ? 1.06 : 1;
      cloud.visibility.setX(index, visibility);
      cloud.scale.setX(index, selected ? 1.72 : hovered ? 1.36 : focusScale);
    });
    cloud.visibility.needsUpdate = true;
    cloud.scale.needsUpdate = true;
  }

  private updateBatchedLabels() {
    if (!this.batchedNodeCloud || this.labelMode === "none" && !this.focusedId) return;
    this.root.updateMatrixWorld(true);
    for (const entry of this.batchedLabels.values()) {
      const { node, object, important } = entry;
      const matches = this.nodeMatchesSearch(node);
      const selected = node.id === this.selectedId;
      const hovered = node.id === this.hoveredId;
      const focusDistance = this.focusedId ? this.focusNodeDistances.get(node.id) : undefined;
      const inFocus = !this.focusedId || focusDistance !== undefined;
      object.getWorldPosition(this.tempWorld);
      this.tempNormal.copy(object.position).normalize().transformDirection(this.root.matrixWorld);
      this.tempCameraDirection.copy(this.camera.position).sub(this.tempWorld).normalize();
      const facing = this.tempNormal.dot(this.tempCameraDirection);
      const modeMatch = this.focusedId
        ? inFocus
        : this.labelMode === "all"
          || (this.labelMode === "important" && (important || selected || hovered || Boolean(this.search && matches)));
      const distanceOpacity = focusDistance === undefined ? 1 : Math.max(0.42, 1 - focusDistance * 0.2);
      const opacity = modeMatch && matches
        ? THREE.MathUtils.smoothstep(facing, -0.12, 0.34) * distanceOpacity
        : 0;
      const element = object.element;
      element.classList.toggle("is-selected", selected);
      element.classList.toggle("is-focus-neighbor", Boolean(this.focusedId && inFocus && !selected));
      element.dataset.focusDistance = focusDistance === undefined ? "" : String(focusDistance);
      element.style.opacity = String(opacity);
      element.style.visibility = opacity < 0.06 ? "hidden" : "visible";
    }
  }

  private createNodeVisual(
    node: GraphNode,
    position: THREE.Vector3,
    radiantColorValue: number,
    calmColorValue: number,
    cluster: boolean,
    importantLabel: boolean,
  ): NodeVisual {
    const group = new THREE.Group();
    group.position.copy(position);
    const degree = node.kind === "cluster" ? node.noteCount ?? 1 : this.degrees.get(node.id) ?? 0;
    const radius = cluster
      ? 0.11 + Math.min(degree, 28) * 0.0021
      : 0.03 + Math.sqrt(Math.min(degree, 16)) * 0.018;
    const radiantColor = new THREE.Color(radiantColorValue);
    const calmColor = new THREE.Color(calmColorValue);
    const color = (this.sphereStyle === "radiant" ? radiantColor : calmColor).clone();
    const innerColor = color.clone().lerp(NODE_HIGHLIGHT_COLOR, cluster ? 0.76 : 0.64);
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
      alphaTest: 0.012,
    }));
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.glowTexture,
      color,
      transparent: true,
      opacity: cluster ? 0.58 : 0.36,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      alphaTest: 0.012,
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

    const element = document.createElement("span");
    element.className = cluster ? "graph-label graph-label--cluster" : "graph-label";
    element.textContent = node.title;
    const labelObject = new CSS2DObject(element);
    labelObject.position.set(radius * 1.5, cluster ? -0.22 : -0.13, 0);
    group.add(labelObject);

    return {
      node,
      group,
      hit,
      core,
      inner,
      marker,
      glow,
      label: labelObject,
      importantLabel,
      baseScale: cluster ? 1.06 : 1,
      calmColor,
      radiantColor,
    };
  }

  private createHubRings(position: THREE.Vector3, radiantColorValue: number, calmColorValue: number) {
    const group = new THREE.Group();
    group.position.copy(position);
    group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), position.clone().normalize());
    [0.22, 0.34, 0.48, 0.63].forEach((radius, index) => {
      const points = Array.from({ length: 72 }, (_, pointIndex) => {
        const angle = (pointIndex / 72) * Math.PI * 2;
        return new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
      });
      const material = new THREE.LineBasicMaterial({
        color: this.sphereStyle === "radiant" ? radiantColorValue : calmColorValue,
        transparent: true,
        opacity: 0.48 - index * 0.085,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      this.styledLineMaterials.push({
        material,
        calmColor: new THREE.Color(calmColorValue),
        radiantColor: new THREE.Color(radiantColorValue),
      });
      const ring = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(points),
        material,
      );
      group.add(ring);
    });
    const spokePositions: number[] = [];
    for (let index = 0; index < 20; index += 1) {
      const angle = (index / 20) * Math.PI * 2;
      spokePositions.push(0, 0, 0, Math.cos(angle) * 0.64, Math.sin(angle) * 0.64, 0);
    }
    const spokeMaterial = new THREE.LineBasicMaterial({
      color: this.sphereStyle === "radiant" ? radiantColorValue : calmColorValue,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.styledLineMaterials.push({
      material: spokeMaterial,
      calmColor: new THREE.Color(calmColorValue),
      radiantColor: new THREE.Color(radiantColorValue),
    });
    const spokes = new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(spokePositions, 3)),
      spokeMaterial,
    );
    group.add(spokes);
    return group;
  }

  private applyVisualState() {
    this.syncTransientBatchedLabels();
    for (const visual of this.nodeVisuals) {
      const { node, group, label } = visual;
      const matches = this.nodeMatchesSearch(node);
      const selected = node.id === this.selectedId;
      const hovered = node.id === this.hoveredId;
      const focusDistance = this.focusedId ? this.focusNodeDistances.get(node.id) : undefined;
      const inFocus = !this.focusedId || focusDistance !== undefined;
      group.userData.visualState = { matches, selected, hovered, focusDistance, inFocus };
      const focusScale = focusDistance === 1 ? 1.12 : focusDistance === 2 ? 1.05 : 1;
      group.userData.targetScale = visual.baseScale * (selected ? 1.58 : hovered ? 1.25 : focusScale);
      if (label) {
        const element = label.element;
        element.classList.toggle("is-selected", selected);
        element.classList.toggle("is-focus-neighbor", Boolean(this.focusedId && inFocus && !selected));
        element.dataset.searchMatch = matches ? "true" : "false";
        element.dataset.focusDistance = focusDistance === undefined ? "" : String(focusDistance);
      }
    }
    this.applyBatchedVisualState();
  }

  private updateNodeVisuals(elapsed: number, delta: number) {
    this.root.updateMatrixWorld(true);
    for (const visual of this.nodeVisuals) {
      const { node, group, core, inner, marker, glow, label } = visual;
      const state = group.userData.visualState as {
        matches: boolean;
        selected: boolean;
        hovered: boolean;
        focusDistance?: number;
        inFocus: boolean;
      } | undefined;
      const matches = state?.matches ?? true;
      const selected = state?.selected ?? false;
      const hovered = state?.hovered ?? false;
      const focusDistance = state?.focusDistance;
      const inFocus = state?.inFocus ?? true;

      group.getWorldPosition(this.tempWorld);
      this.tempNormal.copy(group.position).normalize().transformDirection(this.root.matrixWorld);
      this.tempCameraDirection.copy(this.camera.position).sub(this.tempWorld).normalize();
      const facing = this.tempNormal.dot(this.tempCameraDirection);
      const depth = 0.24 + THREE.MathUtils.smoothstep(facing, -0.42, 0.38) * 0.76;
      const focusVisibility = !this.focusedId
        ? 1
        : !inFocus
          ? 0.028
          : focusDistance === 0
            ? 1
            : Math.max(0.36, 1 - (focusDistance ?? 0) * 0.2);
      const visibility = (matches ? 1 : 0.075) * focusVisibility * depth;
      const isCluster = node.kind === "cluster";
      const radiant = this.sphereStyle === "radiant";
      const coreEnergy = radiant ? 1 : 0.9;
      const markerEnergy = radiant ? 1 : 0.84;
      const glowEnergy = radiant ? 1 : 0.68;

      core.material.opacity = visibility * (isCluster ? 0.92 : 0.78) * coreEnergy;
      inner.material.opacity = visibility * (isCluster ? 0.98 : 0.88) * coreEnergy;
      marker.material.opacity = visibility * (selected || hovered ? 1 : isCluster ? 0.88 : 0.72) * markerEnergy;
      glow.material.opacity = visibility * (selected || hovered ? 0.78 : isCluster ? 0.5 : 0.3) * glowEnergy;

      const pulse = selected && !this.reducedMotion ? 1 + Math.sin(elapsed * 2.4) * 0.022 : 1;
      const targetScale = ((group.userData.targetScale as number | undefined) ?? visual.baseScale) * pulse;
      const easing = this.reducedMotion ? 1 : 1 - Math.exp(-delta * 13);
      group.scale.setScalar(THREE.MathUtils.lerp(group.scale.x, targetScale, easing));

      if (label) {
        const searchMatch = label.element.dataset.searchMatch !== "false";
        const modeMatch = this.focusedId
          ? inFocus
          : this.labelMode === "all"
            || (this.labelMode === "important" && (
              visual.importantLabel
              || selected
              || hovered
              || (this.search.length > 0 && searchMatch)
            ));
        const opacity = modeMatch && searchMatch
          ? THREE.MathUtils.smoothstep(facing, -0.12, 0.34) * focusVisibility
          : 0;
        label.element.style.opacity = String(opacity);
        label.element.style.visibility = opacity < 0.06 ? "hidden" : "visible";
      }
    }
    this.updateBatchedLabels();
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
      const node = this.pickNode();
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
      const node = this.pickNode();
      if (node) {
        this.focusNode(node.id);
      } else {
        this.clearFocus(true);
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
      this.cameraTweening = false;
    }, { passive: false });
  }

  private updatePointer(event: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private pickNode() {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const targets: THREE.Object3D[] = [...this.hitMeshes];
    if (this.batchedNodeCloud) targets.push(this.batchedNodeCloud.points);
    for (const intersection of this.raycaster.intersectObjects(targets, false)) {
      if (this.batchedNodeCloud && intersection.object === this.batchedNodeCloud.points && intersection.index !== undefined) {
        return this.batchedNodeCloud.nodes[intersection.index] ?? null;
      }
      const node = intersection.object.userData.node as GraphNode | undefined;
      if (node) return node;
    }
    return null;
  }

  private resize() {
    const parent = this.canvas.parentElement ?? this.canvas;
    const width = Math.max(parent.clientWidth, 1);
    const height = Math.max(parent.clientHeight, 1);
    this.camera.aspect = width / height;
    this.defaultCameraZ = width < 720 ? 21.5 : 12;
    this.camera.position.z = this.focusedId ? (width < 720 ? 18.8 : 10.45) : this.defaultCameraZ;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    this.labelRenderer.setSize(width, height);
    if (this.orbitingMotes) {
      this.orbitingMotes.material.uniforms.uPixelRatio.value = Math.min(
        window.devicePixelRatio,
        this.performanceProfile.maxPixelRatio,
      );
    }
    if (this.batchedNodeCloud) {
      this.batchedNodeCloud.points.material.uniforms.uPixelRatio.value = Math.min(
        window.devicePixelRatio,
        this.performanceProfile.maxPixelRatio,
      );
      this.batchedNodeCloud.points.material.uniforms.uViewportHeight.value = height;
    }
    if (this.cosmicBackgroundEnabled) this.refreshCosmicBackground();
  }

  private refreshCosmicBackground() {
    const parent = this.canvas.parentElement ?? this.canvas;
    const width = Math.max(parent.clientWidth, 1);
    const height = Math.max(parent.clientHeight, 1);
    const aspect = width / height;
    if (this.cosmicBackgroundTexture && Math.abs(aspect - this.cosmicBackgroundAspect) < 0.06) {
      this.scene.background = this.cosmicBackgroundTexture;
      return;
    }

    const longEdge = width < 720 ? 1024 : this.performanceProfile.tier === "full" ? 1600 : 1280;
    const textureWidth = aspect >= 1 ? longEdge : Math.max(512, Math.round(longEdge * aspect));
    const textureHeight = aspect >= 1 ? Math.max(512, Math.round(longEdge / aspect)) : longEdge;
    this.cosmicBackgroundTexture?.dispose();
    this.cosmicBackgroundTexture = createCosmicBackgroundTexture(textureWidth, textureHeight);
    this.cosmicBackgroundAspect = aspect;
    this.scene.background = this.cosmicBackgroundTexture;
  }

  private animate = () => {
    const rawDelta = Math.min(this.clock.getDelta(), 0.05);
    this.frameAccumulator += rawDelta;
    const frameInterval = 1 / this.performanceProfile.targetFps;
    if (this.frameAccumulator < frameInterval) {
      this.animationFrame = window.requestAnimationFrame(this.animate);
      return;
    }
    const delta = Math.min(this.frameAccumulator, 0.08);
    this.frameAccumulator = 0;
    const elapsed = this.clock.elapsedTime;
    const materialTime = this.reducedMotion ? 0 : elapsed;
    this.animatedMaterials.forEach((material) => {
      const timeUniform = material.uniforms.uTime;
      if (timeUniform) timeUniform.value = materialTime;
    });
    if (!this.reducedMotion && this.orbitingMotes) {
      const motionScale = this.sphereStyle === "radiant" ? 1 : 0.58;
      this.orbitingMotes.rotation.y += delta * 0.011 * motionScale;
      this.orbitingMotes.rotation.x = Math.sin(elapsed * 0.19) * 0.009 * motionScale;
      this.orbitingMotes.rotation.z = Math.cos(elapsed * 0.14) * 0.006 * motionScale;
    }
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
    if (this.cameraTweening) {
      this.cameraTweenElapsed = Math.min(this.cameraTweenElapsed + delta, this.cameraTweenDuration);
      const progress = this.cameraTweenElapsed / this.cameraTweenDuration;
      const eased = progress * progress * progress * (progress * (progress * 6 - 15) + 10);
      this.camera.position.z = THREE.MathUtils.lerp(this.cameraTweenStart, this.cameraTweenEnd, eased);
      if (progress >= 1) this.cameraTweening = false;
    }
    if (this.batchedNodeCloud && this.labelMode === "all" && !this.focusedId && !this.search) {
      this.labelRefreshAccumulator += delta;
      if (this.labelRefreshAccumulator >= 0.42) {
        this.labelRefreshAccumulator = 0;
        this.refreshVisibleBatchedLabels();
      }
    }
    this.updateNodeVisuals(elapsed, delta);
    this.composer.render();
    if (this.labelMode !== "none" || this.focusedId) this.labelRenderer.render(this.scene, this.camera);
    this.animationFrame = window.requestAnimationFrame(this.animate);
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
    this.styledLineMaterials.length = 0;
    this.networkRoot.traverse((object) => {
      if (object instanceof CSS2DObject) object.element.remove();
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose();
      if (Array.isArray(mesh.material)) mesh.material.forEach((material) => material.dispose());
      else mesh.material?.dispose();
    });
    this.networkRoot.clear();
    this.batchedLabels.clear();
    this.virtualLabelIds.clear();
    this.batchedNodeCloud = null;
    this.focusLineRoot = new THREE.Group();
    this.graphLineMaterial = null;
  }

  destroy() {
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    this.clearNetwork();
    this.labelRenderer.domElement.remove();
    this.glowTexture.dispose();
    this.nodeMarkerTexture.dispose();
    this.cosmicBackgroundTexture?.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }
}
