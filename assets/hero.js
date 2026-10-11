// Home page hero: a dark street grid laid at Manhattan's real angle, with a
// Landmarkd pin dropping onto every real spot, like the app's opening
// animation. three.js comes from the import map in index.html.
//
// Degrades in steps: no WebGL means a still glow (.hero.flat), and Reduce
// Motion means the pins are already standing and nothing moves.
import * as THREE from 'three';

const SUPABASE_URL = 'https://qvmnthspckirkldfnvhs.supabase.co';
// Publishable key, the same one spot.html uses: pins are publicly readable.
const SUPABASE_KEY = 'sb_publishable_cI6-E6Qnx4NGlnegNndkaQ_Bvhq_Pos';
// Used if the fetch fails, so the hero never comes up empty (spots as of Oct 2026).
const FALLBACK = [
  [40.76777, -73.99132], [40.75778, -73.97091], [40.73584, -74.00664], [40.73546, -74.00374],
  [40.73348, -74.00303], [40.72886, -74.00081], [40.72464, -73.99619], [40.71955, -73.99549],
  [40.71912, -73.84489], [40.60269, -73.94266], [40.60073, -73.93004], [40.58367, -73.94258],
];

// Metres east / south of the West Village, which the camera circles.
const ORIGIN = { lat: 40.736, lng: -73.996 };
const M_PER_LAT = 110540;
const M_PER_LNG = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180);
const toXZ = (lat, lng) => [(lng - ORIGIN.lng) * M_PER_LNG, -(lat - ORIGIN.lat) * M_PER_LAT];

// Manhattan's street grid runs about 29 degrees east of true north.
const GRID_ANGLE = (-29 * Math.PI) / 180;
const PIN_H = 125; // world units (metres) tall
const PIN_W = PIN_H * (419 / 609);

const INK = new THREE.Color('#0d0d0c');
const YELLOW = new THREE.Color('#fad02b');

main();

async function main() {
  const hero = document.getElementById('hero');
  const canvas = document.getElementById('map');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
  } catch (e) {
    hero.classList.add('flat');
    canvas.remove();
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.background = INK;
  scene.fog = new THREE.Fog(INK, 1400, 5600);
  const camera = new THREE.PerspectiveCamera(36, 1, 10, 12000);

  scene.add(streetGrid());

  const pinTexture = await new THREE.TextureLoader().loadAsync('assets/pin-yellow.png');
  pinTexture.colorSpace = THREE.SRGBColorSpace;
  pinTexture.anisotropy = 4;

  const coords = (await fetchSpots()).map(([lat, lng]) => toXZ(lat, lng));
  // The camera circles the busiest patch of spots: the one with the most others
  // within 1.5 km (the West Village today), so the densest cluster sits in the
  // shot and outliers fall where they may.
  const neighbours = ([x, z]) => coords.filter(([u, v]) => Math.hypot(u - x, v - z) < 1500).length;
  const focus = coords.length ? coords.reduce((best, c) => (neighbours(c) > neighbours(best) ? c : best)) : [0, 0];
  scene.add(groundGlow(focus));
  const pins = coords
    // Nearest first, so the drop ripples outward from the camera's focus.
    .sort((a, b) => Math.hypot(a[0] - focus[0], a[1] - focus[1]) - Math.hypot(b[0] - focus[0], b[1] - focus[1]))
    .map(([x, z], i) => makePin(scene, pinTexture, x, z, 450 + i * 170));

  // ---- Framing: the pins sit right of the copy on wide screens, above it on phones.
  function resize() {
    const w = hero.clientWidth;
    const h = hero.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const wide = w > 860;
    camera.setViewOffset(w, h, wide ? -w * 0.2 : 0, wide ? h * 0.14 : h * 0.2, w, h);
    camera.updateProjectionMatrix();
    if (still) draw(1e6);
  }

  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  window.addEventListener('pointermove', (e) => {
    pointer.tx = (e.clientX / window.innerWidth - 0.5) * 2;
    pointer.ty = (e.clientY / window.innerHeight - 0.5) * 2;
  }, { passive: true });

  // ---- Drag to spin. Sideways drags turn the camera around the spots 1:1
  // with the finger; on release it keeps the flick's speed and coasts to a
  // stop on Apple's deceleration curve (rate per ms, as in UIScrollView).
  // touch-action: pan-y leaves vertical drags to page scrolling on phones.
  const SPIN_PER_PX = 0.004; // radians per pixel dragged
  const DECELERATION = 0.996; // per ms; UIScrollView uses 0.998, this stops a touch sooner
  const spin = { angle: 0, velocity: 0, dragging: false, lastX: 0, lastT: 0 };
  canvas.style.touchAction = 'pan-y';
  canvas.style.cursor = 'grab';
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    Object.assign(spin, { dragging: true, velocity: 0, lastX: e.clientX, lastT: e.timeStamp });
    canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!spin.dragging) return;
    const delta = -(e.clientX - spin.lastX) * SPIN_PER_PX;
    const dt = Math.max(e.timeStamp - spin.lastT, 1);
    spin.angle += delta;
    // Smoothed, so one jittery last event can't decide the flick.
    spin.velocity = spin.velocity * 0.3 + (delta / dt) * 0.7;
    Object.assign(spin, { lastX: e.clientX, lastT: e.timeStamp });
    if (still) draw(1e6);
  });
  const release = () => {
    if (!spin.dragging) return;
    spin.dragging = false;
    canvas.style.cursor = 'grab';
    if (still) spin.velocity = 0; // Reduce Motion: no coasting after you let go
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  const start = performance.now();
  let lastFrame = start;
  function draw(now) {
    const dt = Math.min(now - lastFrame, 50);
    lastFrame = now;
    if (!spin.dragging && spin.velocity) {
      spin.angle += spin.velocity * dt;
      spin.velocity *= DECELERATION ** dt;
      if (Math.abs(spin.velocity) < 1e-6) spin.velocity = 0;
    }
    const t = now - start;
    // Camera eases down from high above, then drifts gently side to side.
    const intro = still ? 1 : easeOutCubic(Math.min(t / 2600, 1));
    pointer.x += (pointer.tx - pointer.x) * 0.04;
    pointer.y += (pointer.ty - pointer.y) * 0.04;
    const angle = 1.2 + spin.angle + (still ? 0 : Math.sin(t / 9000) * 0.22) + pointer.x * 0.07;
    const radius = 2700 - intro * 550;
    const height = 2700 - intro * 1250 + pointer.y * 60;
    camera.position.set(focus[0] + Math.sin(angle) * radius, height, focus[1] + Math.cos(angle) * radius);
    camera.lookAt(focus[0], 0, focus[1]);
    for (const pin of pins) pin.update(still ? 1e6 : t);
    renderer.render(scene, camera);
  }

  window.addEventListener('resize', resize);
  resize();
  if (still) return;

  // Only animate while the hero is on screen.
  let visible = true;
  let frame = 0;
  const loop = (now) => { draw(now); frame = visible ? requestAnimationFrame(loop) : 0; };
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible && !frame) frame = requestAnimationFrame(loop);
  }).observe(hero);
  frame = requestAnimationFrame(loop);
}

