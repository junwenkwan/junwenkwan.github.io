import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createSliceViews } from "./slices.js";
import { vertexShader, fragmentShader } from "./volume-shader.js";

const viewport = document.querySelector("#viewport");
const status = document.querySelector("#status");
const form = document.querySelector("#controls");
const whitePoint = document.querySelector("#white-point");
const density = document.querySelector("#density");
const reset = document.querySelector("#reset");

async function fetchVolumeFile(name) {
  const response = await fetch(new URL(name, import.meta.url));
  if (!response.ok) {
    throw new Error("Could not load " + name + ".");
  }
  return response;
}

function createVolume(voxels, { size, spacingMm }) {
  const [width, height, depth] = size;
  if (voxels.length !== width * height * depth) {
    throw new Error("The exported volume size does not match its metadata.");
  }

  const texture = new THREE.Data3DTexture(voxels, width, height, depth);
  texture.format = THREE.RedFormat;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;

  const spacing = new THREE.Vector3().fromArray(spacingMm);
  const extent = new THREE.Vector3().fromArray(size).multiply(spacing);
  const uniforms = {
    voxels: { value: texture },
    halfSize: { value: extent.clone().multiplyScalar(0.5) },
    whitePoint: { value: 1 },
    density: { value: 1 },
    stepSize: { value: 1.8 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    glslVersion: THREE.GLSL3,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(extent.x, extent.y, extent.z), material);
  return { mesh, uniforms, extent };
}

function openViewer(voxels, metadata) {
  const scene = new THREE.Scene();
  const { mesh, uniforms, extent } = createVolume(voxels, metadata);
  const radius = extent.length() / 2;
  scene.add(mesh);

  const floor = new THREE.GridHelper(Math.max(extent.x, extent.y) * 1.08, 12, 0x3e7591, 0x29516a);
  floor.rotation.x = Math.PI / 2;
  floor.position.z = -extent.z / 2 - 5;
  floor.material.transparent = true;
  floor.material.opacity = 0.36;
  floor.material.depthWrite = false;
  floor.renderOrder = -1;
  scene.add(floor);

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setClearColor(0, 0);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.domElement.setAttribute("aria-label", "Rotatable MR volume");
  viewport.prepend(renderer.domElement);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, radius * 10);
  camera.up.set(0, 0, 1);
  camera.position.set(radius * 1.65, -radius * 2.6, radius * 1.28);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.z = -extent.z * 0.045;
  controls.minZoom = 0.65;
  controls.maxZoom = 3.5;
  controls.enablePan = false;
  controls.update();
  controls.saveState();

  let renderPending = false;
  function requestRender() {
    if (renderPending) return;
    renderPending = true;
    requestAnimationFrame(() => {
      renderPending = false;
      renderer.render(scene, camera);
    });
  }

  function resize() {
    const { clientWidth: width, clientHeight: height } = viewport;
    const aspect = width / height;
    const halfHeight = 0.79 * radius / Math.min(1, aspect);
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    requestRender();
  }

  const slices = createSliceViews(voxels, metadata);
  function updateDisplay() {
    uniforms.whitePoint.value = Number(whitePoint.value);
    uniforms.density.value = Number(density.value);
    document.querySelector("#white-point-value").value = whitePoint.valueAsNumber.toFixed(2);
    document.querySelector("#density-value").value = density.valueAsNumber.toFixed(2);
    slices.setWhitePoint(uniforms.whitePoint.value);
    requestRender();
  }

  controls.addEventListener("change", requestRender);
  controls.addEventListener("start", () => { uniforms.stepSize.value = 3.5; });
  controls.addEventListener("end", () => {
    uniforms.stepSize.value = 1.8;
    requestRender();
  });
  form.addEventListener("input", updateDisplay);
  reset.addEventListener("click", () => controls.reset());
  new ResizeObserver(resize).observe(viewport);
  resize();
  updateDisplay();

  const sourceSpacing = metadata.sourcePixelSpacingMm.map(value => value.toFixed(3));
  document.querySelector("#pixels").textContent = sourceSpacing.join(" × ") + " mm";
  form.disabled = false;
  reset.disabled = false;
  status.hidden = true;
}

try {
  const [metadata, buffer] = await Promise.all([
    fetchVolumeFile("volume.json").then(response => response.json()),
    fetchVolumeFile("volume.bin").then(response => response.arrayBuffer()),
  ]);
  openViewer(new Uint8Array(buffer), metadata);
} catch (error) {
  status.textContent = error.message;
  console.error(error);
}
