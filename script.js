(function(){
// ----------------- Setup Paper -----------------
const canvas = document.getElementById('c');
if (!canvas) { console.error('Canvas #c not found'); return; }
canvas.width = window.innerWidth;
canvas.height = window.innerHeight; 
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
const JITTER_MAX_DEG = 25;

let CIRCLE_ROT = 0;
let currentPoseId = 1;
let lineRotDeg = 0; // rotation of the line pose in degrees
let circleRotDeg = 0;
let linePendingSteps = 0;
let circlePendingSteps = 0;
const CIRCLE_FRACTION = 0.75;

let arrowRotDeg = 0;
let arrowPendingSteps = 0;
const ROT_DUR_LINE   = 0.20;
const ROT_DUR_CIRCLE = 0.20;
const ROT_DUR_ARROW  = 0.20;

// Pose transition duration (used when switching poses)
let POSE_DUR = 0.6; // seconds

// --- Servo feel parameters ---
const ENABLE_BACKLASH = true; // set true for tiny settle effect near the end
const BACKLASH_GAIN = 0.3;     // strength of settle if enabled

// --- Clockwork stepping (discrete tween states) ---
// Position stepping
const ENABLE_STEPPED_TIME = true;  // quantize POSITION tween time into ticks
const STEP_COUNT          = 16;     // ticks per move for position
const STEP_JITTER         = 0.4;  // 0..0.5 of a step as per-bolt phase jitter

// Rotation stepping (independent from position)
const ENABLE_STEPPED_ROT  = true;  // quantize ROTATION tween time into ticks
const ROT_STEP_COUNT      = 3;     // ticks per move for rotation
const ROT_STEP_JITTER     = 0.1;  // 0..0.5 per-bolt phase jitter for rotation

const DASH_INDEX = BOLT_FILES.findIndex(p => p.includes('/-.svg')) >= 0
    ? BOLT_FILES.findIndex(p => p.includes('/-.svg'))
    : 6; // hardcoded fallback

let jitterAmt = 0;        // 0..1 from the slider
let jitterAngles = new Array(N).fill(0).map(() => (Math.random()*2 - 1)); // per-bolt direction [-1,1]

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
    bolts = symbols.map(def => {
        const it = def.place([W*0.5, H*0.5]);
        it.applyMatrix = true;
        it.scaling = SCALE;
        return it;
    });
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
    return p; // no smoothing -> crisp chevron
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
    const o = Math.min(s, path.length);
    const pt = path.getPointAt(o);
    const tan = path.getTangentAt(o) || new Point(1,0);
    const rot = (align === 'tangent') ? tan.angle
                : (align === 'fixed0') ? 0
                : 0; // 'upright' default (0°)
    // center everything once here (no per-pose translate calls)
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
    const step = 45;
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
    const step = 90;
    arrowRotDeg = (arrowRotDeg - dir * step) % 360; // negative keeps scroll natural
    if (arrowRotDeg < 0) arrowRotDeg += 360;
    setTargets(poseArrowRight(), ROT_DUR_ARROW);
    return true;
}

function setTargets(targets, dur = 0.8){
    if (!bolts.length) return;
    fromPose = bolts.map((it, i) => ({ pos: it.position.clone(), rot: lastBaseRot[i] || 0 }));
    toPose   = targets;
    interp.t = 0;
    if (poseTween) poseTween.kill();
    isAnimating = true;

    const accel  = dur * 0.35; // accelerate fast
    const cruise = dur * 0.30; // flat speed
    const decel  = dur * 0.35; // smooth brake

    const tl = gsap.timeline({
    onComplete: () => {
        isAnimating = false;
        poseTween = null;
        if (consumeLineQueueIfNeeded() || consumeCircleQueueIfNeeded() || consumeArrowQueueIfNeeded()) return;
        if (pendingPoseId !== null) {
        const id = pendingPoseId;
        pendingPoseId = null;
        switchPose(id);
        }
    }
});
poseTween = tl
    .to(interp, { t: 0.6, duration: accel,  ease: 'power2.in'  }) // accel
    .to(interp, { t: 0.9, duration: cruise, ease: 'none'        }) // cruise
    .to(interp, { t: 1.0, duration: decel,  ease: 'power2.out'  }); // decel
}

function applyVisibilityForPose(poseId){
    if (!bolts.length) return;
    for (let i = 0; i < bolts.length; i++) bolts[i].visible = true;
    if (poseId === 6 && bolts[DASH_INDEX]) {
    bolts[DASH_INDEX].visible = false;
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

        lastBaseRot[i] = rBase; // persist base rotation for next pose switch

        // jitter stays additive on top
        const jitterDeg = jitterAmt * JITTER_MAX_DEG * (jitterAngles[i] || 0);

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
            rotFinal = rBase + rotDiff * 0.3; // pull 30% toward target rot
        }
        bolts[i].rotation = rotFinal + jitterDeg;

        // --- hard snap to final pose at the very end (keep jitter) ---
        if (interp.t >= 1) {
            bolts[i].position = b.pos.clone();
            const jitterDegFinal = jitterAmt * JITTER_MAX_DEG * (jitterAngles[i] || 0);
            bolts[i].rotation = b.rot + jitterDegFinal;
            lastBaseRot[i] = b.rot; // base rot zonder jitter bewaren
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
        const OFF = SPACING * 0.25; // vertical offset amplitude
        const targets = [];
        for (let i = 0; i < N; i++) {
            const x = xStart + i * SPACING*0.85;
            const y = (i % 2 === 0 ? -OFF : OFF); // alternate above/below
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
        const CIRCLE_FRACTION = 0.75; // bv. 270°
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
            [-halfW, -halfH],  // upper-left
            [ halfW,   0     ],// right tip
            [-halfW,  halfH]   // lower-left
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

        // Map back to full list while skipping dash index
        const targets = new Array(N);
        let k = 0;
        for (let i = 0; i < N; i++) {
            if (i === DASH_INDEX) continue; // skip dash
            targets[i] = targetsShort[k++];
        }
        if (DASH_INDEX >= 0 && DASH_INDEX < N) {
            targets[DASH_INDEX] = { pos: new Point(centerX, centerY), rot: 0 };
        }
        return targets;
    }
    
    function poseCross(){
        const offsets = [
          new Point(0, -2*SPACING + SPACING/4),  // S
          new Point(0, -1*SPACING + SPACING/4),  // E
          new Point(-2*SPACING + SPACING/4, 0),  // C
          new Point(-1*SPACING + SPACING/4, 0),  // T
          new Point( 1*SPACING - SPACING/4, 0),  // I
          new Point( 2*SPACING - SPACING/4, 0),  // E
          new Point(0,  1*SPACING - SPACING/4),  // -
          new Point(0,  2*SPACING - SPACING/4)   // C-inverted
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
            new Point(-2*s/r2, -2*s/r2),   // top far
            new Point(-s/r2,  -s/r2),     // top near
            new Point(-2*s/r2,  2*s/r2),   // left far (rotated)
            new Point(-s/r2,   s/r2),     // left near (rotated)
            new Point(s/r2,   -s/r2),     // right near (rotated)
            new Point(2*s/r2, -2*s/r2),   // right far (rotated)
            new Point(s/r2,    s/r2),     // bottom near (rotated)
            new Point(2*s/r2,  2*s/r2)    // bottom far (rotated)
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
        if (id===1) targets = poseLine();
        if (id===2) targets = poseOffsetLine();
        if (id===3) targets = poseArcUp();
        if (id===4) targets = poseArcDown();
        if (id===5) targets = poseCircle();
        if (id===6) targets = poseArrowRight();
        if (id===7) targets = poseCross();
        if (id===8) targets = poseX();
        if (targets) setTargets(targets, POSE_DUR);
        applyVisibilityForPose(id);
    }

    tool.onKeyDown = function(e){
        const n = parseInt(e.key, 10);
        if (n>=1 && n<=9) switchPose(n);
        // Quick adjust pose duration with [ and ]
        if (e.key === '[') { POSE_DUR = Math.max(0.1, +(POSE_DUR - 0.1).toFixed(2)); console.log('POSE_DUR', POSE_DUR); }
        if (e.key === ']') { POSE_DUR = Math.min(3.0, +(POSE_DUR + 0.1).toFixed(2)); console.log('POSE_DUR', POSE_DUR); }
    };

    // Scroll to rotate the circle arc when pose 5 is active
    canvas.addEventListener('wheel', (e) => {
        if (!ready) return;
        const delta = e.deltaY || 0;
        if (currentPoseId === 1) {
            e.preventDefault();
            const dir = Math.sign(delta);
            if (dir !== 0) {
                linePendingSteps += dir;                 // enqueue a step
                if (!isAnimating) consumeLineQueueIfNeeded(); // start processing if idle
            }
            return;
        }
        if (currentPoseId === 5) { // circle pose: rotate in queued steps
            e.preventDefault();
            const dir = Math.sign(delta);
            if (dir !== 0) {
                circlePendingSteps += dir;                    // enqueue stap
                if (!isAnimating) consumeCircleQueueIfNeeded(); // start als idle
            }
            return;
        }
        if (currentPoseId === 6) { // arrow pose: rotate in queued 90° steps
            e.preventDefault();
            const dir = Math.sign(delta);
            if (dir !== 0) {
                arrowPendingSteps += dir;                     // enqueue step
                if (!isAnimating) consumeArrowQueueIfNeeded(); // start processing if idle
            }
            return;
        }
    }, { passive: false });

    // --- Clickable shortcuts in the top bar ---
    (function bindShortcutClicks(){
        const nodes = document.querySelectorAll('#shortcuts .kbd');
        if (!nodes || !nodes.length) return;
        nodes.forEach(el => {
            el.style.cursor = 'pointer';
            el.addEventListener('click', () => {
                const attr = el.getAttribute('data-key');
                const key = attr ? parseInt(attr, 10) : parseInt((el.textContent||'').trim(), 10);
                if (!isNaN(key)) {
                    switchPose(key); // uses internal queuing/locks
                }
            });
        });
    })();

    // ----------------- Animate loop -----------------
    view.onFrame = function(){
        if (!ready) return;
        applyPose();
    };
})();