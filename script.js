// NAAR MAP GAAN MET color EN matte, dan:
// ffmpeg -i color.webm -i matte.webm -filter_complex "[0:v][1:v]alphamerge" -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le output.mov


(function(){
// ----------------- Setup Paper -----------------
const canvas = document.getElementById('c');
if (!canvas) { console.error('Canvas #c not found'); return; }
const BASE_CANVAS_SIZE = 1080;
canvas.width = BASE_CANVAS_SIZE;
canvas.height = BASE_CANVAS_SIZE;
canvas.style.width = BASE_CANVAS_SIZE + 'px';
canvas.style.height = BASE_CANVAS_SIZE + 'px';
paper.setup(canvas);
const { Path, Point, view, project, SymbolDefinition, Tool } = paper;
const tool = new Tool();

// ----------------- Background Lines -----------------
let bgGroup = null;          // root group (with clip mask + lines subgroup)
let bgMask = null;           // clip rectangle (we update during tween)
let bgFill = null;           // solid white background fill
let bgTween = null;          // gsap tween handle
let bgEnabled = false;       // current toggle state
const BG_EASE = 'power2.inOut';
const BG_DUR = 0.6;          // seconds

function destroyBg(){
    try { if (bgTween) bgTween.kill(); } catch(_){}
    bgTween = null;
    if (bgGroup) { try { bgGroup.remove(); } catch(_){} }
    bgGroup = null;
    bgMask = null;
    bgLinesGroup = null;
    bgFill = null;
}

function buildBg(){
    destroyBg();
    const Wv = view.bounds.width;
    const Hv = view.bounds.height;
    // No lines anymore — only a solid white fill
    bgLinesGroup = null;
    // Solid white background fill
    bgFill = new Path.Rectangle(new paper.Rectangle(0, 0, Wv, Hv));
    bgFill.fillColor = '#ffffff';
    // Clip mask (start hidden at right edge)
    const rect = new paper.Rectangle(Wv, 0, 0.0001, Hv);
    bgMask = new Path.Rectangle(rect);
    bgMask.clipMask = true;
    // Root group with mask as first child
    bgGroup = new paper.Group();
    bgGroup.addChild(bgMask);
    bgGroup.addChild(bgFill);
    try { bgGroup.sendToBack(); } catch(_){}
    bgGroup.visible = false;
}

function applyBgMaskProgress(p, mode){
    if (!bgGroup) return;
    const Wv = view.bounds.width;
    const Hv = view.bounds.height;
    const clamped = Math.max(0, Math.min(1, p||0));
    let left = 0, w = 0.0001;
    if (mode === 'in'){
        // Reveal from right -> left
        w = Math.max(0.0001, Wv * clamped);
        left = Wv - w;
    } else {
        // Hide from left -> right
        w = Math.max(0.0001, Wv * (1 - clamped));
        left = 0;
    }
    const rect = new paper.Rectangle(left, 0, w, Hv);
    if (bgMask) { try { bgMask.remove(); } catch(_){} }
    bgMask = new Path.Rectangle(rect);
    bgMask.clipMask = true;
    // ensure mask is first child
    try { bgGroup.insertChild(0, bgMask); } catch(_){ bgGroup.addChild(bgMask); }
}

function setBgEnabled(on){
    const want = !!on;
    if (!bgGroup) buildBg();
    if (!bgGroup) return;
    if (bgTween) { try { bgTween.kill(); } catch(_){} bgTween = null; }
    bgGroup.visible = true;
    const state = { t: 0 };
    let fromT = 0, toT = 1, mode = 'in';
    const Wv = view.bounds.width;
    const currFrac = (bgMask && Wv > 0) ? Math.max(0, Math.min(1, (bgMask.bounds.width || 0) / Wv)) : 0;
    if (want && !bgEnabled){
        // In: right -> left — start from current fraction if any
        mode = 'in';
        fromT = currFrac; toT = 1;
    } else if (!want && bgEnabled){
        // Out: left -> right — start from current fraction
        mode = 'out';
        fromT = 1 - currFrac; toT = 1;
    } else {
        // no change
        return;
    }
    state.t = fromT;
    applyBgMaskProgress(state.t, mode);
    bgTween = gsap.to(state, {
        t: toT,
        duration: BG_DUR,
        ease: BG_EASE,
        onUpdate: () => applyBgMaskProgress(state.t, mode),
        onComplete: () => {
            applyBgMaskProgress(toT, mode);
            bgTween = null;
            bgEnabled = want;
            if (!bgEnabled) { try { bgGroup.visible = false; } catch(_){} }
            try { syncControlsActiveState(); } catch(_){}
        }
    });
}

// Enable white background by default on load
try { setBgEnabled(true); } catch(_){}

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
let SCALE = 0.75;
const BASE_SPACING = 110;
let SPACING = BASE_SPACING * SCALE;
const JITTER_MAX_DEG = 50;
const POS_JITTER_MAX_PX = 10; // scaled by SCALE and jitter slider
// Global render/update frame rate (canvas + GSAP)
let TARGET_FPS = 30; // target render/update frame rate
function setTargetFps(fps){
    TARGET_FPS = Math.max(5, Math.min(60, Math.floor(fps || 30)));
    try { if (window.gsap && gsap.ticker && typeof gsap.ticker.fps === 'function') gsap.ticker.fps(TARGET_FPS); } catch(_){ }
}
// Initialize GSAP ticker fps once
try { if (window.gsap && gsap.ticker && typeof gsap.ticker.fps === 'function') gsap.ticker.fps(TARGET_FPS); } catch(_){ }
const END_JITTER_MAX_DEG = 7; // rotation
const END_POS_JITTER_MAX_PX = 3; // positie

// Mid-animation rotation (driven by jitter slider): ramp in, then click off
const MIDJIT_ENABLE   = true;   // master toggle
const MIDJIT_IN_START = 0.00;   // tween t waar extra rotatie begint (0..1)
const MIDJIT_IN_END   = 0.90;   // tween t waar maximale extra rotatie is bereikt
const MIDJIT_CLICK_T  = 1;   // vanaf deze t valt extra rotatie weg (klik naar base)

// Extra roll tijdens reveal vanaf start: laat letters meer "rollen" door de beweging
const ROLL_ENABLE      = true;
const ROLL_IN_START    = 0.00;   // start direct subtiel
const ROLL_IN_END      = 0.85;   // bouw op
const ROLL_CLICK_T     = 0.90;   // klik uit net voor einde
const ROLL_DEG_PER_PX  = 0.22;   // graden per pixel verplaatsing
const ROLL_GLOBAL_SIGN = -1;     // optioneel 1/-1 om draairichting te wisselen

// Zeer korte stagger voor transitions (bijv. ~1 frame per item)
const STAGGER_ENABLE    = true;
const STAGGER_FRAMES    = 2;      // 1 frame offset per volgende bolt
const STAGGER_MAX_FRAC  = 0.4;   // max totale vertraging (als fractie van duur)

// Rotatie iets langer laten aanvoelen: vertraag rotatietijd aan het begin
// Waarde > 1 maakt de start trager (en dus langer gevoel), 1 = uit
const ROT_TIME_POWER = 1.5;

// Rotatie-tail: laat rotatie iets achter de positie aanlopen en toch op t=1 eindigen
const ROT_TAIL_ENABLE = true;
const ROT_TAIL_FRAC   = 0.12; // 12% vertraging van rotatie t.o.v. positie

// Feather near end: stap-quantization vloeit naar smooth af in laatste stukje
const FEATHER_END_ENABLE = true;
const FEATHER_END_WINDOW = 0.1;

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

let POSE_DUR = 0.6;

// --- Global easing for pose transitions ---
const EASE_MODES = ['trapezoid','power2','power3','expo','sine','back'];
let EASE_MODE = 'trapezoid'; // change to one of EASE_MODES

// --- Servo feel parameters ---
const ENABLE_BACKLASH = false;
const BACKLASH_GAIN = 1;

// --- Clockwork stepping (discrete tween states) ---
// Position stepping
const ENABLE_STEPPED_TIME = true;
const STEP_COUNT          = 3;
const STEP_JITTER         = 0.6;

// Rotation stepping (independent from position)
const ENABLE_STEPPED_ROT  = true;
const ROT_STEP_COUNT      = 3;
const ROT_STEP_JITTER     = 0.5;

const _dashIdx = BOLT_FILES.findIndex(p => p.includes('/-.svg'));
const DASH_INDEX = _dashIdx >= 0 ? _dashIdx : 6; // hardcoded fallback

// Derive a logical key from the file path
function keyFromPath(p){
    const f = (p || '').split('/').pop() || '';
    if (f === '-.svg') return '-';
    return f.replace(/\.svg$/,''); // 'S','E','C','T','I','E','C-inverted'
}

const BOLT_KEYS = BOLT_FILES.map(keyFromPath);
const ARROW_TI_GAP_INDEX = (() => {
    const t = BOLT_KEYS.indexOf('T');
    const i = BOLT_KEYS.indexOf('I');
    return (t >= 0 && i === t + 1) ? t : -1;
})();
const ARROW_TI_GAP_EXTRA_FRAC = 0.2;

function getArrowSpacingList(){
    const list = new Array(N - 1).fill(SPACING);
    if (ARROW_TI_GAP_INDEX >= 0 && ARROW_TI_GAP_INDEX < list.length){
        list[ARROW_TI_GAP_INDEX] += SPACING * ARROW_TI_GAP_EXTRA_FRAC;
    }
    return list;
}

// Track a direct reference to the dash item regardless of array index
let dashItem = null;

// Base jitter amount when no slider is present (0..1)
let jitterAmt = 1;
let jitterAngles = new Array(N).fill(0).map(() => (Math.random()*2 - 1)); // per-bolt direction [-1,1]
let endJitterDeg = new Array(N).fill(0); // per-bolt end-state rotation jitter
// Per-bolt waveform for position jitter
let posJitPhase = new Array(N).fill(0).map(() => Math.random() * Math.PI * 2);
let posJitSpeed = new Array(N).fill(0).map(() => 0.6 + Math.random() * 1.1); // cycles/sec
// Per-bolt additive spin offsets (deg) for ad-hoc spins (e.g., space key)
let spinOffsetDeg = new Array(N).fill(0);
let spinTweens = new Array(N).fill(null);
// Eindpositie jitter (per bolt): kleine x/y offset bij rust
let endPosJitter = new Array(N).fill(0).map(() => new Point(0,0));

const jitterEl = document.getElementById('jitter');
const jitterValEl = document.getElementById('jitterVal');
const occJitEl = document.getElementById('occ-jit');
if (jitterEl){
    const upd = () => {
        jitterAmt = Number(jitterEl.value) / 100; // 0..1
        if (jitterValEl) jitterValEl.textContent = Math.round(jitterAmt*100) + '%';
    };
    jitterEl.addEventListener('input', upd);
    upd();
}
// Occasional jitter/rotate toggle (per-bolt pulses)
// Stepped shaping for pulses (to avoid smooth sine)
const OCC_STEPPED       = true;
const OCC_STEP_COUNT    = 10;   // number of levels within a pulse

// Stepped C-inverted spin (space): quantize rotation into discrete ticks
const SPIN_STEPPED      = true;
const SPIN_STEP_COUNT   = 12;   // number of ticks over 360°
let OCC_JIT_ENABLE = false;
const OCC_INT_MIN_MS = 500;
const OCC_INT_MAX_MS = 5000;
let occActive = [];
let occStart  = [];
let occDur    = [];
let occDue    = [];
let occAmpDeg = [];
function setOccJitterEnabled(on){
    const val = !!on;
    OCC_JIT_ENABLE = val;
    if (occJitEl) occJitEl.checked = val;
    try {
        const lmb = document.querySelector('#shortcuts .kbd[data-key="left-mouse"]');
        if (lmb) {
            if (val) lmb.classList.add('active'); else lmb.classList.remove('active');
        }
    } catch(_){ }
    if (!val) {
        for (let i=0;i<N;i++){ occActive[i]=false; occAmpDeg[i]=0; }
    } else {
        const now = Date.now();
        for (let i=0;i<N;i++){
            occActive[i]=false; occAmpDeg[i]=0; occStart[i]=0; occDur[i]=0; occDue[i]= now + OCC_INT_MIN_MS + Math.random()*(OCC_INT_MAX_MS-OCC_INT_MIN_MS);
        }
    }
}
if (occJitEl){
    occJitEl.addEventListener('change', () => setOccJitterEnabled(!!occJitEl.checked));
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
    // init per-bolt occasional jitter state
    occActive = new Array(N).fill(false);
    occStart  = new Array(N).fill(0);
    occDur    = new Array(N).fill(0);
    occDue    = new Array(N).fill(0);
    occAmpDeg = new Array(N).fill(0);
    const nowInit = Date.now();
    for (let i=0;i<N;i++) occDue[i] = nowInit + Math.random()*(OCC_INT_MAX_MS-OCC_INT_MIN_MS) + OCC_INT_MIN_MS;
    setTargets(poseLine());
    ready = true;
    // Sync UI state (left-mouse badge) with current pulses setting
    try { setOccJitterEnabled(!!OCC_JIT_ENABLE); } catch(_){ }
    try { syncControlsActiveState(); } catch(_){ }
    })
    .catch(err => console.error('importSVG error:', err));

// ----------------- Helpers -----------------
function makeLinePath(x1, y1, x2, y2){
    return new Path({ segments: [[x1,y1],[x2,y2]], strokeColor:null });
}
function makeArcPath(cx, cy, r, startDeg, endDeg){
    const p = new Path({ strokeColor:null });
    const steps = 20;
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
function distributeOnSinglePathWithSpacingList(path, count, spacingList, align='upright'){
    const targets = [];
    let offset = 0;
    for (let i=0; i<count; i++){
        const off = Math.min(offset, path.length);
        const pt = path.getPointAt(off);
        const tan = path.getTangentAt(off) || new Point(1,0);
        const rot = (align === 'tangent') ? tan.angle
                : (align === 'fixed0') ? 0
                : 0;
        const centeredPt = pt.add(new Point(centerX, centerY));
        targets.push({ pos: centeredPt, rot });
        if (i < count - 1){
            const step = (spacingList && spacingList[i] != null) ? spacingList[i] : SPACING;
            offset += step;
        }
    }
    return targets;
}
function scalePathToLength(path, targetLength){
    const len = path && path.length;
    if (!len || !isFinite(len)) return;
    if (!isFinite(targetLength) || targetLength <= 0) return;
    const scale = targetLength / len;
    if (!isFinite(scale) || Math.abs(scale - 1) < 1e-6) return;
    path.scale(scale, new Point(0,0));
}

// Interpoleer huidige -> target (met GSAP-driver)
const interp = { t: 1 };     // 0..1
let fromPose = [];
let toPose   = [];
let lastBaseRot = new Array(N).fill(0); // store rotation before jitter is applied

let isAnimating = false;
let pendingPoseId = null; // last requested pose while animating
let poseTween = null;     // gsap tween handle for interp

// Houd animatiecontext bij (van welke pose naar welke pose)
let transitionFromPoseId = null;
let transitionToPoseId   = null;

// Stagger-boekhouding
let currentTweenDur = 0.8;
let staggerRank = new Array(N).fill(0);

// --- Recording sizing (1080) ---
let isRecording = false;
let origCanvasW = canvas.width;
let origCanvasH = canvas.height;
let origZoom    = view.zoom;
let origCenter  = view.center.clone();
let origViewSize = view.viewSize.clone();
// Remember original CSS size overrides
let origStyleW = '';
let origStyleH = '';

// --- Alpha-capable MediaRecorder (transparent background) ---
let alphaRecorder = null;
let alphaChunks = [];
let alphaMime = '';
let _preRecordBgEnabled = null;

function pickAlphaMime(){
  const candidates = [
    'video/webm;codecs=vp8',          // VP8 supports alpha in Chrome
    'video/webm;codecs=vp9',          // VP9 sometimes OK, fallback
    'video/webm'                      // generic fallback
  ];
  for (const m of candidates){
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch(_){}
  }
  return '';
}

function ensureTransparentCanvas(){
  try { document.body.style.background = 'transparent'; } catch(_){}
  try { const el = document.getElementById('c'); if (el) el.style.background = 'transparent'; } catch(_){}
}

function startAlphaRecording(opts={}){
  if (alphaRecorder && alphaRecorder.state === 'recording') return;
  const fps   = Math.max(5, Math.min(60, Math.floor(opts.fps || TARGET_FPS || 30)));
  const fname = String(opts.fileName || 'sectie-c-bolts-alpha');
  const upscale = Number(opts.contentScale) || 1; // optional content scale
  const hiW = Number(opts.targetW) || null;
  const hiH = Number(opts.targetH) || null;

  // Force transparent visuals: disable white bg overlay and set CSS transparent
  _preRecordBgEnabled = bgEnabled;
  try { setBgEnabled(false); } catch(_){}
  ensureTransparentCanvas();

  // Optionally bump backing store and content scale for crisp export
  if (hiW && hiH){
    window.dispatchEvent(new CustomEvent('recorder:start', { detail: { targetW: hiW, targetH: hiH, contentScale: upscale } }));
  }

  const canvas = document.getElementById('c');
  if (!canvas || !canvas.captureStream){ console.error('Canvas captureStream not available'); return; }

  // Prefer an alpha-capable mime
  alphaMime = pickAlphaMime();
  const stream = canvas.captureStream(fps);
  try {
    alphaRecorder = new MediaRecorder(stream, alphaMime ? { mimeType: alphaMime } : {});
  } catch (err){
    console.error('MediaRecorder init failed, retrying without mime', err);
    alphaRecorder = new MediaRecorder(stream);
  }

  alphaChunks = [];
  alphaRecorder.ondataavailable = (e) => { if (e && e.data && e.data.size) alphaChunks.push(e.data); };
  alphaRecorder.onstop = () => {
    try {
      const blob = new Blob(alphaChunks, { type: alphaMime || 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const ext = (alphaMime && alphaMime.includes('webm')) ? 'webm' : 'webm';
      a.download = `${fname}-${tsString()}.${ext}`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { try { URL.revokeObjectURL(url); a.remove(); } catch(_){} }, 1000);
    } finally {
      // restore canvas sizing and background state
      window.dispatchEvent(new Event('recorder:stop'));
      if (_preRecordBgEnabled != null) { try { setBgEnabled(_preRecordBgEnabled); } catch(_){} }
      _preRecordBgEnabled = null;
    }
  };

  try { alphaRecorder.start(); } catch(err){ console.error('Recorder start failed', err); return; }
  console.log('🎥 Alpha recording started', alphaMime || '(default)');
}

function stopAlphaRecording(){
  if (alphaRecorder && alphaRecorder.state === 'recording'){
    try { alphaRecorder.stop(); } catch(_){}
  }
}

// Convenience keybinding: Shift+V starts a short alpha capture, Shift+S stops
window.addEventListener('keydown', (e) => {
  if (e.shiftKey && (e.key === 'v' || e.key === 'V')){
    // 1080 square backing store, mild content scale for crisp vectors
    startAlphaRecording({ targetW: 1080, targetH: 1080, contentScale: 1.15, fps: TARGET_FPS, fileName: `sectie-c-bolts-alpha` });
  }
  if (e.shiftKey && (e.key === 's' || e.key === 'S')){
    stopAlphaRecording();
  }
});

function setCanvasPixelSize(w, h){
    canvas.width = w;
    canvas.height = h;
    view.viewSize = new paper.Size(w, h);
}

function applyRecordSizing(targetW = 1080, targetH = 1080){
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
    const targetMax = Math.max(targetW, targetH); // e.g. 1080
    const scale = Math.max(1, targetMax / Math.max(cssW, cssH));
    const newW = Math.round(cssW * scale);
    const newH = Math.round(cssH * scale);

    // Increase drawing buffer without changing world coordinates
    setCanvasPixelSize(newW, newH);
    // Lock CSS display size so the canvas doesn't visually blow up
    // Save original inline styles to restore later
    try {
        origStyleW = canvas.style.width;
        origStyleH = canvas.style.height;
        canvas.style.width  = cssW + 'px';
        canvas.style.height = cssH + 'px';
    } catch(_){}
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
    // Restore original CSS size
    try {
        canvas.style.width  = origStyleW || '';
        canvas.style.height = origStyleH || '';
        origStyleW = '';
        origStyleH = '';
    } catch(_){}
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
    const easeStr = map[EASE_MODE] || 'power3.inOut';
    poseTween = gsap.to(interp, { duration: dur, t: 1, ease: easeStr, onComplete });
  }
}

function setTargets(targets, dur = 0.8){
    if (!bolts.length) return;
    fromPose = bolts.map((it, i) => ({ pos: it.position.clone(), rot: lastBaseRot[i] || 0 }));
    toPose   = targets;
    // Generate fresh end-state jitter for this pose
    endJitterDeg = endJitterDeg.map(() => (Math.random() * 2 - 1) * END_JITTER_MAX_DEG); // uniform in [-7, +7]
    // Genereer nieuwe eindpositie-jitter (kleine x/y offset)
    endPosJitter = endPosJitter.map(() => new Point(
        (Math.random()*2 - 1) * END_POS_JITTER_MAX_PX,
        (Math.random()*2 - 1) * END_POS_JITTER_MAX_PX
    ));
    // Stagger-setup: bereken volgorde op basis van target X (links->rechts), omgekeerd bij PATH_ORDER_REVERSED
    try {
        const arr = [];
        for (let i = 0; i < N; i++){
            const t = toPose[i] || fromPose[i];
            const pp = (t && t.pos) ? t.pos : new Point(centerX, centerY);
            arr.push({ i, x: pp.x, y: pp.y });
        }
        arr.sort((a,b) => a.x - b.x);
        if (PATH_ORDER_REVERSED) arr.reverse();
        const rank = new Array(N).fill(0);
        for (let r=0; r<arr.length; r++) rank[arr[r].i] = r;
        staggerRank = rank;
    } catch(_) { staggerRank = new Array(N).fill(0); }
    currentTweenDur = Math.max(1e-6, +dur || 0);
    interp.t = 0;
    if (poseTween) poseTween.kill();
    isAnimating = true;
    _startPoseTween(dur, () => {
      isAnimating = false;
      poseTween = null;
      if (_isScrambling && _scrambleByTimer && _scrambleQueue && _scrambleQueue.length) { return; }
      if (_isScrambling && !_scrambleByTimer && _scrambleQueue && _scrambleQueue.length) { runNextScramble(); return; }
      if (consumeLineQueueIfNeeded() || consumeCircleQueueIfNeeded() || consumeArrowQueueIfNeeded()) return;
      // Re-apply visibility for the final pose (e.g., pose 0 hides others, pose 6 hides dash)
      applyVisibilityForPose(currentPoseId);
      if (pendingPoseId !== null) {
        const id = pendingPoseId;
        pendingPoseId = null;
        switchPose(id);
      }
    });
}

// Allow changing SCALE at runtime and reflow current pose
let _savedScaleForRecord = null;
// Global path order flag: when true, pose targets are returned reversed
let PATH_ORDER_REVERSED = false;
function setScaleValue(newScale){
    if (typeof newScale !== 'number' || !isFinite(newScale) || newScale <= 0) return;
    SCALE = newScale;
    SPACING = BASE_SPACING * SCALE;
    if (bolts && bolts.length){
        for (let i = 0; i < bolts.length; i++) {
            try { bolts[i].scaling = SCALE; } catch(_){}
        }
        const tgs = targetsForPose(currentPoseId);
        if (tgs) {
            setTargets(tgs, 0);
            applyVisibilityForPose(currentPoseId);
        }
    }
    // Rebuild background lines for new spacing
    try { if (bgEnabled && !bgTween) { buildBg(); setBgEnabled(true); } } catch(_){}
}

function applyVisibilityForPose(poseId){
    if (!bolts.length) return;
    for (let i = 0; i < bolts.length; i++) bolts[i].visible = true;
    // Pose 0: show only C-inverted
    if (poseId === 0) {
        if (isAnimating) {
            // During the tween to pose 0, keep all visible so they animate to center
            return;
        }
        const cInv = bolts.find(b => b && b.data && b.data.key === 'C-inverted') || null;
        for (let i = 0; i < bolts.length; i++) bolts[i].visible = (bolts[i] === cInv);
        return;
    }
}

function applyPose() {
    const tGlobal = interp.t;
    // Occasionally add a tiny rotation pulse per letter (staggered)
    const now = Date.now();
    if (OCC_JIT_ENABLE && !isAnimating) {
        for (let i=0;i<N;i++){
            if (!occActive[i] && now >= (occDue[i]||0)){
                occActive[i] = true;
                occStart[i]  = now;
                occDur[i]    = 250 + Math.random()*350;
                occAmpDeg[i] = (Math.random()*40 - 20);
            }
            if (occActive[i]){
                const t = Math.min(1, (now - occStart[i]) / Math.max(1, occDur[i]));
                if (t >= 1){
                    occActive[i] = false;
                    occAmpDeg[i] = 0;
                    occDue[i] = now + OCC_INT_MIN_MS + Math.random()*(OCC_INT_MAX_MS - OCC_INT_MIN_MS);
                }
            }
        }
    }
    for (let i = 0; i < bolts.length; i++){
        const a = fromPose[i] || { pos: new Point(W*0.5,H*0.5), rot: 0 };
        const b = toPose[i]   || a;

        let tLocal = tGlobal;
        // Korte stagger: schuif per bolt een paar milliseconden (1 frame) op
        // en her-normaliseer zodat elk item toch 0..1 haalt bij het globale einde
        if (STAGGER_ENABLE && currentTweenDur > 0) {
            const frameTime = 1 / Math.max(1, TARGET_FPS);
            const rank      = (staggerRank && staggerRank[i]) ? staggerRank[i] : 0;
            const maxRank   = (staggerRank && staggerRank.length) ? Math.max.apply(null, staggerRank) : (N - 1);
            const perRankTimeWanted = Math.max(1, STAGGER_FRAMES) * frameTime; // seconden per rang
            const maxDelayTimeWanted = perRankTimeWanted * Math.max(0, maxRank);
            // Cap totale vertraging vs duur
            const maxDelayNormWanted = maxDelayTimeWanted / currentTweenDur;
            const scale = (maxDelayNormWanted > STAGGER_MAX_FRAC && maxDelayNormWanted > 0)
                ? (STAGGER_MAX_FRAC / maxDelayNormWanted) : 1;
            const perRankTime = perRankTimeWanted * scale;
            const delayTime   = rank * perRankTime;
            const maxDelayTime= Math.max(0, maxRank * perRankTime);
            const denomTime   = Math.max(1e-6, currentTweenDur - maxDelayTime);
            const tShifted    = (tGlobal * currentTweenDur - delayTime) / denomTime; // her-normaliseer naar 0..1
            tLocal = Math.min(1, Math.max(0, tShifted));
        }

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

        // Feather near end: blend stepped -> smooth so de eindsprong klein wordt
        if (FEATHER_END_ENABLE) {
            const w = Math.max(0, Math.min(0.5, FEATHER_END_WINDOW));
            if (tLocal > 1 - w) {
                const n = Math.min(1, Math.max(0, (tLocal - (1 - w)) / Math.max(1e-6, w)));
                const s = n*n*(3 - 2*n); // smoothstep 0..1
                const tSmooth = tLocal;  // ongestapt
                tPosUsed = tPosUsed*(1 - s) + tSmooth*s;
            }
        }

        // Rotatieprogressie: optioneel tail (achterlopen) en trager begin
        let tPhaseRot = tLocal;
        if (typeof ROT_TAIL_FRAC === 'number' && isFinite(ROT_TAIL_FRAC) && ROT_TAIL_ENABLE) {
            const d = Math.max(0, Math.min(0.45, ROT_TAIL_FRAC));
            const denomLag = Math.max(1e-6, 1 - d);
            tPhaseRot = Math.min(1, Math.max(0, (tLocal - d) / denomLag));
        }
        let tRotBase = tPhaseRot;
        if (typeof ROT_TIME_POWER === 'number' && isFinite(ROT_TIME_POWER) && ROT_TIME_POWER > 1) {
            tRotBase = Math.pow(tPhaseRot, ROT_TIME_POWER);
        }
        let tRotUsed = tRotBase;
        if (ENABLE_STEPPED_ROT) {
            const stepSizeR = 1 / Math.max(1, ROT_STEP_COUNT);
            const phaseJR = ROT_STEP_JITTER ? ((jitterAngles[i] || 0) * 0.5 * ROT_STEP_JITTER * stepSizeR) : 0;
            const ttr = Math.min(1, Math.max(0, tRotBase + phaseJR));
            const kr  = Math.floor(ttr / stepSizeR + 1e-6);
            tRotUsed  = Math.min(1, kr * stepSizeR - phaseJR);
        }

        // Feather near end for rotation as well (blend stepped -> base)
        if (FEATHER_END_ENABLE) {
            const w = Math.max(0, Math.min(0.5, FEATHER_END_WINDOW));
            if (tLocal > 1 - w) {
                const n = Math.min(1, Math.max(0, (tLocal - (1 - w)) / Math.max(1e-6, w)));
                const s = n*n*(3 - 2*n);
                tRotUsed = tRotUsed*(1 - s) + tRotBase*s;
            }
        }

        // base interpolation using stepped times
        const p = a.pos.add( b.pos.subtract(a.pos).multiply(tPosUsed) );
        // Blend eindpositie-offset (endPosJitter) geleidelijk in tijdens de tween i.p.v. op het eind te springen
        const pj = endPosJitter[i] || new Point(0,0);
        const sPosOff = Math.min(1, Math.max(0, tLocal)); // volle tween 0..1, voelt natuurlijk
        const pBase = p.add(pj.multiply(sPosOff));
        // subtle up/down position jitter tijdens animatie om strikt-lineair pad te doorbreken
        let pJittered = pBase;
        if (isAnimating && jitterAmt > 0) {
            // Smoothly ramp jitter in and out similar to rotation jitter
            let sJ = 0;
            if (tLocal < MIDJIT_CLICK_T) {
                const denomJ = Math.max(1e-6, MIDJIT_IN_END - MIDJIT_IN_START);
                const uJ = (tLocal - MIDJIT_IN_START) / denomJ;
                sJ = uJ <= 0 ? 0 : (uJ >= 1 ? 1 : (uJ*uJ*(3 - 2*uJ)));
            }
            if (sJ > 0) {
                // Direction perpendicular to movement (fallback to world up)
                const mv = b.pos.subtract(a.pos);
                let nx = -mv.y, ny = mv.x;
                const nlen = Math.hypot(nx, ny) || 1;
                nx /= nlen; ny /= nlen;
                const tSec = (now || Date.now()) / 1000;
                const phase = posJitPhase[i] || 0;
                const speed = posJitSpeed[i] || 1;
                const wave = Math.sin(phase + tSec * speed * Math.PI * 2);
                const ampPx = jitterAmt * sJ * POS_JITTER_MAX_PX * SCALE;
                const offX = nx * ampPx * wave;
                const offY = ny * ampPx * wave;
                pJittered = pBase.add(new Point(offX, offY));
            }
        }
        let rBase = a.rot + (b.rot - a.rot) * tRotUsed; // base rotation without jitter

        // optional tiny settle/backlash near the very end (servo vibe)
        if (ENABLE_BACKLASH && tRotUsed > 0.8) {
            const signRot = Math.sign((b.rot || 0) - (a.rot || 0)) || 0;
            const settle = (1 - tRotUsed) * BACKLASH_GAIN; // fades to 0 at end
            rBase += settle * signRot;                  // few tenths of a degree max
        }

        lastBaseRot[i] = rBase;

        // mini gravity snap for position near the end (richt op huidige target incl. offset-in-blend)
        let posFinal = pJittered;
        if (tPosUsed > 0.97) {
            const posTargetNow = (b.pos || new Point(centerX, centerY)).add(pj.multiply(sPosOff));
            const snapVec = posTargetNow.subtract(posFinal).multiply(0.3); // pull 30% toward target
            posFinal = posFinal.add(snapVec);
        }
        bolts[i].position = posFinal;

        // mini gravity snap for rotation near the end
        let rotFinal = rBase;
        if (tRotUsed > 0.97) {
            const rotDiff = (b.rot || 0) - rBase;
            rotFinal = rBase + rotDiff * 0.8; // iets minder hard "snap" vlak voor einde
        }

        // mid-animation additive rotation driven by jitter slider: ramp in, then click off near the end
        let addDeg = 0;
        if (MIDJIT_ENABLE) {
            if (tLocal < MIDJIT_CLICK_T) {
                const denom = Math.max(1e-6, MIDJIT_IN_END - MIDJIT_IN_START);
                const u = (tLocal - MIDJIT_IN_START) / denom; // kan <0..>1 zijn
                const s = u <= 0 ? 0 : (u >= 1 ? 1 : (u*u*(3 - 2*u))); // smoothstep 0..1
                addDeg = s * jitterAmt * JITTER_MAX_DEG * (jitterAngles[i] || 0);
            } else {
                addDeg = 0; // "klik" terug naar basis
            }
        }
        // Extra roll: rotatie proportioneel aan afgelegde afstand, alleen bij reveal vanaf start (pose 0)
        let rollAdd = 0;
        if (ROLL_ENABLE && isAnimating && transitionFromPoseId === 0) {
            const mv = b.pos.subtract(a.pos);
            const distTotal = mv.length || a.pos.getDistance(b.pos) || 0;
            const distSoFar = distTotal * tPosUsed; // lineaire benadering
            // richting: kies dominant component om sign te bepalen (stabieler beeld)
            const dirSign = (Math.abs(mv.x) >= Math.abs(mv.y)) ? (mv.x >= 0 ? 1 : -1) : (mv.y >= 0 ? 1 : -1);
            let sR = 0;
            if (tLocal < ROLL_CLICK_T) {
                const denomR = Math.max(1e-6, ROLL_IN_END - ROLL_IN_START);
                const uR = (tLocal - ROLL_IN_START) / denomR;
                sR = uR <= 0 ? 0 : (uR >= 1 ? 1 : (uR*uR*(3 - 2*uR)));
            }
            rollAdd = sR * distSoFar * ROLL_DEG_PER_PX * dirSign * ROLL_GLOBAL_SIGN;
        }
        // Occasional rotation pulse (sinusoidal in/out)
        let occAdd = 0;
        if (OCC_JIT_ENABLE && occActive[i]){
            const tp = Math.min(1, (now - occStart[i]) / Math.max(1, occDur[i]));
            let s = Math.sin(Math.PI * tp);
            if (OCC_STEPPED && OCC_STEP_COUNT > 1) {
                s = Math.floor(s * OCC_STEP_COUNT + 1e-6) / OCC_STEP_COUNT;
            }
            occAdd = (occAmpDeg[i]||0) * s;
        }
        const spinAdd = (typeof spinOffsetDeg !== 'undefined' && spinOffsetDeg[i]) ? spinOffsetDeg[i] : 0;
        bolts[i].rotation = rotFinal + addDeg + rollAdd + occAdd + spinAdd;

        // --- hard snap to final pose at the very end (keep small end jitter) ---
        if (interp.t >= 1) {
            const pj = endPosJitter[i] || new Point(0,0);
            bolts[i].position = b.pos.add(pj);
            // keep a tiny random misalignment at rest
            const ej = endJitterDeg[i] || 0;
            const tpEnd = Math.min(1, (now - occStart[i]) / Math.max(1, occDur[i]));
            let sEnd = Math.sin(Math.PI * tpEnd);
            if (OCC_STEPPED && OCC_STEP_COUNT > 1) {
                sEnd = Math.floor(sEnd * OCC_STEP_COUNT + 1e-6) / OCC_STEP_COUNT;
            }
            const occAddEnd = (OCC_JIT_ENABLE && occActive[i]) ? (occAmpDeg[i]||0) * sEnd : 0;
            const spinAddEnd = (typeof spinOffsetDeg !== 'undefined' && spinOffsetDeg[i]) ? spinOffsetDeg[i] : 0;
            bolts[i].rotation = b.rot + ej + occAddEnd + spinAddEnd;
            lastBaseRot[i] = b.rot + ej; // do not persist occ jitter
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
        return maybeReverseTargets(targets);
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
        return maybeReverseTargets(targets);
    }
    function poseArcUp(){
        const baseR = Math.min(W, H) * 0.28 * SCALE;
        // Make arc a bit narrower and positioned slightly higher
        const rx = baseR * 1.3;   // was 1.4
        const ry = baseR * 1;
        const yShift = -baseR * 0.3; // move arc further upward
        const startAngle = 200;
        const endAngle = -20;

        const p = new Path({ strokeColor: null });
        const steps = 20;
        for (let i = 0; i <= steps; i++) {  
            const t = i / steps;
            const a = (startAngle + (endAngle - startAngle) * t) * Math.PI / 180;
            p.add(new Point(Math.cos(a) * rx, Math.sin(a) * ry + yShift));
        }
        p.smooth({ type: 'continuous' });

        scalePathToLength(p, SPACING * (N - 1));
        const targets = distributeOnSinglePathWithSpacing(p, N, SPACING, 'upright');
        p.remove();
        return maybeReverseTargets(targets);
    }
    function poseArcDown(){
        const baseR = Math.min(W, H) * 0.28 * SCALE;
        // Make arc a bit narrower and positioned slightly lower
        const rx = baseR * 1.3;   // was 1.4
        const ry = baseR * -1;
        const yShift = baseR * 0.3; // move arc downward
        const startAngle = 200;
        const endAngle = -20;

        const p = new Path({ strokeColor: null });
        const steps = 40;
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const a = (startAngle + (endAngle - startAngle) * t) * Math.PI / 180;
            p.add(new Point(Math.cos(a) * rx, Math.sin(a) * ry + yShift));
        }
        p.smooth({ type: 'continuous' });

        scalePathToLength(p, SPACING * (N - 1));
        const targets = distributeOnSinglePathWithSpacing(p, N, SPACING, 'upright');
        p.remove();
        return maybeReverseTargets(targets);
    }
    function poseCircle(){
        const r = Math.min(W,H) * 0.25 * SCALE;
        const sweep = 360 * CIRCLE_FRACTION;
        const startAngle = circleRotDeg - sweep/2;
        const endAngle   = circleRotDeg + sweep/2;
        const p = makeArcPath(0, 0, r, startAngle, endAngle);
        scalePathToLength(p, SPACING * (N - 1));
        const targets = distributeOnSinglePathWithSpacing(p, N, SPACING, 'upright');
        p.remove();
        return maybeReverseTargets(targets);
    }
    function poseArrowRight(){
        const halfH = Math.min(W, H) * 0.33 * SCALE; // vertical half-height
        const halfW = halfH * 0.7;                  // slightly wider horizontal half-width

        // Make the tip thicker by adding a short flat segment at the apex
        const tipW = SPACING * 2.0; // adjust for wider/narrower tip
        const basePts = [
            [-halfW, -halfH],
            [ halfW, -tipW/4 ],
            [ halfW, tipW/4 ],
            [-halfW,  halfH]
        ];

        // rotate by arrowRotDeg around origin (rotate the path, not the SVGs)
        const a = arrowRotDeg * Math.PI / 180;
        const c = Math.cos(a), s = Math.sin(a);
        const pts = basePts.map(([x,y]) => [x*c - y*s, x*s + y*c]);

        const p = makePolylineSharp(pts);
        const spacingList = getArrowSpacingList();
        const totalLen = spacingList.reduce((sum, v) => sum + v, 0);
        scalePathToLength(p, totalLen);
        const targets = distributeOnSinglePathWithSpacingList(p, N, spacingList, 'upright'); // include '-'
        p.remove();
        return maybeReverseTargets(targets);
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
        return maybeReverseTargets(targets);
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
        return maybeReverseTargets(targets);
    }

    function poseBeginStacked(){
        const targets = new Array(N).fill(0).map(() => ({ pos: new Point(centerX, centerY), rot: 0 }));
        return maybeReverseTargets(targets);
    }

    // ----------------- Keyboard -----------------
    function switchPose(id){
        if (isAnimating) {
          pendingPoseId = id;
          return;
        }
        // Bewaar herkomst en bestemming van de overgang (voor roll-boost bij reveal)
        const fromId = currentPoseId;
        transitionFromPoseId = fromId;
        transitionToPoseId   = id;
        currentPoseId = id;
        let targets;
        switch (id) {
          case 0: targets = poseBeginStacked(); break;
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
        // For pose 0 keep all visible during animation; applyVisibilityForPose
        // will hide others after tween completes.
        applyVisibilityForPose(id);
        // Update UI highlighting
        try { syncControlsActiveState(); } catch(_){ }
    }

    tool.onKeyDown = function(e){
        const n = parseInt(e.key, 10);
        if (!isNaN(n)) {
            if (n === 0) { switchPose(0); return; }
            if (n>=1 && n<=9) { switchPose(n); return; }
        }
        if (e.key === ' ' || e.key === 'space') {
            spinCOnce();
            return;
        }
        if (e.key === 'b' || e.key === 'B') {
            setBgEnabled(!bgEnabled);
            try { syncControlsActiveState(); } catch(_){}
            return;
        }
        if (e.key === 'r' || e.key === 'R') {
            if (_isScrambling) return;
            rearrangeBoltsLeftToRight(!PATH_ORDER_REVERSED);
            try { syncControlsActiveState(); } catch(_){ }
            return;
        }
        if (e.key === '[') { POSE_DUR = Math.max(0.1, +(POSE_DUR - 0.1).toFixed(2)); }
        if (e.key === ']') { POSE_DUR = Math.min(3.0, +(POSE_DUR + 0.1).toFixed(2)); }
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

    // Toggle jitter pulses on canvas click
    canvas.addEventListener('click', () => {
        setOccJitterEnabled(!OCC_JIT_ENABLE);
    });

    (function bindShortcutClicks(){
        const nodes = document.querySelectorAll('#shortcuts .kbd');
        if (!nodes || !nodes.length) return;
        nodes.forEach(el => {
            el.style.cursor = 'pointer';
            el.addEventListener('click', () => {
                const attr = (el.getAttribute('data-key') || '').toLowerCase();
                // Special controls
                if (attr === 'left-mouse') { setOccJitterEnabled(!OCC_JIT_ENABLE); syncControlsActiveState(); return; }
                if (attr === 'space') { spinCOnce(); return; }
                if (el.id === 'toggle-bg') { setBgEnabled(!bgEnabled); syncControlsActiveState(); return; }
                // Numeric poses
                const key = attr ? parseInt(attr, 10) : parseInt((el.textContent||'').trim(), 10);
                if (!isNaN(key)) {
                    if (key === 0) { switchPose(0); syncControlsActiveState(); return; }
                    switchPose(key);
                    syncControlsActiveState();
                }
            });
        });
    })();

    function syncControlsActiveState(){
        try {
            const bar = document.getElementById('shortcuts');
            if (!bar) return;
            const all = bar.querySelectorAll('.kbd');
            all.forEach(el => {
                if (el.getAttribute('data-key') !== 'left-mouse') el.classList.remove('active');
            });
            const poseEl = bar.querySelector(`.kbd[data-key="${currentPoseId}"]`);
            if (poseEl) poseEl.classList.add('active');
            const rEl = document.getElementById('arrange-ltr');
            if (rEl) {
                if (PATH_ORDER_REVERSED) rEl.classList.add('active'); else rEl.classList.remove('active');
            }
            const bgEl = document.getElementById('toggle-bg');
            if (bgEl) {
                if (bgEnabled) bgEl.classList.add('active'); else bgEl.classList.remove('active');
            }
        } catch(_){ }
    }

    // Spin helper: rotate the 'C' bolt 360° with easing (stepped if enabled)
    function spinCOnce(){
        if (!bolts || !bolts.length) return;
        const idx = bolts.findIndex(b => b && b.data && b.data.key === 'C-inverted');
        if (idx < 0) return;
        try { if (spinTweens[idx]) spinTweens[idx].kill(); } catch(_){}
        const state = { v: 0 };
        const dur = 0.8;
        spinTweens[idx] = gsap.to(state, {
            v: 360,
            duration: dur,
            ease: 'power2.inOut',
            onUpdate: () => {
                let v = state.v;
                if (SPIN_STEPPED && SPIN_STEP_COUNT > 1) {
                    const stepAngle = 360 / SPIN_STEP_COUNT;
                    v = Math.floor(v / stepAngle + 1e-6) * stepAngle;
                }
                spinOffsetDeg[idx] = v;
            },
            onComplete: () => { spinOffsetDeg[idx] = 0; spinTweens[idx] = null; }
        });
    }

    // Recording: switch main canvas drawing buffer up and back down
    window.addEventListener('recorder:start', (e) => {
        const d = (e && e.detail) || {};
        const tw = Number(d && d.targetW) || 1080;
        const th = Number(d && d.targetH) || 1080;
        applyRecordSizing(tw, th);
        // Optional content scale: simply bump global SCALE
        const cs = (d && d.contentScale != null) ? Number(d.contentScale) : 1;
        if (isFinite(cs) && cs > 0 && cs !== 1) {
            _savedScaleForRecord = SCALE;
            setScaleValue(SCALE * cs);
        }
    });
    window.addEventListener('recorder:stop', () => {
        restoreInteractiveSizing();
        if (_savedScaleForRecord != null) {
            setScaleValue(_savedScaleForRecord);
            _savedScaleForRecord = null;
        }
    });

    // --- Arrange button: enforce left-to-right letter order for current pose ---
function targetsForPose(id){
        switch (id) {
            case 0: return poseBeginStacked();
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

function maybeReverseTargets(tgs){
    if (!Array.isArray(tgs)) return tgs;
    return PATH_ORDER_REVERSED ? tgs.slice().reverse() : tgs;
}

    // Raw path slots (original generator order) for the current pose
    function getRawSlotsForPose(id){
        switch (id) {
            case 0: { // begin
                return new Array(N).fill(0).map(() => ({ pos: new Point(centerX, centerY), rot: 0 }));
            }
            case 1: { // line
                const totalLength = SPACING * (N - 1);
                const half = totalLength / 2;
                const a = lineRotDeg * Math.PI / 180;
                const cos = Math.cos(a), sin = Math.sin(a);
                const x1 = -half * cos, y1 = -half * sin;
                const x2 =  half * cos, y2 =  half * sin;
                const p = makeLinePath(x1, y1, x2, y2);
                const slots = distributeOnSinglePathWithSpacing(p, N, SPACING, 'upright');
                p.remove();
                return slots;
            }
            case 2: { // offset line
                const totalLength = SPACING * (N - 1);
                const xStart = -totalLength / 2 * 0.85;
                const OFF = SPACING * 0.25;
                const slots = [];
                for (let i = 0; i < N; i++) {
                    const x = xStart + i * SPACING*0.85;
                    const y = (i % 2 === 0 ? -OFF : OFF);
                    slots.push({ pos: new Point(centerX + x, centerY + y), rot: 0 });
                }
                return slots;
            }
            case 3: { // arc up (match poseArcUp)
                const baseR = Math.min(W, H) * 0.28 * SCALE;
                const rx = baseR * 1.3;
                const ry = baseR * 1.0;
                const yShift = -baseR * 0.3;
                const startAngle = 200;
                const endAngle = -20;
                const p = new Path({ strokeColor: null });
                const steps = 20;
                for (let i = 0; i <= steps; i++){
                    const t = i/steps;
                    const ang = (startAngle + (endAngle - startAngle)*t) * Math.PI/180;
                    p.add(new Point(Math.cos(ang)*rx, Math.sin(ang)*ry + yShift));
                }
                p.smooth({ type: 'continuous' });
                scalePathToLength(p, SPACING * (N - 1));
                const slots = distributeOnSinglePathWithSpacing(p, N, SPACING, 'upright');
                p.remove();
                return slots;
            }
            case 4: { // arc down (match poseArcDown)
                const baseR = Math.min(W, H) * 0.28 * SCALE;
                const rx = baseR * 1.3;
                const ry = baseR * -1.0;
                const yShift = baseR * 0.3;
                const startAngle = 200;
                const endAngle = -20;
                const p = new Path({ strokeColor: null });
                const steps = 40;
                for (let i = 0; i <= steps; i++){
                    const t = i/steps;
                    const ang = (startAngle + (endAngle - startAngle)*t) * Math.PI/180;
                    p.add(new Point(Math.cos(ang)*rx, Math.sin(ang)*ry + yShift));
                }
                p.smooth({ type: 'continuous' });
                scalePathToLength(p, SPACING * (N - 1));
                const slots = distributeOnSinglePathWithSpacing(p, N, SPACING, 'upright');
                p.remove();
                return slots;
            }
            case 5: { // circle
                const r = Math.min(W,H) * 0.25 * SCALE;
                const sweep = 360 * CIRCLE_FRACTION;
                const startAngle = circleRotDeg - sweep/2;
                const endAngle   = circleRotDeg + sweep/2;
                const p = makeArcPath(0, 0, r, startAngle, endAngle);
                scalePathToLength(p, SPACING * (N - 1));
                const slots = distributeOnSinglePathWithSpacing(p, N, SPACING, 'upright');
                p.remove();
                return slots;
            }
            case 6: { // arrow (slightly wider)
                const halfH = Math.min(W, H) * 0.33 * SCALE;
                const halfW = halfH * 0.75;
                const tipW = SPACING * 2.0;
                const basePts = [
                    [-halfW, -halfH],
                    [ halfW, -tipW/4 ],
                    [ halfW, tipW/4 ],
                    [-halfW,  halfH]
                ];
                const a = arrowRotDeg * Math.PI / 180;
                const c = Math.cos(a), s = Math.sin(a);
                const pts = basePts.map(([x,y]) => [x*c - y*s, x*s + y*c]);
                const p = makePolylineSharp(pts);
                const spacingList = getArrowSpacingList();
                const totalLen = spacingList.reduce((sum, v) => sum + v, 0);
                scalePathToLength(p, totalLen);
                const slots = distributeOnSinglePathWithSpacingList(p, N, spacingList, 'upright');
                p.remove();
                return slots;
            }
            case 7: { // plus
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
                return offsets.slice(0, N).map(off => ({ pos: off.add(new Point(cx, cy)), rot: 0 }));
            }
            case 8: { // X
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
                return offsets.slice(0, N).map(off => ({ pos: off.add(new Point(cx, cy)), rot: 0 }));
            }
        }
        return null;
    }

    // --- Arrange with scramble (split-flap style) ---------------------
    let _scrambleQueue = [];
    let _isScrambling = false;
    let _scrambleByTimer = false;
    const SCRAMBLE_TICK_MS = 100;

    function getPathSlots(reverse){
        const raw = getRawSlotsForPose(currentPoseId);
        if (!raw) return null;
        return reverse ? raw.slice().reverse() : raw;
    }

    function buildFinalTargetsFromSlots(slots){
        // Map canonical keys to path slots, assign bolts by key in order
        const keys = BOLT_FILES.map(keyFromPath);
        const indicesByKey = new Map();
        for (let i = 0; i < bolts.length; i++){
            const key = (bolts[i].data && bolts[i].data.key) || '';
            if (!indicesByKey.has(key)) indicesByKey.set(key, []);
            indicesByKey.get(key).push(i);
        }
        const nextByKey = new Map();
        const tgs = new Array(N);
        for (let s = 0; s < N; s++){
            const key = keys[s] || '';
            const list = indicesByKey.get(key) || [];
            const ptr = nextByKey.get(key) || 0;
            const boltIdx = list[Math.min(ptr, Math.max(0, list.length - 1))];
            nextByKey.set(key, ptr + 1);
            if (typeof boltIdx === 'number') tgs[boltIdx] = slots[s];
        }
        // Fill any leftovers
        for (let i = 0; i < N; i++) if (!tgs[i]) tgs[i] = slots[Math.min(i, slots.length - 1)];
        return tgs;
    }

    function buildRandomTargetsFromSlots(slots){
        const idx = Array.from({length:N}, (_,i)=>i);
        for (let i=idx.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); const t=idx[i]; idx[i]=idx[j]; idx[j]=t; }
        return idx.map(i => slots[i]);
    }

    // Persist final mapping by reordering arrays so future tweens stay consistent
    function persistFinalOrderFromSlots(slots){
        if (!slots) return;
        const keys = BOLT_FILES.map(keyFromPath);
        const indicesByKey = new Map();
        for (let i = 0; i < bolts.length; i++){
            const key = (bolts[i].data && bolts[i].data.key) || '';
            if (!indicesByKey.has(key)) indicesByKey.set(key, []);
            indicesByKey.get(key).push(i);
        }
        const nextByKey = new Map();
        const ord = new Array(N);
        for (let s = 0; s < N; s++){
            const key = keys[s] || '';
            const list = indicesByKey.get(key) || [];
            const ptr = nextByKey.get(key) || 0;
            const boltIdx = list[Math.min(ptr, Math.max(0, list.length - 1))];
            nextByKey.set(key, ptr + 1);
            ord[s] = (typeof boltIdx === 'number') ? boltIdx : s;
        }
        const reorderedBolts = ord.map(i => bolts[i]);
        const reorderedJitterAngles = ord.map(i => jitterAngles[i]);
        const reorderedLastBaseRot  = ord.map(i => lastBaseRot[i]);
        const reorderedEndJitter    = ord.map(i => endJitterDeg[i]);
        const reorderedEndPosJitter = ord.map(i => endPosJitter[i]);
        const reorderedPosPhase     = ord.map(i => posJitPhase[i]);
        const reorderedPosSpeed     = ord.map(i => posJitSpeed[i]);
        const reorderedSpinOffsets  = ord.map(i => spinOffsetDeg[i]);
        const reorderedSpinTweens   = ord.map(i => spinTweens[i]);
        bolts = reorderedBolts;
        jitterAngles = reorderedJitterAngles;
        lastBaseRot = reorderedLastBaseRot;
        endJitterDeg = reorderedEndJitter;
        endPosJitter = reorderedEndPosJitter;
        posJitPhase = reorderedPosPhase;
        posJitSpeed = reorderedPosSpeed;
        spinOffsetDeg = reorderedSpinOffsets;
        spinTweens = reorderedSpinTweens;
        dashItem = bolts.find(b => b && b.data && b.data.key === '-') || null;
    }

    function runNextScramble(){
        if (!_scrambleQueue.length){
            persistFinalOrderFromSlots(_scrambleFinalSlots);
            _scrambleFinalSlots = null;
            _isScrambling = false;
            applyVisibilityForPose(currentPoseId);
            return;
        }
        const targets = _scrambleQueue.shift();
        setTargets(targets, 0); // Teleport
        if (_scrambleQueue.length) {
            setTimeout(runNextScramble, SCRAMBLE_TICK_MS);
        } else {
            setTimeout(runNextScramble, 0); // finalize on next tick
        }
    }

    function rearrangeBoltsLeftToRight(reverse = false){
        if (!ready || !bolts || bolts.length !== N) return;
        if (_isScrambling) return;
        // Persist global path order preference so future poses use same order
        PATH_ORDER_REVERSED = !!reverse;
        const slots = getPathSlots(reverse);
        if (!slots) return;
        // Build a scramble sequence of target arrays
        _scrambleQueue = [];
        const flickers = 6;
        for (let i=0;i<flickers;i++) _scrambleQueue.push(buildRandomTargetsFromSlots(slots));
        _scrambleFinalSlots = slots;
        _scrambleQueue.push(buildFinalTargetsFromSlots(slots));
        _isScrambling = true;
        _scrambleByTimer = true;
        runNextScramble();
    }

    const arrangeBtn = document.getElementById('arrange-ltr');
    if (arrangeBtn){
        arrangeBtn.addEventListener('click', () => {
            if (_isScrambling) return;
            rearrangeBoltsLeftToRight(!PATH_ORDER_REVERSED);
            try { syncControlsActiveState(); } catch(_){ }
        });
    }

    // ----------------- Export (Clean SVG + direct PDF) -----------------
    function tsString(){
        const d = new Date();
        const pad = n => String(n).padStart(2,'0');
        return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
    }

    function buildCleanExportGroup(){
        const grp = new paper.Group();
        grp.applyMatrix = true;
        try {
            for (const it of (bolts || [])){
                if (!it || it.visible === false) continue;
                let node = null;
                try {
                    // If this is a SymbolItem (placed symbol), expand to its source geometry
                    if (it.definition && it.definition.item) {
                        node = it.definition.item.clone();
                        try { node.applyMatrix = true; } catch(_){ }
                        try { node.transform(it.matrix); } catch(_){ }
                    } else {
                        node = it.clone();
                    }
                } catch(_) {
                    node = null;
                }
                if (!node) continue;
                node.visible = true;
                grp.addChild(node);
            }
        } catch(_){ }
        return grp;
    }

    function exportCleanSvgString(){
        let grp = null;
        try {
            grp = buildCleanExportGroup();
            if (!grp) return '';
            // Compute bounds safely
            const b = grp.bounds;
            const ox = (b && isFinite(b.x)) ? b.x : 0;
            const oy = (b && isFinite(b.y)) ? b.y : 0;
            if (isFinite(ox) && isFinite(oy)) {
                try { grp.translate(new Point(-ox, -oy)); } catch(_){}
            }
            // Recompute bounds after translation
            const bb = grp.bounds;
            const bw = (bb && isFinite(bb.width) && bb.width > 0) ? bb.width : 1;
            const bh = (bb && isFinite(bb.height) && bb.height > 0) ? bb.height : 1;
            const w = Math.max(1, Math.round(bw));
            const h = Math.max(1, Math.round(bh));

            const node = grp.exportSVG({ asString: false, precision: 3, bounds: 'content' });
            if (!node) return '';
            try {
                const rm = node.querySelectorAll ? node.querySelectorAll('clipPath, mask') : [];
                rm.forEach(n => n.parentNode && n.parentNode.removeChild(n));
                const all = node.querySelectorAll ? node.querySelectorAll('[clip-path],[mask]') : [];
                all.forEach(n => { n.removeAttribute && n.removeAttribute('clip-path'); n.removeAttribute && n.removeAttribute('mask'); });
            } catch(_){ }
            const ser = new XMLSerializer();
            const inner = ser.serializeToString(node);
            const svg = `<?xml version="1.0" encoding="UTF-8"?>\n` +
                        `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
                        `${inner}</svg>`;
            return svg;
        } catch (err) {
            console.error('exportSVG failed:', err);
            return '';
        } finally {
            try { if (grp) grp.remove(); } catch(_){ }
        }
    }

    // Expose SVG export helper for external callers
    try { window.exportCleanSvgString = exportCleanSvgString; } catch(_){}

    // Build a file name slug based on the current pose
    function poseSlug(id){
        switch(id){
            case 0: return 'begin';
            case 1: return 'line';
            case 2: return 'line-offset';
            case 3: return 'arc-up';
            case 4: return 'arc-down';
            case 5: return 'circle';
            case 6: return 'arrow';
            case 7: return 'plus';
            case 8: return 'x';
            default: return `pose-${id}`;
        }
    }
    const exportSvgBtn = document.getElementById('export-svg');
    if (exportSvgBtn){
        exportSvgBtn.addEventListener('click', () => {
            try {
                const svg = exportCleanSvgString();
                if (!svg) return;
                const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                const slug = poseSlug(currentPoseId);
                a.download = `sectie-c-bolts-${slug}.svg`;
                document.body.appendChild(a);
                a.click();
                setTimeout(() => { try { URL.revokeObjectURL(url); a.remove(); } catch(_){ } }, 1000);
            } catch (err) {
                console.error('Export SVG error:', err);
            }
        });
    }

    // ----------------- Animate loop (throttled by TARGET_FPS) -----------------
    let _lastFrameStamp = 0;
    view.onFrame = function(){
        if (!ready) return;
        const now = (window.performance && performance.now) ? performance.now() : Date.now();
        const budget = 1000 / Math.max(1, TARGET_FPS);
        if (now - _lastFrameStamp < budget) return;
        _lastFrameStamp = now;
        applyPose();
    };
})();
