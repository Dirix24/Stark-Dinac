import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";

const primitives = {
  cube: () => new THREE.BoxGeometry(),
  sphere: () => new THREE.SphereGeometry(0.6, 32, 20),
  cylinder: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 32),
};
type Shape = keyof typeof primitives;
type Triple = [number, number, number];
type Model = {
  shape: Shape;
  color: string;
  position: Triple;
  rotation: Triple;
  scale: number;
};
type Mesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;

function isTriple(value: unknown): value is Triple {
  return (
    Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)
  );
}

function isModel(value: unknown): value is Model {
  if (!value || typeof value !== "object") return false;
  const model = value as Partial<Model>;
  return (
    typeof model.shape === "string" &&
    Object.hasOwn(primitives, model.shape) &&
    typeof model.color === "string" &&
    /^#[0-9a-f]{6}$/i.test(model.color) &&
    isTriple(model.position) &&
    isTriple(model.rotation) &&
    typeof model.scale === "number" &&
    model.scale >= 0.15 &&
    model.scale <= 4
  );
}

export class Editor {
  private renderer = new THREE.WebGLRenderer({ antialias: true });
  private scene = new THREE.Scene();
  private group = new THREE.Group();
  private camera = new THREE.OrthographicCamera(-4, 4, 3, -3, 0.1, 100);
  private ray = new THREE.Raycaster();
  private selected?: Mesh;
  private past: Model[][] = [];
  private future: Model[][] = [];
  private drag?: { target: Mesh; offset: THREE.Vector3; plane: THREE.Plane };
  private observer: ResizeObserver;

