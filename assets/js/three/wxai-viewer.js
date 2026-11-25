/*
 * WidowX AI arm showcase.
 *
 * Renders Trossen Robotics' public WidowX AI description (URDF + STL meshes,
 * BSD-3-Clause, copied into assets/models/wxai/) as a self-running 3D figure:
 * the arm turns slowly on a turntable while it loops a preset pick-and-place
 * routine, moving a small clay block from one spot to another and back.
 * Nothing is interactive.
 *
 * Usage (see _projects/nimble.md):
 *   <script type="importmap">{"imports":{"three":".../three.module.min.js","three/addons/":".../examples/jsm/"}}</script>
 *   <figure class="wxai-viewer" data-wxai-viewer> <img ...fallback...> <figcaption>…</figcaption> </figure>
 *   <script type="module" src="/assets/js/three/wxai-viewer.js"></script>
 *
 * The routine is described as gripper positions on the table. Joint angles for
 * each position are solved at load time against the real arm geometry, so the
 * gripper actually reaches the block.
 *
 * Design rules: transparent canvas on the parchment page, matte oat arm with
 * slate ink edges, the block in clay, warm soft light, no glow. three.js is
 * downloaded only when the figure scrolls into view; the animation runs only
 * while the figure is on screen and the tab is visible. Visitors who prefer
 * reduced motion get a still pose.
 */

const MODEL_ROOT = new URL("../../models/wxai/", import.meta.url);
const URDF_PATH = "urdf/generated/wxai/wxai_base.urdf";
const PACKAGE_PREFIX = "package://trossen_arm_description/";

const ARM_JOINTS = ["joint_0", "joint_1", "joint_2", "joint_3", "joint_4"];
const GRIPPER_JOINT = "left_carriage_joint"; // the right carriage mimics it
const END_EFFECTOR = "ee_gripper_link";

// Task layout, in metres, in the arm's own frame (x forward, y left, z up).
const BLOCK_SIZE = 0.032;
const SPOT_A = [0.3, 0.15];
const SPOT_B = [0.3, -0.15];
const HOME = [0.22, 0, 0.26];
const LIFT = 0.12; // how far the fingertips rise above the grasp height
// Gripper geometry, measured from Trossen's finger meshes: `ee_gripper_link` sits
// at the fingertips, the pads are 25 mm long, and the gap between the pads is
// 2 mm per 1 mm of carriage travel (0 mm apart at 0). So the pads meet the
// block's faces at half its width, without sinking into it.
const GRIP_OPEN = 0.03; // pads 60 mm apart
const GRIP_CLOSED = BLOCK_SIZE / 2; // pads exactly one block width apart
const GRASP_HEIGHT = 0.006; // fingertips 6 mm above the table while gripping
const PATH_SAMPLES = 10; // straight-line moves are solved at this many points

const TURNTABLE_DEG_PER_SEC = 6;

const PALETTE = {
  light: {
    body: "#e3dacc",
    accent: "#d97757",
    ink: "#141413",
    inkOpacity: 0.5,
    table: "#e3dacc",
    sky: "#faf9f5",
    ground: "#e3dacc",
  },
  dark: {
    body: "#7d766b",
    accent: "#c6613f",
    ink: "#141413",
    inkOpacity: 0.6,
    table: "#2a2824",
    sky: "#f0eee6",
    ground: "#3d3d3a",
  },
};

const prefersReducedMotion = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const isDark = () => document.documentElement.getAttribute("data-theme") === "dark";
// Smooth start and stop for arm moves, like a real servo profile.
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function parseVec(str, fallback = [0, 0, 0]) {
  if (!str) return fallback;
  return str.trim().split(/\s+/).map(Number);
}