async function fetchSpots() {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/pins?select=latitude,longitude`, {
      headers: { apikey: SUPABASE_KEY },
    });
    if (!res.ok) throw new Error(res.status);
    const rows = (await res.json())
      .filter((r) => typeof r.latitude === 'number' && typeof r.longitude === 'number')
      .map((r) => [r.latitude, r.longitude]);
    return rows.length ? rows : FALLBACK;
  } catch (e) {
    return FALLBACK;
  }
}

// Streets every ~80 m, avenues every ~260 m, turned to Manhattan's angle.
// Avenues are drawn brighter, as on a map.
function streetGrid() {
  const group = new THREE.Group();
  const extent = 7000;
  const lines = (spacing, along) => {
    const pts = [];
    for (let v = -extent; v <= extent; v += spacing) {
      if (along) pts.push(v, 0, -extent, v, 0, extent);
      else pts.push(-extent, 0, v, extent, 0, v);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return geo;
  };
  group.add(new THREE.LineSegments(lines(80, false), new THREE.LineBasicMaterial({ color: 0x24241f })));
  group.add(new THREE.LineSegments(lines(260, true), new THREE.LineBasicMaterial({ color: 0x3b3b33 })));
  group.rotation.y = GRID_ANGLE;
  return group;
}

// A faint yellow warmth on the ground where the spots are.
function groundGlow([x, z]) {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(250,208,43,0.32)');
  grad.addColorStop(1, 'rgba(250,208,43,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(3600, 3600),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, 0.5, z);
  return mesh;
}

// One pin: falls from the sky, bounces once, and sends a ring out across the
// ground when it lands. update(t) sets it for t ms since the page started.
function makePin(scene, texture, x, z, delay) {
  const FALL = 720;
  const BOUNCE = 150;
  const RING = 1300;

  // No fog on the pins: they're the subject, and fog turned the far ones olive.
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthWrite: false, fog: false }));
  sprite.center.set(0.5, 0.02); // the tip sits on the ground
  sprite.scale.set(PIN_W, PIN_H, 1);
  sprite.position.set(x, 900, z);
  scene.add(sprite);

  const flat = (geo, opacity) => {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: YELLOW, transparent: true, opacity, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 1, z);
    scene.add(m);
    return m;
  };
  const dot = flat(new THREE.CircleGeometry(9, 24), 0);
  const ring = flat(new THREE.RingGeometry(11, 14, 48), 0);

  return {
    update(t) {
      const local = t - delay;
      sprite.visible = local > 0;
      if (local <= 0) return;
      let y = 0;
      if (local < FALL) {
        const p = local / FALL;
        y = 900 * (1 - p * p);
      } else if (local < FALL + BOUNCE * 2) {
        const p = (local - FALL) / BOUNCE;
        y = p < 1 ? 46 * easeOutQuad(p) : 46 * (1 - easeInQuad(p - 1));
      }
      sprite.position.y = y;
      const landed = local - FALL;
      dot.material.opacity = landed > 0 ? Math.min(landed / 400, 1) * 0.55 : 0;
      if (landed > 0 && landed < RING) {
        const p = landed / RING;
        ring.scale.setScalar(1 + easeOutCubic(p) * 7);
        ring.material.opacity = 0.85 * (1 - p);
      } else {
        ring.material.opacity = 0;
      }
    },
  };
}

function easeOutCubic(p) { return 1 - (1 - p) ** 3; }
function easeOutQuad(p) { return 1 - (1 - p) * (1 - p); }
function easeInQuad(p) { return p * p; }
