(function(){
// ----------------- Setup Paper -----------------
const canvas = document.getElementById('c');
if (!canvas) { console.error('Canvas #c not found'); return; }
canvas.width = window.innerWidth; //moet 4k worden bij record
canvas.height = window.innerHeight;  //moet 4k worden bij record
paper.setup(canvas);
const { Path, Point, view, project, SymbolDefinition, Tool } = paper;
const tool = new Tool();

// ----------------- Import multiple bolts as Symbols (from /src) -----------------
const BOLT_FILES = ['S.svg','E.svg','C.svg','T.svg','I.svg','E.svg','-.svg','C-inverted.svg'].map(f => `./src/${f}`);
const symbols = [];
let bolts = [];
let ready = false;

// ----------------- Params -----------------
const N = BOLT_FILES.length;
const W = view.bounds.width;
const H = view.bounds.height;
const centerX = W/2;
const centerY = H/2;
const SCALE = 0.75;
const BASE_SPACING = 110;
const SPACING = BASE_SPACING * SCALE;
const JITTER_MAX_DEG = 50;
const END_JITTER_MAX_DEG = 7;

// Mid-animation rotation (driven by jitter slider): ramp in, then click off
const MIDJIT_ENABLE   = true;   // master toggle
const MIDJIT_IN_START = 0.10;   // tween t waar extra rotatie begint (0..1)
const MIDJIT_IN_END   = 0.90;   // tween t waar maximale extra rotatie is bereikt
const MIDJIT_CLICK_T  = 0.94;   // vanaf deze t valt extra rotatie weg (klik naar base)

let currentPoseId = 1;
let lineRotDeg = 0;
let circleRotDeg = 0;
let linePendingSteps = 0;
let circlePendingSteps = 0;
const CIRCLE_FRACTION = 0.8;

let arrowRotDeg = 0;
let arrowPendingSteps = 0;
const ROT_DUR_LINE   = 0.2;
const ROT_DUR_CIRCLE = 0.2;
const ROT_DUR_ARROW  = 0.2;

let POSE_DUR = 0.5;

// --- Global easing for pose transitions ---
const EASE_MODES = ['trapezoid','power2','power3','expo','sine','back'];
let EASE_MODE = 'power3'; // change to one of EASE_MODES

// --- Servo feel parameters ---
const ENABLE_BACKLASH = false;
const BACKLASH_GAIN = 1;

// --- Clockwork stepping (discrete tween states) ---
// Position stepping
const ENABLE_STEPPED_TIME = true;
const STEP_COUNT          = 3;
const STEP_JITTER         = 0.5;

// Rotation stepping (independent from position)
const ENABLE_STEPPED_ROT  = true;
const ROT_STEP_COUNT      = 3;
const ROT_STEP_JITTER     = 1;

const _dashIdx = BOLT_FILES.findIndex(p => p.includes('/-.svg'));
const DASH_INDEX = _dashIdx >= 0 ? _dashIdx : 6; // hardcoded fallback

// Derive a logical key from the file path
function keyFromPath(p){
    const f = (p || '').split('/').pop() || '';
    if (f === '-.svg') return '-';
    return f.replace(/\.svg$/,''); // 'S','E','C','T','I','E','C-inverted'
}

// Track a direct reference to the dash item regardless of array index
let dashItem = null;

let jitterAmt = 0;        // 0..1 from the slider
let jitterAngles = new Array(N).fill(0).map(() => (Math.random()*2 - 1)); // per-bolt direction [-1,1]
let endJitterDeg = new Array(N).fill(0); // per-bolt end-state rotation jitter

const jitterEl = document.getElementById('jitter');
const jitterValEl = document.getElementById('jitterVal');
if (jitterEl){
    const upd = () => {
        jitterAmt = Number(jitterEl.value) / 100; // 0..1
        if (jitterValEl) jitterValEl.textContent = Math.round(jitterAmt*100) + '%';
    };
    jitterEl.addEventListener('input', upd);
    upd();
}

function importSymbol(url){
    return new Promise((resolve, reject) => {
    project.importSVG(url, {
        expandShapes: true,
        insert: false,
        onLoad: (imported) => {
            imported.pivot = imported.bounds.center;
            imported.position = new Point(0,0);
            const def = new SymbolDefinition(imported);
            imported.remove();
            resolve(def);
        },
        onError: (msg) => reject(new Error(`${url}: ${msg}`))
    });
    });
}

Promise.all(BOLT_FILES.map(importSymbol))
    .then(defs => {
    symbols.push(...defs);
    bolts = symbols.map((def, idx) => {
        const it = def.place([W*0.5, H*0.5]);
        it.applyMatrix = true;
        it.scaling = SCALE;
        it.data = it.data || {};
        it.data.file = BOLT_FILES[idx];
        it.data.key  = keyFromPath(BOLT_FILES[idx]);
        return it;
    });
    dashItem = bolts.find(b => b && b.data && b.data.key === '-') || null;
    setTargets(poseLine());
    ready = true;
    })
    .catch(err => console.error('importSVG error:', err));

// ----------------- Helpers -----------------
function makeLinePath(x1, y1, x2, y2){
    return new Path({ segments: [[x1,y1],[x2,y2]], strokeColor:null });
}
function makeArcPath(cx, cy, r, startDeg, endDeg){
    const p = new Path({ strokeColor:null });
    const steps = 40;
    for (let i=0;i<=steps;i++){
    const t = i/steps;
    const a = (startDeg + (endDeg - startDeg)*t) * Math.PI/180;
    p.add(new Point(cx + Math.cos(a)*r, cy + Math.sin(a)*r));
    }
    p.smooth({type:'continuous'});
    return p;
}
function makePolylineSharp(points){
    const p = new Path({ strokeColor: null });
    points.forEach(pt => p.add(new Point(pt[0], pt[1])));
    return p;
}

// Verdeel N items over 1..k paden, proportioneel op lengte
function distributeOnPaths(paths, count, align='upright'){
    const lengths = paths.map(p => p.length);
    const total = lengths.reduce((a,b)=>a+b, 0);
    const targets = [];
    for (let i=0;i<count;i++){
        const t = (i + 0.5) / count;
        let s = t * total;
        let pathIndex = 0;
        while (s > lengths[pathIndex] && pathIndex < paths.length-1){
            s -= lengths[pathIndex];
            pathIndex++;
        }
        const path = paths[pathIndex];
        const offset = Math.min(Math.max(0, s), path.length);
        const pt = path.getPointAt(offset);
        const tan = path.getTangentAt(offset) || new Point(1,0);
        const rot = (align === 'tangent') ? tan.angle
                    : (align === 'fixed0') ? 0
                    : 0;
        const centeredPt = pt.add(new Point(centerX, centerY));
        targets.push({ pos: centeredPt, rot });
    }
    return targets;
}
function distributeOnSinglePathWithSpacing(path, count, spacing, align='upright'){
    const targets = [];
    for (let i=0; i<count; i++){
        const o = i * spacing;
        const off = Math.min(o, path.length);
        const pt = path.getPointAt(off);
        const tan = path.getTangentAt(off) || new Point(1,0);
        const rot = (align === 'tangent') ? tan.angle
                : (align === 'fixed0') ? 0
                : 0;
        const centeredPt = pt.add(new Point(centerX, centerY));
        targets.push({ pos: centeredPt, rot });
    }
    return targets;
}

// Interpoleer huidige -> target (met GSAP-driver)
const interp = { t: 1 };     // 0..1
let fromPose = [];
let toPose   = [];
let lastBaseRot = new Array(N).fill(0); // store rotation before jitter is applied

let isAnimating = false;
let pendingPoseId = null; // last requested pose while animating
let poseTween = null;     // gsap tween handle for interp

// --- Recording sizing (4k) ---
let isRecording = false;
let origCanvasW = canvas.width;
let origCanvasH = canvas.height;
let origZoom    = view.zoom;
let origCenter  = view.center.clone();
let origViewSize = view.viewSize.clone();

function setCanvasPixelSize(w, h){
    canvas.width = w;
    canvas.height = h;
    view.viewSize = new paper.Size(w, h);
}

function applyRecordSizing(targetW = 4096, targetH = 4096){
    if (isRecording) return;
    // remember original
    origCanvasW = canvas.width;
    origCanvasH = canvas.height;
    origZoom    = view.zoom;
    origCenter  = view.center.clone();
    origViewSize= view.viewSize.clone();

    // Compute CSS (display) size and upscale backing store keeping aspect ratio
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(1, Math.round(rect.width));
    const cssH = Math.max(1, Math.round(rect.height));
    const targetMax = Math.max(targetW, targetH); // e.g. 4096
    const scale = Math.max(1, targetMax / Math.max(cssW, cssH));
    const newW = Math.round(cssW * scale);
    const newH = Math.round(cssH * scale);

    // Increase drawing buffer without changing world coordinates
    setCanvasPixelSize(newW, newH);
    view.viewSize = new paper.Size(cssW, cssH);
    view.zoom = origZoom;
    view.center = origCenter;
    view.update();
    isRecording = true;
}

function restoreInteractiveSizing(){
    if (!isRecording) return;
    // restore view state first
    view.zoom = origZoom;
    view.center = origCenter;
    view.viewSize = origViewSize;
    // restore canvas size
    setCanvasPixelSize(origCanvasW, origCanvasH);
    view.update();
    isRecording = false;
}

function consumeLineQueueIfNeeded(){
    if (currentPoseId !== 1) return false;
    const pending = linePendingSteps;
    if (!pending) return false;
    const dir = Math.sign(pending);       // take one step toward zero
    linePendingSteps -= dir;
    const step = 45;
    lineRotDeg = (lineRotDeg - dir * step) % 360; // negative keeps scroll natural
    if (lineRotDeg < 0) lineRotDeg += 360;
    setTargets(poseLine(), ROT_DUR_LINE);         // kick off a single tween step
    return true;
}
function consumeCircleQueueIfNeeded(){
    if (currentPoseId !== 5) return false;
    const pending = circlePendingSteps;
    if (!pending) return false;
    const dir = Math.sign(pending);     // neem 1 stap richting 0
    circlePendingSteps -= dir;
    const step = 36;
    circleRotDeg = (circleRotDeg - dir * step) % 360; // negative keeps scroll natural
    if (circleRotDeg < 0) circleRotDeg += 360;
    setTargets(poseCircle(), ROT_DUR_CIRCLE);     // kleine tween per stap
    return true;
}
function consumeArrowQueueIfNeeded(){
    if (currentPoseId !== 6) return false;
    const pending = arrowPendingSteps;
    if (!pending) return false;
    const dir = Math.sign(pending);
    arrowPendingSteps -= dir;
    const step = 45;
    arrowRotDeg = (arrowRotDeg - dir * step) % 360; // negative keeps scroll natural
    if (arrowRotDeg < 0) arrowRotDeg += 360;
    setTargets(poseArrowRight(), ROT_DUR_ARROW);
    return true;
}

function _startPoseTween(dur, onComplete){
  if (poseTween) poseTween.kill();
  if (EASE_MODE === 'trapezoid'){
    const accel  = dur * 0.35;
    const cruise = dur * 0.30;
    const decel  = dur * 0.35;
    const tl = gsap.timeline({ onComplete });
    poseTween = tl
      .to(interp, { t: 0.6, duration: accel,  ease: 'power2.in'  })
      .to(interp, { t: 0.9, duration: cruise, ease: 'none'        })
      .to(interp, { t: 1.0, duration: decel,  ease: 'power2.out'  });
  } else {
    // map to GSAP ease strings
    const map = {
      power2: 'power2.inOut',
      power3: 'power3.inOut',
      expo:   'expo.inOut',
      sine:   'sine.inOut',
      back:   'back.inOut(1.1)'
    };
    const easeStr = map[EASE_MODE] || 'power2.inOut';
    poseTween = gsap.to(interp, { duration: dur, t: 1, ease: easeStr, onComplete });
  }
}

function setTargets(targets, dur = 0.8){
    if (!bolts.length) return;
    fromPose = bolts.map((it, i) => ({ pos: it.position.clone(), rot: lastBaseRot[i] || 0 }));
    toPose   = targets;
    // Generate fresh end-state jitter for this pose
    endJitterDeg = endJitterDeg.map(() => (Math.random() * 2 - 1) * END_JITTER_MAX_DEG); // uniform in [-7, +7]
    interp.t = 0;
    if (poseTween) poseTween.kill();
    isAnimating = true;
    _startPoseTween(dur, () => {
      isAnimating = false;
      poseTween = null;
      if (consumeLineQueueIfNeeded() || consumeCircleQueueIfNeeded() || consumeArrowQueueIfNeeded()) return;
      if (pendingPoseId !== null) {
        const id = pendingPoseId;
        pendingPoseId = null;
        switchPose(id);
      }
    });
}

function applyVisibilityForPose(poseId){
    if (!bolts.length) return;
    for (let i = 0; i < bolts.length; i++) bolts[i].visible = true;
    if (poseId === 6) {
        const d = dashItem || bolts[DASH_INDEX];
        if (d) d.visible = false;
    }
}

function applyPose() {
    const tGlobal = interp.t;
    for (let i = 0; i < bolts.length; i++){
        const a = fromPose[i] || { pos: new Point(W*0.5,H*0.5), rot: 0 };
        const b = toPose[i]   || a;

        const tLocal = tGlobal;

        // clockwork stepping: quantize POSITION and ROTATION time independently
        let tPosUsed = tLocal;
        if (ENABLE_STEPPED_TIME) {
            const stepSize = 1 / Math.max(1, STEP_COUNT);
            // deterministic per-bolt phase (based on jitterAngles) to avoid flicker
            const phaseJ = STEP_JITTER ? ((jitterAngles[i] || 0) * 0.5 * STEP_JITTER * stepSize) : 0;
            const tt = Math.min(1, Math.max(0, tLocal + phaseJ));
            const k  = Math.floor(tt / stepSize + 1e-6);
            tPosUsed = Math.min(1, k * stepSize - phaseJ);
        }

        let tRotUsed = tLocal;
        if (ENABLE_STEPPED_ROT) {
            const stepSizeR = 1 / Math.max(1, ROT_STEP_COUNT);
            const phaseJR = ROT_STEP_JITTER ? ((jitterAngles[i] || 0) * 0.5 * ROT_STEP_JITTER * stepSizeR) : 0;
            const ttr = Math.min(1, Math.max(0, tLocal + phaseJR));
            const kr  = Math.floor(ttr / stepSizeR + 1e-6);
            tRotUsed  = Math.min(1, kr * stepSizeR - phaseJR);
        }

        // base interpolation using stepped times
        const p = a.pos.add( b.pos.subtract(a.pos).multiply(tPosUsed) );
        let rBase = a.rot + (b.rot - a.rot) * tRotUsed; // base rotation without jitter

        // optional tiny settle/backlash near the very end (servo vibe)
        if (ENABLE_BACKLASH && tRotUsed > 0.98) {
            const signRot = Math.sign((b.rot || 0) - (a.rot || 0)) || 0;
            const settle = (1 - tRotUsed) * BACKLASH_GAIN; // fades to 0 at end
            rBase += settle * signRot;                  // few tenths of a degree max
        }

        lastBaseRot[i] = rBase;

        // mini gravity snap for position near the end
        let posFinal = p;
        if (tPosUsed > 0.97) {
            const snapVec = b.pos.subtract(p).multiply(0.3); // pull 30% toward target
            posFinal = p.add(snapVec);
        }
        bolts[i].position = posFinal;

        // mini gravity snap for rotation near the end
        let rotFinal = rBase;
        if (tRotUsed > 0.97) {
            const rotDiff = (b.rot || 0) - rBase;
            rotFinal = rBase + rotDiff * 0.9; // pull 30% toward target rot
        }

        // mid-animation additive rotation driven by jitter slider: ramp in, then click off near the end
        let addDeg = 0;
        if (MIDJIT_ENABLE) {
            if (tGlobal < MIDJIT_CLICK_T) {
                const denom = Math.max(1e-6, MIDJIT_IN_END - MIDJIT_IN_START);
                const u = (tGlobal - MIDJIT_IN_START) / denom; // kan <0..>1 zijn
                const s = u <= 0 ? 0 : (u >= 1 ? 1 : (u*u*(3 - 2*u))); // smoothstep 0..1
                addDeg = s * jitterAmt * JITTER_MAX_DEG * (jitterAngles[i] || 0);
            } else {
                addDeg = 0; // "klik" terug naar basis
            }
        }
        bolts[i].rotation = rotFinal + addDeg;

        // --- hard snap to final pose at the very end (keep small end jitter) ---
        if (interp.t >= 1) {
            bolts[i].position = b.pos.clone();
            // keep a tiny random misalignment at rest
            const ej = endJitterDeg[i] || 0;
            bolts[i].rotation = b.rot + ej;
            lastBaseRot[i] = b.rot + ej;
        }
    }
}

    // ----------------- Define Poses -----------------
    function poseLine(){
        const totalLength = SPACING * (N - 1);
        const half = totalLength / 2;
        const a = lineRotDeg * Math.PI / 180;
        const cos = Math.cos(a), sin = Math.sin(a);
        // endpoints of a centered line rotated by lineRotDeg
        const x1 = -half * cos, y1 = -half * sin;
        const x2 =  half * cos, y2 =  half * sin;
        const p = makeLinePath(x1, y1, x2, y2);
        const targets = distributeOnSinglePathWithSpacing(p, N, SPACING, 'upright');
        p.remove();
        return targets;
    }
    function poseOffsetLine(){
        const totalLength = SPACING * (N - 1);
        const xStart = -totalLength / 2 * 0.85;
        const OFF = SPACING * 0.25;
        const targets = [];
        for (let i = 0; i < N; i++) {
            const x = xStart + i * SPACING*0.85;
            const y = (i % 2 === 0 ? -OFF : OFF);
            const pos = new Point(centerX + x, centerY + y);
            targets.push({ pos, rot: 0 }); // keep upright; jitter handles slight variation
        }
        return targets;
    }
    function poseArcUp(){
        const baseR = Math.min(W, H) * 0.28 * SCALE;
        const rx = baseR * 1.4;
        const ry = baseR * 0.9;
        const startAngle = 200;
        const endAngle = -20;

        const p = new Path({ strokeColor: null });
        const steps = 40;
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const a = (startAngle + (endAngle - startAngle) * t) * Math.PI / 180;
            p.add(new Point(Math.cos(a) * rx, Math.sin(a) * ry));
        }
        p.smooth({ type: 'continuous' });

        const targets = distributeOnPaths([p], N, 'upright');
        p.remove();
        return targets;
    }
    function poseArcDown(){
        const baseR = Math.min(W, H) * 0.28 * SCALE;
        const rx = baseR * 1.4;
        const ry = baseR * -0.9;
        const startAngle = 200;
        const endAngle = -20;

        const p = new Path({ strokeColor: null });
        const steps = 40;
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const a = (startAngle + (endAngle - startAngle) * t) * Math.PI / 180;
            p.add(new Point(Math.cos(a) * rx, Math.sin(a) * ry));
        }
        p.smooth({ type: 'continuous' });

        const targets = distributeOnPaths([p], N, 'upright');
        p.remove();
        return targets;
    }
    function poseCircle(){
        const r = Math.min(W,H) * 0.25 * SCALE;
        const sweep = 360 * CIRCLE_FRACTION;
        const startAngle = circleRotDeg - sweep/2;
        const endAngle   = circleRotDeg + sweep/2;
        const p = makeArcPath(0, 0, r, startAngle, endAngle);
        const targets = distributeOnPaths([p], N, 'upright');
        p.remove();
        return targets;
    }
    function poseArrowRight(){
        const halfH = Math.min(W, H) * 0.33 * SCALE; // vertical half-height
        const halfW = halfH * 0.6;                    // narrower horizontal half-width

        const basePts = [
            [-halfW, -halfH],
            [ halfW,   0     ],
            [-halfW,  halfH]
        ];

        // rotate by arrowRotDeg around origin (rotate the path, not the SVGs)
        const a = arrowRotDeg * Math.PI / 180;
        const c = Math.cos(a), s = Math.sin(a);
        const pts = basePts.map(([x,y]) => [x*c - y*s, x*s + y*c]);

        const p = makePolylineSharp(pts);

        // Distribute N-1 items (exclude dash) so spacing stays tight
        const count = Math.max(0, N - 1);
        const targetsShort = distributeOnPaths([p], count, 'upright');
        p.remove();

        // Map back to full list while skipping the dash dynamically
        const dashIdxDyn = bolts.findIndex(b => b && b.data && b.data.key === '-');
        const targets = new Array(N);
        let k = 0;
        for (let i = 0; i < N; i++) {
            if (i === dashIdxDyn) continue; // skip dash
            targets[i] = targetsShort[k++];
        }
        if (dashIdxDyn >= 0 && dashIdxDyn < N) {
            targets[dashIdxDyn] = { pos: new Point(centerX, centerY), rot: 0 };
        }
        return targets;
    }
    
    function poseCross(){
        const offsets = [
          new Point(0, -2*SPACING + SPACING/4),
          new Point(0, -1*SPACING + SPACING/4),
          new Point(-2*SPACING + SPACING/4, 0),
          new Point(-1*SPACING + SPACING/4, 0),
          new Point( 1*SPACING - SPACING/4, 0),
          new Point( 2*SPACING - SPACING/4, 0),
          new Point(0,  1*SPACING - SPACING/4),
          new Point(0,  2*SPACING - SPACING/4)
        ];
        const cx = centerX, cy = centerY;
        const targets = offsets.slice(0, N).map(off => ({
            pos: off.add(new Point(cx, cy)),
            rot: 0
        }));
        return targets;
    }
    
    function poseX(){
        const s = SPACING;
        const r2 = Math.SQRT2;

        const offsets = [
            new Point(-2*s/r2, -2*s/r2),
            new Point(-s/r2,  -s/r2),
            new Point(-2*s/r2,  2*s/r2),
            new Point(-s/r2,   s/r2),
            new Point(s/r2,   -s/r2),
            new Point(2*s/r2, -2*s/r2),
            new Point(s/r2,    s/r2),
            new Point(2*s/r2,  2*s/r2)
        ];

        const cx = centerX, cy = centerY;
        const targets = offsets.slice(0, N).map(off => ({
            pos: off.add(new Point(cx, cy)),
            rot: 0
        }));
        return targets;
    }

    // ----------------- Keyboard -----------------
    function switchPose(id){
        if (isAnimating) {
          pendingPoseId = id;
          return;
        }
        currentPoseId = id;
        let targets;
        switch (id) {
          case 1: targets = poseLine(); break;
          case 2: targets = poseOffsetLine(); break;
          case 3: targets = poseArcUp(); break;
          case 4: targets = poseArcDown(); break;
          case 5: targets = poseCircle(); break;
          case 6: targets = poseArrowRight(); break;
          case 7: targets = poseCross(); break;
          case 8: targets = poseX(); break;
          default: break;
        }
        if (targets) setTargets(targets, POSE_DUR);
        applyVisibilityForPose(id);
    }

    tool.onKeyDown = function(e){
        const n = parseInt(e.key, 10);
        if (n>=1 && n<=9) switchPose(n);
        // Quick adjust pose duration with [ and ]
        if (e.key === '[') { POSE_DUR = Math.max(0.1, +(POSE_DUR - 0.1).toFixed(2)); }
        if (e.key === ']') { POSE_DUR = Math.min(3.0, +(POSE_DUR + 0.1).toFixed(2)); }
        // Cycle global easing with 'e'
        if (e.key === 'e') {
          const idx = (EASE_MODES.indexOf(EASE_MODE) + 1) % EASE_MODES.length;
          EASE_MODE = EASE_MODES[idx];
        }
    };

    canvas.addEventListener('wheel', (e) => {
        if (!ready) return;
        const delta = e.deltaY || 0;
        if (currentPoseId === 1) {
            e.preventDefault();
            const dir = Math.sign(delta);
            if (dir !== 0) {
                linePendingSteps += dir;
                if (!isAnimating) consumeLineQueueIfNeeded();
            }
            return;
        }
        if (currentPoseId === 5) {
            e.preventDefault();
            const dir = Math.sign(delta);
            if (dir !== 0) {
                circlePendingSteps += dir;
                if (!isAnimating) consumeCircleQueueIfNeeded();
            }
            return;
        }
        if (currentPoseId === 6) {
            e.preventDefault();
            const dir = Math.sign(delta);
            if (dir !== 0) {
                arrowPendingSteps += dir;
                if (!isAnimating) consumeArrowQueueIfNeeded();
            }
            return;
        }
    }, { passive: false });

    (function bindShortcutClicks(){
        const nodes = document.querySelectorAll('#shortcuts .kbd');
        if (!nodes || !nodes.length) return;
        nodes.forEach(el => {
            el.style.cursor = 'pointer';
            el.addEventListener('click', () => {
                const attr = el.getAttribute('data-key');
                const key = attr ? parseInt(attr, 10) : parseInt((el.textContent||'').trim(), 10);
                if (!isNaN(key)) {
                    switchPose(key);
                }
            });
        });
    })();

    // Recording: switch main canvas drawing buffer up and back down
    window.addEventListener('recorder:start', (e) => {
        const d = (e && e.detail) || {};
        const tw = Number(d && d.targetW) || 4096;
        const th = Number(d && d.targetH) || 4096;
        applyRecordSizing(tw, th);
    });
    window.addEventListener('recorder:stop', () => {
        restoreInteractiveSizing();
    });

    // --- Arrange button: enforce left-to-right letter order for current pose ---
    function targetsForPose(id){
        switch (id) {
            case 1: return poseLine();
            case 2: return poseOffsetLine();
            case 3: return poseArcUp();
            case 4: return poseArcDown();
            case 5: return poseCircle();
            case 6: return poseArrowRight();
            case 7: return poseCross();
            case 8: return poseX();
        }
        return null;
    }

    function rearrangeBoltsLeftToRight(){
        if (!ready || !bolts || bolts.length !== N) return;

        // Compute current targets and left→right slot order
        const tgs = targetsForPose(currentPoseId);
        if (!tgs) return;
        const slotOrderL2R = Array.from({length: N}, (_, i) => i)
            .sort((i, j) => (tgs[i].pos.x - tgs[j].pos.x));

        // Desired letter order from filenames
        const desiredKeys = BOLT_FILES.map(keyFromPath);
        const indicesByKey = new Map();
        for (let i = 0; i < bolts.length; i++){
            const key = (bolts[i].data && bolts[i].data.key) || '';
            if (!indicesByKey.has(key)) indicesByKey.set(key, []);
            indicesByKey.get(key).push(i);
        }
        const taken = new Set();
        const boltIdxByKeyOrder = [];
        for (const key of desiredKeys){
            const list = indicesByKey.get(key) || [];
            const idx = list.find(j => !taken.has(j));
            if (typeof idx === 'number') { taken.add(idx); boltIdxByKeyOrder.push(idx); }
        }
        for (let i = 0; i < bolts.length; i++) if (!taken.has(i)) boltIdxByKeyOrder.push(i);
        if (boltIdxByKeyOrder.length !== N) return;

        // Map each left→right slot to the corresponding letter bolt
        const newOrder = new Array(N);
        for (let i = 0; i < N; i++){
            const slotIdx = slotOrderL2R[i];
            newOrder[slotIdx] = boltIdxByKeyOrder[i];
        }

        // Reorder bolts and per-bolt state arrays
        const reorderedBolts = newOrder.map(i => bolts[i]);
        const reorderedJitterAngles = newOrder.map(i => jitterAngles[i]);
        const reorderedLastBaseRot  = newOrder.map(i => lastBaseRot[i]);
        const reorderedEndJitter    = newOrder.map(i => endJitterDeg[i]);

        bolts = reorderedBolts;
        jitterAngles = reorderedJitterAngles;
        lastBaseRot = reorderedLastBaseRot;
        endJitterDeg = reorderedEndJitter;

        // Refresh dash reference and re-apply visibility if needed
        dashItem = bolts.find(b => b && b.data && b.data.key === '-') || null;

        setTargets(tgs, 0.5);
        applyVisibilityForPose(currentPoseId);
    }

    const arrangeBtn = document.getElementById('arrange-ltr');
    if (arrangeBtn){
        arrangeBtn.addEventListener('click', () => {
            rearrangeBoltsLeftToRight();
        });
    }

    // ----------------- Animate loop -----------------
    view.onFrame = function(){
        if (!ready) return;
        applyPose();
    };
})();