async function mount(figure) {
  const [THREE, { STLLoader }] = await Promise.all([import("three"), import("three/addons/loaders/STLLoader.js")]);

  // ---- Parse the URDF into a joint tree ----------------------------------------
  const urdfText = await (await fetch(new URL(URDF_PATH, MODEL_ROOT))).text();
  const urdf = new DOMParser().parseFromString(urdfText, "application/xml");
  if (urdf.querySelector("parsererror")) throw new Error("Could not parse URDF");

  const applyOrigin = (object, originEl) => {
    if (!originEl) return;
    object.position.fromArray(parseVec(originEl.getAttribute("xyz")));
    const [r, p, y] = parseVec(originEl.getAttribute("rpy"));
    object.rotation.set(r, p, y, "ZYX"); // URDF roll-pitch-yaw
  };

  const bodyMaterial = new THREE.MeshStandardMaterial({
    roughness: 0.85,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const accentMaterial = bodyMaterial.clone();
  const inkMaterial = new THREE.LineBasicMaterial({ transparent: true });
  const tableMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.6 });

  const loader = new STLLoader();
  const geometryCache = new Map();
  const loadGeometry = (url) => {
    if (!geometryCache.has(url)) geometryCache.set(url, loader.loadAsync(url));
    return geometryCache.get(url);
  };
  const outlined = (geometry, material) => {
    const group = new THREE.Group();
    group.add(new THREE.Mesh(geometry, material));
    group.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 35), inkMaterial));
    return group;
  };

  const links = new Map();
  const meshLoads = [];
  for (const linkEl of urdf.querySelectorAll("robot > link")) {
    const name = linkEl.getAttribute("name");
    const group = new THREE.Group();
    group.name = name;
    links.set(name, group);
    for (const visualEl of linkEl.querySelectorAll(":scope > visual")) {
      const meshEl = visualEl.querySelector("geometry > mesh");
      if (!meshEl) continue;
      const holder = new THREE.Group();
      applyOrigin(holder, visualEl.querySelector(":scope > origin"));
      group.add(holder);
      const url = new URL(meshEl.getAttribute("filename").replace(PACKAGE_PREFIX, ""), MODEL_ROOT).href;
      meshLoads.push(loadGeometry(url).then((geometry) => holder.add(outlined(geometry, bodyMaterial))));
    }
  }

  const joints = new Map();
  const childLinks = new Set();
  for (const jointEl of urdf.querySelectorAll("robot > joint")) {
    const parent = links.get(jointEl.querySelector("parent").getAttribute("link"));
    const childName = jointEl.querySelector("child").getAttribute("link");
    const child = links.get(childName);
    if (!parent || !child) continue;
    childLinks.add(childName);

    const origin = new THREE.Group();
    applyOrigin(origin, jointEl.querySelector("origin"));
    const motion = new THREE.Group();
    origin.add(motion);
    motion.add(child);
    parent.add(origin);

    const limitEl = jointEl.querySelector("limit");
    const mimicEl = jointEl.querySelector("mimic");
    joints.set(jointEl.getAttribute("name"), {
      type: jointEl.getAttribute("type"),
      axis: new THREE.Vector3(...parseVec(jointEl.querySelector("axis")?.getAttribute("xyz"), [1, 0, 0])).normalize(),
      lower: limitEl ? Number(limitEl.getAttribute("lower")) : 0,
      upper: limitEl ? Number(limitEl.getAttribute("upper")) : 0,
      mimic: mimicEl ? mimicEl.getAttribute("joint") : null,
      motion,
      value: 0,
    });
  }

  const setJoint = (name, value) => {
    const joint = joints.get(name);
    if (!joint) return;
    joint.value = Math.min(joint.upper, Math.max(joint.lower, value));
    if (joint.type === "prismatic") joint.motion.position.copy(joint.axis).multiplyScalar(joint.value);
    else joint.motion.quaternion.setFromAxisAngle(joint.axis, joint.value);
    for (const [otherName, other] of joints) {
      if (other.mimic === name) setJoint(otherName, joint.value);
    }
  };
  const setArm = (q) => ARM_JOINTS.forEach((name, i) => setJoint(name, q[i]));

  await Promise.all(meshLoads);

  // ---- Scene graph: pivot (turntable) > robot (Z-up → Y-up) > base link ----------
  const rootName = [...links.keys()].find((name) => !childLinks.has(name));
  const base = links.get(rootName);
  const robot = new THREE.Group();
  robot.rotation.x = -Math.PI / 2; // URDF is Z-up; three.js is Y-up
  robot.add(base);
  const pivot = new THREE.Group();
  pivot.add(robot);

  // A faint round "table" under the arm, in the robot's frame so it turns with it.
  const table = new THREE.Group();
  const tableDisc = new THREE.Mesh(new THREE.CircleGeometry(0.4, 96), tableMaterial);
  const tableRim = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(
      Array.from({ length: 96 }, (_, i) => {
        const a = (i / 96) * Math.PI * 2;
        return new THREE.Vector3(Math.cos(a) * 0.4, Math.sin(a) * 0.4, 0);
      })
    ),
    inkMaterial
  );
  table.add(tableDisc, tableRim);
  table.position.z = -0.0005;
  robot.add(table);

  // The clay block.
  const block = outlined(new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE), accentMaterial);
  robot.add(block);
  // A spot = where the block rests and which way it faces (turned to match the
  // gripper's approach there, so the pads close flat on two faces).
  const placeBlock = (spot) => {
    robot.add(block);
    block.position.set(spot.x, spot.y, BLOCK_SIZE / 2);
    block.rotation.set(0, 0, spot.yaw);
  };

  // ---- Solve joint angles for each gripper position (simple pattern search) -----
  const ee = links.get(END_EFFECTOR);
  const baseInverse = new THREE.Matrix4();
  const eePos = new THREE.Vector3();
  const eeDir = new THREE.Vector3();
  const down = new THREE.Vector3(0, 0, -1);
  const forward = (q) => {
    setArm(q);
    robot.updateMatrixWorld(true);
    baseInverse.copy(base.matrixWorld).invert();
    eePos.setFromMatrixPosition(ee.matrixWorld).applyMatrix4(baseInverse);
    eeDir.set(1, 0, 0).transformDirection(ee.matrixWorld).transformDirection(baseInverse);
  };
  const solve = (target, start) => {
    const goal = new THREE.Vector3(...target);
    const cost = (q) => {
      forward(q);
      return eePos.distanceToSquared(goal) + 0.004 * eeDir.distanceToSquared(down);
    };
    const q = start.slice();
    let best = cost(q);
    for (let step = 0.25; step > 1e-4;) {
      let improved = false;
      for (let i = 0; i < q.length; i++) {
        const joint = joints.get(ARM_JOINTS[i]);
        for (const delta of [step, -step]) {
          const trial = q.slice();
          trial[i] = Math.min(joint.upper, Math.max(joint.lower, q[i] + delta));
          const c = cost(trial);
          if (c < best) {
            best = c;
            q[i] = trial[i];
            improved = true;
          }
        }
      }
      if (!improved) step *= 0.5;
    }
    return q;
  };

  const above = (xy) => [xy[0], xy[1], GRASP_HEIGHT + LIFT];
  const at = (xy) => [xy[0], xy[1], GRASP_HEIGHT];

  // Solve a straight line in space as a chain of poses, each seeded from the last,
  // so the gripper moves along the line instead of swinging in a joint-space arc.
  const line = (from, to, seed) => {
    const path = [];
    let q = seed;
    for (let i = 0; i <= PATH_SAMPLES; i++) {
      const t = i / PATH_SAMPLES;
      q = solve(
        from.map((v, k) => v + (to[k] - v) * t),
        q
      );
      path.push(q);
    }
    return path;
  };

  const qHome = solve(HOME, [0, 1.3, 1.7, 0.4, 0]);
  const eeSide = new THREE.Vector3();
  const makeSpot = (xy) => {
    const qAbove = solve(above(xy), qHome);
    const descent = line(above(xy), at(xy), qAbove);
    // Which way the pads close at the grasp pose → turn the block to face them.
    forward(descent.at(-1));
    eeSide.set(0, 1, 0).transformDirection(ee.matrixWorld).transformDirection(baseInverse);
    return { x: xy[0], y: xy[1], yaw: Math.atan2(-eeSide.x, eeSide.y), above: qAbove, down: descent, up: descent.slice().reverse() };
  };
  const spots = { A: makeSpot(SPOT_A), B: makeSpot(SPOT_B) };
  const across = {
    AB: line(above(SPOT_A), above(SPOT_B), spots.A.above),
    BA: line(above(SPOT_B), above(SPOT_A), spots.B.above),
  };
  const pose = { home: qHome, aboveA: spots.A.above, aboveB: spots.B.above, atA: spots.A.down.at(-1), atB: spots.B.down.at(-1) };

  // One trip: carry the block from `from` to `to`. Each step follows `path` (a list
  // of poses, starting where the previous step ended). Durations in ms.
  // `hold` = the block rides in the gripper; otherwise it rests on `rest`.
  const trip = (from, to) => {
    const a = spots[from];
    const b = spots[to];
    const grip = a.down.at(-1);
    const drop = b.down.at(-1);
    return [
      { path: [qHome, a.above], grip: GRIP_OPEN, ms: 1400, rest: a },
      { path: a.down, grip: GRIP_OPEN, ms: 1000, rest: a },
      { path: [grip, grip], grip: GRIP_CLOSED, ms: 450, rest: a },
      { path: a.up, grip: GRIP_CLOSED, ms: 1000, hold: true },
      { path: across[from + to], grip: GRIP_CLOSED, ms: 1600, hold: true },
      { path: b.down, grip: GRIP_CLOSED, ms: 1000, hold: true },
      { path: [drop, drop], grip: GRIP_OPEN, ms: 450, rest: b },
      { path: b.up, grip: GRIP_OPEN, ms: 900, rest: b },
      { path: [b.above, qHome], grip: GRIP_OPEN, ms: 1300, rest: b },
      { path: [qHome, qHome], grip: GRIP_OPEN, ms: 900, rest: b }, // pause
    ];
  };
  const routine = [...trip("A", "B"), ...trip("B", "A")];
  const routineMs = routine.reduce((sum, s) => sum + s.ms, 0);
  // Pose `k` (0..1) of the way along a step's path.
  const along = (path, k) => {
    const u = k * (path.length - 1);
    const i = Math.min(path.length - 2, Math.floor(u));
    const f = u - i;
    return path[i].map((v, j) => v + (path[i + 1][j] - v) * f);
  };

  // ---- Scene, lights, camera ------------------------------------------------------
  const scene = new THREE.Scene();
  scene.add(pivot);
  const hemi = new THREE.HemisphereLight();
  const key = new THREE.DirectionalLight("#ffffff", 1.6);
  scene.add(hemi, key, key.target);

  // Frame every pose the routine uses, around the turntable's vertical axis.
  const reach = new THREE.Box3();
  for (const q of Object.values(pose)) {
    setArm(q);
    pivot.updateMatrixWorld(true);
    reach.expandByObject(robot);
  }
  const radiusXZ = Math.max(Math.abs(reach.min.x), Math.abs(reach.max.x), Math.abs(reach.min.z), Math.abs(reach.max.z));
  // Aim a little below the middle of the reach box: the camera looks down from
  // above, so this centres the arm and table in the frame.
  const center = new THREE.Vector3(0, reach.min.y + (reach.max.y - reach.min.y) * 0.22, 0);
  const radius = Math.hypot(radiusXZ, (reach.max.y - reach.min.y) / 2);

  const camera = new THREE.PerspectiveCamera(30, 4 / 3, 0.01, 20);
  const distance = (radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 0.8;
  camera.position.copy(center).addScaledVector(new THREE.Vector3(1, 0.62, 1.05).normalize(), distance);
  camera.lookAt(center);
  key.position.copy(center).add(new THREE.Vector3(-1.2, 2.2, 1.6));
  key.target.position.copy(center);

  // Recording mode (used to make assets/img/nimble-arm.gif): `?wxai-capture=<port>`
  // renders the loop frame by frame and POSTs each PNG to a local server on <port>.
  const capturePort = new URLSearchParams(location.search).get("wxai-capture");
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: !!capturePort });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  const stage = document.createElement("div");
  stage.className = "wxai-stage";
  stage.appendChild(renderer.domElement);
  renderer.domElement.setAttribute("role", "img");
  renderer.domElement.setAttribute(
    "aria-label",
    "Animated 3D model of the Trossen WidowX AI robot arm turning slowly while it picks up a small block and sets it down."
  );

  const applyTheme = () => {
    const p = isDark() ? PALETTE.dark : PALETTE.light;
    bodyMaterial.color.set(p.body);
    accentMaterial.color.set(p.accent);
    inkMaterial.color.set(p.ink);
    inkMaterial.opacity = p.inkOpacity;
    tableMaterial.color.set(p.table);
    hemi.color.set(p.sky);
    hemi.groundColor.set(p.ground);
    hemi.intensity = isDark() ? 1.6 : 2.2;
  };
  applyTheme();

  // ---- Animation ------------------------------------------------------------------
  let holding = false;

  // Close the gripper on the block where it rests and attach it, so it keeps its
  // exact offset from the fingertips for the whole carry.
  const pickUp = (spot) => {
    setArm(spot.down.at(-1));
    setJoint(GRIPPER_JOINT, GRIP_CLOSED);
    placeBlock(spot);
    pivot.updateMatrixWorld(true);
    ee.attach(block);
  };

  // Pose for a moment in the routine. Whether the block is held is decided by the
  // current step alone, so skipped frames can never leave the block behind.
  const poseAt = (ms) => {
    const cycle = ms % routineMs;
    let t0 = 0;
    for (let i = 0; i < routine.length; i++) {
      const s = routine[i];
      if (cycle < t0 + s.ms) {
        const prev = routine[(i - 1 + routine.length) % routine.length];
        const k = easeInOut((cycle - t0) / s.ms);
        if (s.hold && !holding) {
          // Attach at the grip pose of the last resting step before this carry.
          // Walking back (rather than using `prev`) keeps this right even if
          // frames skipped straight into the middle of a carry.
          let g = i;
          while (routine[g].hold) g = (g - 1 + routine.length) % routine.length;
          pickUp(routine[g].rest);
          holding = true;
        } else if (!s.hold && holding) {
          holding = false;
        }
        if (!s.hold) placeBlock(s.rest);
        setArm(along(s.path, k));
        setJoint(GRIPPER_JOINT, prev.grip + (s.grip - prev.grip) * k);
        return;
      }
      t0 += s.ms;
    }
  };

  let running = false;
  let visible = false;
  let rafId = null;
  let startTime = null;
  let elapsed = 0; // animation clock that pauses while hidden

  placeBlock(spots.A);
  setArm(pose.home);
  setJoint(GRIPPER_JOINT, GRIP_OPEN);

  const frame = (now) => {
    rafId = null;
    if (!running) return;
    if (startTime === null) startTime = now - elapsed;
    elapsed = now - startTime;
    pivot.rotation.y = THREE.MathUtils.degToRad(TURNTABLE_DEG_PER_SEC) * (elapsed / 1000);
    poseAt(elapsed);
    renderer.render(scene, camera);
    rafId = requestAnimationFrame(frame);
  };
  const renderStill = () => renderer.render(scene, camera);

  const update = () => {
    const shouldRun = visible && !document.hidden && !prefersReducedMotion();
    if (shouldRun && !running) {
      running = true;
      startTime = null;
      rafId = requestAnimationFrame(frame);
    } else if (!shouldRun && running) {
      running = false;
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (!running) renderStill();
  };

  // Reduced motion: a single still frame, mid-task with the block in hand.
  if (prefersReducedMotion()) {
    pivot.rotation.y = THREE.MathUtils.degToRad(-20);
    pickUp(spots.A);
    setArm(along(across.AB, 0.5));
  }

  if (capturePort) {
    const FPS = Number(new URLSearchParams(location.search).get("wxai-fps")) || 15;
    const frames = Math.round((routineMs / 1000) * FPS);
    renderer.setPixelRatio(1);
    renderer.setSize(960, 720, false);
    renderer.setClearColor(PALETTE.light.sky, 1); // the card's ivory, so the GIF needs no transparency
    document.documentElement.setAttribute("data-theme", "light"); // always record the light palette
    applyTheme();
    camera.aspect = 4 / 3;
    camera.position.copy(center).addScaledVector(new THREE.Vector3(1, 0.62, 1.05).normalize(), distance * 1.08);
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    placeBlock(spots.A);
    for (let i = 0; i < frames; i++) {
      const ms = (i / frames) * routineMs;
      pivot.rotation.y = (i / frames) * Math.PI * 2; // one full turn per loop, so the GIF loops seamlessly
      poseAt(ms);
      renderer.render(scene, camera);
      const png = await new Promise((resolve) => renderer.domElement.toBlob(resolve, "image/png"));
      await fetch(`http://localhost:${capturePort}/frame/${i}`, { method: "POST", body: png });
    }
    await fetch(`http://localhost:${capturePort}/done/${frames}`, { method: "POST" });
    return;
  }

  const resize = () => {
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (!running) renderStill();
  };
  new ResizeObserver(resize).observe(stage);
  new MutationObserver(() => {
    applyTheme();
    if (!running) renderStill();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  document.addEventListener("visibilitychange", update);
  new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    update();
  }).observe(figure);

  // ---- Swap the still image for the live figure -----------------------------------
  const fallback = figure.querySelector("img");
  if (fallback) fallback.remove();
  figure.prepend(stage);
  figure.classList.add("is-live");
  resize();
  update();
}

function supportsWebGL() {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch (e) {
    return false;
  }
}

function init() {
  const figures = document.querySelectorAll("[data-wxai-viewer]");
  if (!figures.length || !supportsWebGL()) return;

  const start = (figure) => {
    figure.classList.add("is-loading");
    mount(figure)
      .catch((error) => console.warn("WidowX AI viewer could not load:", error))
      .finally(() => figure.classList.remove("is-loading"));
  };

  if (!("IntersectionObserver" in window)) {
    figures.forEach(start);
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        start(entry.target);
      }
    },
    { rootMargin: "200px" }
  );
  figures.forEach((figure) => observer.observe(figure));
}

init();