  constructor(private host: HTMLElement) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor("#090f1b");
    this.host.prepend(this.renderer.domElement);
    this.camera.position.set(0, 3.2, 8);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(
      this.group,
      new THREE.GridHelper(16, 32, "#185267", "#142539"),
    );
    this.scene.add(new THREE.HemisphereLight("#dbfaff", "#284253", 2));
    const light = new THREE.DirectionalLight("#cef4ff", 3);
    light.position.set(3, 6, 5);
    this.scene.add(light);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
    this.add("cube");
    this.past = [];
    const canvas = this.renderer.domElement;
    const xy = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return [
        (event.clientX - rect.left) / rect.width,
        (event.clientY - rect.top) / rect.height,
      ] as const;
    };
    canvas.addEventListener("pointerdown", (event) => {
      canvas.setPointerCapture(event.pointerId);
      this.beginDrag(...xy(event));
    });
    canvas.addEventListener("pointermove", (event) => {
      if (canvas.hasPointerCapture(event.pointerId)) this.move(...xy(event));
    });
    canvas.addEventListener("lostpointercapture", () => this.endDrag());
  }

  private resize() {
    const { clientWidth, clientHeight } = this.host;
    if (!clientWidth || !clientHeight) return;
    const aspect = clientWidth / clientHeight;
    this.camera.left = -3 * aspect;
    this.camera.right = 3 * aspect;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(clientWidth, clientHeight);
    this.draw();
  }

  private draw() {
    this.renderer.render(this.scene, this.camera);
  }

  private snapshot(): Model[] {
    return (this.group.children as Mesh[]).map((mesh) => ({
      shape: mesh.userData.shape,
      color: "#" + mesh.material.color.getHexString(),
      position: mesh.position.toArray(),
      rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
      scale: mesh.scale.x,
    }));
  }

  private remember() {
    this.past.push(this.snapshot());
    if (this.past.length > 50) this.past.shift();
    this.future = [];
  }

  private insert(model: Model) {
    const mesh = new THREE.Mesh(
      primitives[model.shape](),
      new THREE.MeshStandardMaterial({ color: model.color }),
    );
    mesh.userData.shape = model.shape;
    mesh.position.fromArray(model.position);
    mesh.rotation.set(...model.rotation);
    mesh.scale.setScalar(model.scale);
    this.group.add(mesh);
    this.select(mesh);
  }

  private select(mesh?: Mesh) {
    this.selected?.material.emissive.setHex(0);
    this.selected = mesh;
    mesh?.material.emissive.setHex(0x154052);
    this.draw();
  }

  private dispose(mesh: Mesh) {
    this.group.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
  }

  private restore(models: Model[]) {
    this.endDrag();
    this.select();
    for (const mesh of [...this.group.children] as Mesh[]) this.dispose(mesh);
    models.forEach((model) => this.insert(model));
    this.draw();
  }

  add(shape: Shape) {
    this.remember();
    this.insert({
      shape,
      color: "#28cadc",
      position: [0, 0.6, 0],
      rotation: [0.15, 0.4, 0],
      scale: 1,
    });
  }

  private modify(apply: (mesh: Mesh) => void) {
    if (!this.selected) return;
    this.remember();
    apply(this.selected);
    this.draw();
  }

  color(value: string) {
    this.modify((mesh) => mesh.material.color.set(value));
  }
  rotate(delta: number) {
    this.modify((mesh) => (mesh.rotation.y += delta));
  }
  scale(factor: number) {
    this.modify((mesh) =>
      mesh.scale.setScalar(
        THREE.MathUtils.clamp(mesh.scale.x * factor, 0.15, 4),
      ),
    );
  }

  duplicate() {
    if (!this.selected) return;
    const model = this.snapshot()[this.group.children.indexOf(this.selected)];
    this.remember();
    model.position[0] += 0.65;
    this.insert(model);
  }

  delete(confirm: () => boolean) {
    if (!this.selected || !confirm()) return;
    this.remember();
    this.dispose(this.selected);
    this.selected = undefined;
    this.draw();
  }

  undo() {
    const previous = this.past.pop();
    if (!previous) return;
    this.future.push(this.snapshot());
    this.restore(previous);
  }

  redo() {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.snapshot());
    this.restore(next);
  }

  private point(x: number, y: number) {
    this.ray.setFromCamera(
      new THREE.Vector2(x * 2 - 1, 1 - y * 2),
      this.camera,
    );
  }

  beginDrag(x: number, y: number) {
    this.endDrag();
    this.point(x, y);
    const hit = this.ray.intersectObjects(this.group.children)[0];
    this.select(hit?.object as Mesh | undefined);
    if (!this.selected) return;
    const normal = this.camera.getWorldDirection(new THREE.Vector3());
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      normal,
      this.selected.position,
    );
    const point = this.ray.ray.intersectPlane(plane, new THREE.Vector3());
    if (!point) return;
    this.remember();
    this.drag = {
      target: this.selected,
      plane,
      offset: this.selected.position.clone().sub(point),
    };
  }

  move(x: number, y: number) {
    if (!this.drag) return;
    this.point(x, y);
    const point = this.ray.ray.intersectPlane(
      this.drag.plane,
      new THREE.Vector3(),
    );
    if (!point) return;
    this.drag.target.position.copy(point.add(this.drag.offset));
    this.draw();
  }

  beginTransform() {
    if (this.selected) this.remember();
  }

  transform(rotation: number, scale: number) {
    if (!this.selected) return;
    this.selected.rotation.y += rotation;
    this.selected.scale.setScalar(
      THREE.MathUtils.clamp(this.selected.scale.x * scale, 0.15, 4),
    );
    this.draw();
  }

  endDrag() {
    this.drag = undefined;
  }

  save() {
    return JSON.stringify({ version: 1, objects: this.snapshot() }, null, 2);
  }

  load(text: string) {
    const data = JSON.parse(text);
    if (
      data?.version !== 1 ||
      !Array.isArray(data.objects) ||
      data.objects.length > 250 ||
      !data.objects.every(isModel)
    ) {
      throw new Error("Formato de escena inválido.");
    }
    this.remember();
    this.restore(data.objects);
  }

  async export() {
    const group = this.group.clone();
    const materials: THREE.Material[] = [];
    for (const mesh of group.children as Mesh[]) {
      mesh.material = mesh.material.clone();
      mesh.material.emissive.setHex(0);
      materials.push(mesh.material);
    }
    try {
      const result = await new GLTFExporter().parseAsync(group, {
        binary: true,
      });
      if (!(result instanceof ArrayBuffer))
        throw new Error("No se pudo exportar GLB.");
      return new Blob([result], { type: "model/gltf-binary" });
    } finally {
      materials.forEach((material) => material.dispose());
    }
  }
}
