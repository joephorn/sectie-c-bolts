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
    const N = BOLT_FILES.length;                  // aantal bolts
    const W = view.bounds.width;
    const H = view.bounds.height;
    const centerX = W/2;
    const centerY = H/2;
    const SCALE = 0.5;
    const BASE_SPACING = 110;
    const SPACING = BASE_SPACING * SCALE;

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
        // Plaats één instance per symbool in dezelfde volgorde als BOLT_FILES
        bolts = symbols.map(def => {
            const it = def.place([W*0.5, H*0.5]);
            it.applyMatrix = true;
            it.scaling = SCALE; // scale the SVG bolt itself
            return it;
        });
        // startpose zodra alle SVG's klaar zijn
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
    function makeCirclePath(cx, cy, r){
        return new Path.Circle(new Point(cx,cy), r);
    }
    function makePolyline(points){
        const p = new Path({ strokeColor:null });
        points.forEach(pt => p.add(new Point(pt[0], pt[1])));
        p.smooth({type:'continuous'});
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

    function setTargets(targets){
        if (!bolts.length) return;
        fromPose = bolts.map(it => ({ pos: it.position.clone(), rot: it.rotation }));
        toPose   = targets;
        interp.t = 0;
        gsap.to(interp, { duration: 0.8, t: 1, ease: 'power2.inOut' });
    }

    function applyPose(){
        const t = interp.t;
        for (let i=0;i<bolts.length;i++){
        const a = fromPose[i] || { pos: new Point(W*0.5,H*0.5), rot: 0 };
        const b = toPose[i]   || a;
        const p = a.pos.add( b.pos.subtract(a.pos).multiply(t) );
        const r = a.rot + (b.rot - a.rot) * t;
        bolts[i].position = p;
        bolts[i].rotation = r;
        }
    }

    // ----------------- Define Poses -----------------
    function poseLine(){
        const totalLength = SPACING * (N - 1);
        const p = makeLinePath(-totalLength/2, 0, totalLength/2, 0);
        const targets = distributeOnSinglePathWithSpacing(p, N, SPACING, 'upright');
        p.remove();
        return targets;
    }
    function poseArcUp(){
        const baseR = Math.min(W, H) * 0.28 * SCALE;
        const rx = baseR * 1.4; // horizontaal breder
        const ry = baseR * 0.8; // verticaal platter
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
        const rx = baseR * 1.4; // horizontaal breder
        const ry = baseR * -0.8; // verticaal platter
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
        const r = Math.min(W,H) * 0.22 * SCALE;
        const startAngle = 240;      // bv. rechtsboven
        const endAngle   = -60;      // 270° boog
        const p = makeArcPath(0, 0, r, startAngle, endAngle);
        const targets = distributeOnPaths([p], N, 'upright');
        p.remove();
        return targets;
    }
    function poseVertical(){
        const totalLength = SPACING * (N - 1);
        const p = makeLinePath(0, -totalLength/2, 0, totalLength/2);
        const targets = distributeOnSinglePathWithSpacing(p, N, SPACING, 'upright');
        p.remove();
        return targets;
    }
    function poseDiagonal(){
        const totalLength = SPACING * (N - 1);
        const p = makeLinePath(-totalLength/2, -totalLength/2, totalLength/2, totalLength/2);
        const targets = distributeOnSinglePathWithSpacing(p, N, SPACING, 'upright');
        p.remove();
        return targets;
    }
    function poseArrowRight(){
        const d = Math.min(W, H) * 0.3 * SCALE;
        const pts = [
            [-d/1.5, -d],   // upper-left
            [ d,  0],   // right vertex (opens to the right)
            [-d/1.5,  d]    // lower-left
        ];
        const p = makePolyline(pts);
        const targets = distributeOnPaths([p], N, 'upright'); // or 'tangent' if you want rotation
        p.remove();
        return targets;
    }
    // function poseCross(){
    //     const arm = Math.min(W,H) * 0.12 * SCALE;
    //     const horiz = makeLinePath(-arm, 0, arm, 0);
    //     const vert  = makeLinePath(0, -arm*1.5, 0, arm*1.5);
    //     const targets = distributeOnPaths([vert, horiz], N, 'upright');
    //     horiz.remove(); vert.remove();
    //     return targets;
    // }

    // ----------------- Keyboard: 1..7 wisselt pose -----------------
    function switchPose(id){
        let targets;
        if (id===1) targets = poseLine();
        if (id===2) targets = poseArcUp();
        if (id===3) targets = poseArcDown();
        if (id===4) targets = poseCircle();
        if (id===5) targets = poseVertical();
        if (id===6) targets = poseDiagonal();
        if (id===7) targets = poseArrowRight();
        if (id===8) targets = poseCross();
        if (targets) setTargets(targets);
    }

    tool.onKeyDown = function(e){
        const n = parseInt(e.key, 10);
        if (n>=1 && n<=7) switchPose(n);
    };

    // ----------------- Animate loop -----------------
    view.onFrame = function(){
        if (!ready) return; // wacht tot SVG geladen is
        applyPose();
    };
})();