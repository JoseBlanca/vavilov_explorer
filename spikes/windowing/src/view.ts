// A view window: 50,000 points drawn with Three.js, a replica of the
// backend's state kept up to date over a channel, and the measurements.
import { Channel, invoke } from "@tauri-apps/api/core";
import * as THREE from "three";
import { HEADER, Kind, N, SELECTION_BYTES, now, readHeader, report } from "./protocol";
import { clockResolution, summarize } from "./stats";

type Change = "hover" | "selection" | "membership";

const PALETTE = [0x1f77b4, 0xff7f0e, 0x2ca02c, 0xd62728, 0x9467bd].map((c) => new THREE.Color(c));
const GREY = new THREE.Color(0xd0d0d0);
const HOVER_COLOR = new THREE.Color(0x000000);

export async function startView(label: string): Promise<void> {
  const container = document.createElement("div");
  container.id = "view";
  const status = document.createElement("div");
  status.id = "status";
  document.body.append(container, status);

  // The replica of the backend's state.
  let revision = -1;
  let hover = -1;
  const selection = new Uint8Array(SELECTION_BYTES);
  const membership = new Uint16Array(N);

  // Measurements.
  const samples: Record<Change, { recv: number[]; drawn: number[] }> = {
    hover: { recv: [], drawn: [] },
    selection: { recv: [], drawn: [] },
    membership: { recv: [], drawn: [] },
  };
  const gaps: string[] = [];
  let notArrayBuffer = 0;
  let receivedWhileHidden = 0;

  const t0Positions = now();
  const positions = new Float32Array(await invoke<ArrayBuffer>("positions"));
  const positionsMs = now() - t0Positions;
  if (positions.length !== 3 * N) throw new Error(`positions: ${positions.length} floats, expected ${3 * N}`);

  // Three.js scene.
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(devicePixelRatio);
  container.append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.set(2.2, 1.8, 3.2);
  camera.lookAt(0, 0, 0);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const colors = new Float32Array(3 * N);
  const colorAttribute = new THREE.BufferAttribute(colors, 3);
  colorAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("color", colorAttribute);
  scene.add(new THREE.Points(geometry, new THREE.PointsMaterial({ size: 4, sizeAttenuation: false, vertexColors: true })));
  // The hovered individual, drawn on top as a larger red point.
  const marker = new Float32Array(3);
  const markerGeometry = new THREE.BufferGeometry();
  markerGeometry.setAttribute("position", new THREE.BufferAttribute(marker, 3));
  const markerPoints = new THREE.Points(
    markerGeometry,
    new THREE.PointsMaterial({ size: 14, sizeAttenuation: false, color: 0xe00000, depthTest: false }),
  );
  markerPoints.renderOrder = 1;
  markerPoints.visible = false;
  scene.add(markerPoints);
  function placeMarker(): void {
    markerPoints.visible = hover >= 0;
    if (hover < 0) return;
    marker.set(positions.subarray(3 * hover, 3 * hover + 3));
    markerGeometry.attributes.position.needsUpdate = true;
  }

  // Screen positions of the points, for picking under the pointer.
  const screen = new Float32Array(2 * N);
  const v = new THREE.Vector3();
  function resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // The camera's view matrix is otherwise only computed by the first
    // render, and the projection below would use the identity.
    camera.updateMatrixWorld();
    for (let i = 0; i < N; i++) {
      v.set(positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]).project(camera);
      screen[2 * i] = ((v.x + 1) / 2) * w;
      screen[2 * i + 1] = ((1 - v.y) / 2) * h;
    }
    requestDraw();
  }

  const selected = (i: number) => (selection[i >> 3] >> (i & 7)) & 1;
  const anySelected = () => selection.some((b) => b !== 0);
  function colorOf(i: number, any: boolean): THREE.Color {
    if (i === hover) return HOVER_COLOR;
    if (any && !selected(i)) return GREY;
    return PALETTE[membership[i] % PALETTE.length];
  }
  function writeColor(i: number, any: boolean): void {
    const c = colorOf(i, any);
    colors[3 * i] = c.r;
    colors[3 * i + 1] = c.g;
    colors[3 * i + 2] = c.b;
  }
  function recolorAll(): void {
    const any = anySelected();
    for (let i = 0; i < N; i++) writeColor(i, any);
    colorAttribute.clearUpdateRanges();
    colorAttribute.needsUpdate = true;
  }
  function recolorOne(i: number): void {
    if (i < 0) return;
    writeColor(i, anySelected());
    colorAttribute.addUpdateRange(3 * i, 3);
    colorAttribute.needsUpdate = true;
  }

  // Drawing on demand, recording when each change reached the screen.
  let pending: { change: Change; t0: number }[] = [];
  let drawRequested = false;
  function requestDraw(): void {
    if (drawRequested) return;
    drawRequested = true;
    requestAnimationFrame(() => {
      drawRequested = false;
      renderer.render(scene, camera);
      const drawn = now();
      for (const p of pending) samples[p.change].drawn.push(drawn - p.t0);
      pending = [];
      colorAttribute.clearUpdateRanges();
      status.textContent = `${label}  revision ${revision}  hover ${hover}`;
    });
  }

  function apply(buffer: ArrayBuffer): void {
    const received = now();
    if (!(buffer instanceof ArrayBuffer)) {
      notArrayBuffer++;
      return;
    }
    if (document.hidden) receivedWhileHidden++;
    const h = readHeader(buffer);
    if (h.kind === Kind.startBench) return void runBench();
    if (h.kind === Kind.sendReport) return void sendReport();
    if (h.revision <= revision) return; // already in the snapshot
    if (h.revision !== revision + 1 && gaps.length < 20) gaps.push(`${revision} -> ${h.revision}`);
    revision = h.revision;
    let change: Change;
    if (h.kind === Kind.hover) {
      const previous = hover;
      hover = new DataView(buffer).getInt32(HEADER, true);
      recolorOne(previous);
      recolorOne(hover);
      placeMarker();
      change = "hover";
    } else if (h.kind === Kind.selection) {
      selection.set(new Uint8Array(buffer, HEADER, SELECTION_BYTES));
      recolorAll();
      change = "selection";
    } else if (h.kind === Kind.membership) {
      membership.set(new Uint16Array(buffer, HEADER, N));
      recolorAll();
      change = "membership";
    } else {
      throw new Error(`unknown message kind ${h.kind}`);
    }
    if (h.t0 > 0) {
      samples[change].recv.push(received - h.t0);
      pending.push({ change, t0: h.t0 });
    }
    requestDraw();
  }

  // Subscribe: messages that arrive before the snapshot is applied wait.
  let early: ArrayBuffer[] | null = [];
  const channel = new Channel<ArrayBuffer>((m) => (early ? early.push(m) : apply(m)));
  const snapshot = await invoke<ArrayBuffer>("subscribe", { onChange: channel });
  const s = readHeader(snapshot);
  revision = s.revision;
  hover = new DataView(snapshot).getInt32(HEADER, true);
  selection.set(new Uint8Array(snapshot, HEADER + 8, SELECTION_BYTES));
  membership.set(new Uint16Array(snapshot, HEADER + 8 + SELECTION_BYTES, N));
  recolorAll();
  placeMarker();
  for (const m of early) apply(m);
  early = null;

  window.addEventListener("resize", resize);
  resize();

  // Hover from the real pointer, at most one per frame.
  let pointer: { x: number; y: number } | null = null;
  let hoverQueued = false;
  let movesWhileInactive = 0;
  container.addEventListener("pointermove", (e) => {
    if (!document.hasFocus() && movesWhileInactive++ === 0) {
      void report({ window: label, check: "pointermove while the window is not active", received: true });
    }
    pointer = { x: e.clientX, y: e.clientY };
    if (hoverQueued) return;
    hoverQueued = true;
    requestAnimationFrame(() => {
      hoverQueued = false;
      if (!pointer) return;
      const index = nearest(pointer.x, pointer.y, 8);
      if (index !== hover) void invoke("set_hover", { index, t0: now() });
    });
  });
  function nearest(x: number, y: number, radius: number): number {
    let best = -1;
    let bestD = radius * radius;
    for (let i = 0; i < N; i++) {
      const dx = screen[2 * i] - x;
      const dy = screen[2 * i + 1] - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  // The manual checks: what reaches the page of an inactive window.
  container.addEventListener("pointerdown", () => {
    void report({ window: label, check: "pointerdown", windowWasActive: document.hasFocus(), at: now() });
  });
  window.addEventListener("focus", () => void report({ window: label, check: "window became active", at: now() }));
  document.addEventListener("visibilitychange", () => {
    void report({
      window: label,
      check: "visibility",
      hidden: document.hidden,
      revision,
      hover,
      receivedWhileHidden,
      at: now(),
    });
  });

  // The benchmark, run by the sender: one change per frame.
  const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
  let seed = 12345;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  async function runBench(): Promise<void> {
    await report({ window: label, event: "benchmark started", at: now() });
    for (let k = 0; k < 600; k++) {
      await nextFrame();
      await invoke("set_hover", { index: Math.floor(random() * N), t0: now() });
    }
    for (let k = 0; k < 120; k++) {
      await nextFrame();
      const bytes = new Uint8Array(SELECTION_BYTES);
      const start = Math.floor(random() * (SELECTION_BYTES - 500));
      bytes.fill(0xff, start, start + 500);
      await invoke("set_selection", bytes, { headers: { t0: String(now()) } });
    }
    for (let k = 0; k < 60; k++) {
      await nextFrame();
      const codes = new Uint16Array(N);
      for (let i = 0; i < N; i++) codes[i] = (i + k) % PALETTE.length;
      await invoke("set_membership", new Uint8Array(codes.buffer), { headers: { t0: String(now()) } });
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await invoke("bench_done");
  }

  async function sendReport(): Promise<void> {
    const summaries = Object.fromEntries(
      (Object.keys(samples) as Change[]).map((c) => [
        c,
        { received: summarize(samples[c].recv), drawn: summarize(samples[c].drawn) },
      ]),
    );
    await report(
      {
        window: label,
        role: label === "view-1" ? "sender (its own changes echoed back)" : "receiver",
        latencyMs: summaries,
        positionsMs: Math.round(positionsMs * 100) / 100,
        revisionGaps: gaps,
        notArrayBuffer,
        devicePixelRatio,
        clockResolutionMs: clockResolution(),
        userAgent: navigator.userAgent,
      },
      true,
    );
  }

  await invoke("ready");
}
