/* PING-PONG — Circular Brick Challenge
   Physics and layout refined against VID_292.mp4. */

(() => {
  "use strict";

  // ---------- Canvas & Scaling ----------
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  // Logical design space (portrait 720 x 1280)
  const VW = 720;
  const VH = 1280;

  let scale = 1;
  let dpr = 1;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    scale = Math.min(w / VW, h / VH);
    canvas.width = Math.round(VW * scale * dpr);
    canvas.height = Math.round(VH * scale * dpr);
    canvas.style.width = Math.round(VW * scale) + "px";
    canvas.style.height = Math.round(VH * scale) + "px";
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
  }
  window.addEventListener("resize", resize);
  resize();

  // ---------- Palette ----------
  // Cool arena metal + warm bricks, with an ice-blue ball for strong tracking.
  const COL = {
    bg: "#07111f",
    ring: "#7893a8",
    brick: "#ff9a62",
    paddle: "#ffc95c",
    gate: "#ffd166",
    bar: "#79d5e8",
    barDark: "#20364b",
    ball: "#dcf9ff",
    ballTrail: "#68d8f0",
    text: "#eef7ff",
    dim: "#7890a6",
    slow: "#55ddb0",
    slowBadge: "#69a7ff",
    wide: "#ffd166",
    line: "#26384b",
  };

  const FONT_SANS = 'system-ui, -apple-system, "Segoe UI", sans-serif';
  const FONT_MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

  const BRICK_COLORS = [
    "#ff5c7a", "#ff7a59", "#ff9f43", "#ffc857", "#ffd166",
    "#f76c9c", "#d67bff", "#62d9c8", "#ff8fa3",
  ];

  // ---------- Arena & Obstacles ----------
  // Circle center (360, 509), radius 290 px
  const ARENA = {
    cx: 360,
    cy: 509,
    r: 290,
  };

  // The video's 27px opening is stage 3. Earlier stages teach the
  // entry mechanic; later stages narrow the notch and extend the shield.
  const LEVELS = [
    { gate: 96, bar: 69 },
    { gate: 54, bar: 94 },
    { gate: 27, bar: 120 },
    { gate: 23, bar: 145 },
    { gate: 20, bar: 159 },
    { gate: 17, bar: 171 },  // video width restored on the final stage
  ];

  const GATE = {
    left: 347,
    right: 374,
    top: 796,
    bottom: 814,
  };

  function configureGate() {
    const width = LEVELS[S.stage - 1].gate;
    GATE.left = Math.round(ARENA.cx - width / 2);
    GATE.right = GATE.left + width;
  }

  // Visible lower-chamber walls. The inner edges are the actual collision planes.
  const SIDE_WALL = {
    left: 20,
    right: VW - 20,
    top: 200,
    bottom: VH,
    thickness: 9,
  };

  // Defensive shield bar below the bricks and above the gate mouth
  const BAR = {
    x1: 326,
    x2: 395,
    y1: 718,
    y2: 726,
  };
  const BAR_GROWTH_STEP = 8;
  const BAR_MAX_WIDTH = 300;

  function configureShieldBar() {
    const base = LEVELS[S.stage - 1].bar;
    const width = Math.min(BAR_MAX_WIDTH, base + S.barGrowth);
    const center = ARENA.cx + 0.5;
    BAR.x1 = Math.round(center - width / 2);
    BAR.x2 = BAR.x1 + width;
  }

  function growShieldBar() {
    const base = LEVELS[S.stage - 1].bar;
    if (base + S.barGrowth >= BAR_MAX_WIDTH) return false;
    S.barGrowth = Math.min(BAR_MAX_WIDTH - base, S.barGrowth + BAR_GROWTH_STEP);
    configureShieldBar();
    return true;
  }

  // ---------- Brick Grid ----------
  // 68 columns x 59 rows at 8px pitch, 6px square cells
  const GRID = {
    cols: 68,
    rows: 59,
    pitch: 8,
    x0: 87,
    y0: 236,
    size: 7,
  };

  // Spatial lookup array for O(1) collision queries (cols * rows)
  const brickGrid = new Int32Array(GRID.cols * GRID.rows);

  // ---------- Game State ----------
  const S = {
    mode: "start",        // start | play (play continues after ALL CLEAR)
    bricks: [],
    bricksTotal: 3379,
    cleared: 0,
    ballsServed: 0,       // internal only; HUD shows live balls
    attempt: 1,           // increments on every ball lost / off-screen
    stage: 1,
    stageHits: 0,         // paddle impacts in the current stage
    stageHitHistory: [],  // completed / visited stages, indexed from 0
    barGrowth: 0,         // permanent stage progress applied to the inner shield
    paddle: { x: ARENA.cx, y: 1093, w: 89, h: 20, baseW: 89 },
    ballsArr: [],
    powerups: [],
    sparks: [],
    blasts: [],           // reward shockwaves
    slowUntil: 0,
    wideUntil: 0,
    banner: null,         // { text, timer } centered notice at y=900
    allClear: false,      // in-arena victory card; physics keeps running
    shake: 0,
    time: 0,
  };

  // ---------- Helpers ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const pad = (n, w) => String(Math.floor(n)).padStart(w, "0");

  // ---------- Web Audio Synthesizer ----------
  let actx = null;
  let noiseBuffer = null;
  const soundLast = {
    paddle: -1e9, wall: -1e9, bar: -1e9, brick: -1e9, reward: -1e9, explosion: -1e9,
  };

  function initAudio() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!actx && AudioCtx) actx = new AudioCtx();
      if (actx && actx.state === "suspended") actx.resume();
    } catch (_) {}
  }

  function soundAllowed(kind, gapMs) {
    const now = performance.now();
    if (now - soundLast[kind] < gapMs) return false;
    soundLast[kind] = now;
    return true;
  }

  function playTone(freq, dur = 0.05, type = "triangle", gain = 0.06, endFreq = null) {
    if (!actx) return;
    try {
      const now = actx.currentTime;
      const o = actx.createOscillator();
      const g = actx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, now);
      if (endFreq !== null) {
        o.frequency.exponentialRampToValueAtTime(Math.max(30, endFreq), now + dur);
      }
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(gain, now + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      o.connect(g).connect(actx.destination);
      o.start(now);
      o.stop(now + dur + 0.01);
    } catch (_) {}
  }

  function getNoiseBuffer() {
    if (!actx) return null;
    if (!noiseBuffer) {
      const len = Math.max(1, Math.floor(actx.sampleRate * 0.12));
      noiseBuffer = actx.createBuffer(1, len, actx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    return noiseBuffer;
  }

  function playNoise(dur = 0.03, gain = 0.05, freq = 1400, q = 0.8, type = "bandpass") {
    if (!actx) return;
    try {
      const buf = getNoiseBuffer();
      if (!buf) return;
      const now = actx.currentTime;
      const src = actx.createBufferSource();
      const filter = actx.createBiquadFilter();
      const g = actx.createGain();
      src.buffer = buf;
      filter.type = type;
      filter.frequency.setValueAtTime(freq, now);
      filter.Q.setValueAtTime(q, now);
      g.gain.setValueAtTime(gain, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      src.connect(filter).connect(g).connect(actx.destination);
      src.start(now);
      src.stop(now + dur + 0.005);
    } catch (_) {}
  }

  // Paddle: a solid low "pock" plus a short rubbery click.
  function triggerPaddleSound() {
    if (!soundAllowed("paddle", 45)) return;
    playTone(215, 0.085, "triangle", 0.16, 105);
    playTone(96, 0.1, "sine", 0.07, 62);
    playNoise(0.026, 0.055, 1500, 0.7);
  }

  // Ring / post: dry hollow knock.
  function triggerWallSound() {
    if (!soundAllowed("wall", 38)) return;
    playTone(185, 0.065, "triangle", 0.09, 128);
    playNoise(0.024, 0.04, 850, 1.1, "lowpass");
  }

  // Internal shield: brighter metallic clang.
  function triggerBarSound() {
    if (!soundAllowed("bar", 50)) return;
    playTone(820, 0.06, "square", 0.045, 560);
    playTone(1480, 0.035, "sine", 0.032, 1160);
    playNoise(0.018, 0.025, 3200, 2.2);
  }

  // Brick: crisp high chip; throttled because storms break many per frame.
  function triggerBrickSound() {
    if (!soundAllowed("brick", 30)) return;
    const f = 620 + (S.cleared % 16) * 24;
    playTone(f, 0.045, "triangle", 0.042, 360);
    playNoise(0.03, 0.038, 2200, 1.3);
  }

  // Reward spawn: low blast, noise burst, then a bright reveal chime.
  function triggerRewardSound() {
    if (!soundAllowed("reward", 90)) return;
    playTone(128, 0.24, "sine", 0.15, 48);
    playNoise(0.2, 0.13, 480, 0.7, "lowpass");
    playTone(980, 0.16, "triangle", 0.055, 1480);
  }

  // Stage-1 splash damage: shorter and dryer than the reward explosion.
  function triggerBrickExplosionSound() {
    if (!soundAllowed("explosion", 75)) return;
    playTone(155, 0.17, "sine", 0.12, 52);
    playNoise(0.13, 0.085, 760, 0.75, "lowpass");
    playTone(340, 0.055, "square", 0.028, 170);
  }

  function triggerPowerupSound() {
    if (!actx) return;
    try {
      const now = actx.currentTime;
      const o = actx.createOscillator();
      const g = actx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(520, now);
      o.frequency.exponentialRampToValueAtTime(880, now + 0.12);
      g.gain.setValueAtTime(0.06, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
      o.connect(g).connect(actx.destination);
      o.start(now);
      o.stop(now + 0.14);
    } catch (_) {}
  }

  function triggerLoseSound() {
    if (!actx) return;
    try {
      const now = actx.currentTime;
      const o = actx.createOscillator();
      const g = actx.createGain();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(160, now);
      o.frequency.exponentialRampToValueAtTime(90, now + 0.18);
      g.gain.setValueAtTime(0.04, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
      o.connect(g).connect(actx.destination);
      o.start(now);
      o.stop(now + 0.18);
    } catch (_) {}
  }

  function triggerClearSound() {
    [523, 659, 784, 1046].forEach((f, i) => {
      setTimeout(() => playTone(f, 0.22, "sine", 0.08), i * 90);
    });
  }

  // ---------- Brick Setup ----------
  // Generated to match exactly 3379 bricks and flat bottom at y <= 697
  // (the video's flat edge sits at y~703; keeping 697 preserves the 3379 count)
  function buildBricks() {
    S.bricks = [];
    brickGrid.fill(0);
    const R_CUT_SQ = 278.65 * 278.65;

    for (let j = 0; j < GRID.rows; j++) {
      const y = GRID.y0 + j * GRID.pitch;
      if (y > 697) continue; // Flat bottom cutoff
      for (let i = 0; i < GRID.cols; i++) {
        const x = GRID.x0 + i * GRID.pitch;
        const dx = x - ARENA.cx;
        const dy = y - ARENA.cy;
        if (dx * dx + dy * dy <= R_CUT_SQ) {
          const idx = S.bricks.length;
          const color = BRICK_COLORS[Math.floor(Math.random() * BRICK_COLORS.length)];
          S.bricks.push({ x, y, alive: true, col: i, row: j, color });
          brickGrid[j * GRID.cols + i] = idx + 1; // 1-based index
        }
      }
    }
    S.bricksTotal = S.bricks.length; // exactly 3379
  }

  // ---------- Ball Creation ----------
  const BALL_SPEED = 415; // px/s (measured ~413 px/s from 10fps video)
  const BALL_RADIUS = 6.5;

  function makeBall(x, y, vx, vy, zone = "chamber") {
    return {
      x, y, vx, vy, r: BALL_RADIUS, trail: [], zone,
      canGrowShield: false, // armed only when this ball enters through the gate
    };
  }

  function resetBall() {
    const p = S.paddle;
    const a = rand(-0.25, 0.25);
    const vx = Math.sin(a) * BALL_SPEED;
    const vy = -Math.cos(a) * BALL_SPEED;
    S.ballsArr = [makeBall(p.x, p.y - 28, vx, vy, "chamber")];
    S.ballsServed++;
  }

  // ---------- Powerups ----------
  const PU = {
    W: { label: "W", color: COL.wide, dur: 5000 },
    S: { label: "S", color: COL.slowBadge, dur: 5000 },
    X: { label: "×3", color: COL.slow, dur: 0 },
  };

  function spawnPowerup(x, y) {
    const keys = ["W", "S", "X", "X"]; // slightly higher weight for x3 to match frenzy
    const k = keys[Math.floor(Math.random() * keys.length)];
    S.powerups.push({ x, y, vy: 130, kind: k, r: 15, life: 10 });
    rewardBurst(x, y);
    triggerRewardSound();
    S.shake = Math.max(S.shake, 3.5);
    return true;
  }

  function applyPowerup(kind) {
    triggerPowerupSound();
    if (kind === "W") {
      S.wideUntil = S.time + PU.W.dur;
      S.banner = { text: "WIDE / 5s", timer: 2.5 };
    } else if (kind === "S") {
      S.slowUntil = S.time + PU.S.dur;
      S.banner = { text: "SLOW / 5s", timer: 2.5 };
    } else if (kind === "X") {
      const before = S.ballsArr.length;
      if (before === 0) return;
      const MAX_BALLS = 2400; // Cap at ~2400 (matching video's peak of 2346)
      const toAdd = [];
      const spreadAngle = 0.42;

      for (let i = 0; i < before; i++) {
        if (S.ballsArr.length + toAdd.length >= MAX_BALLS) break;
        const b = S.ballsArr[i];
        const sp = Math.hypot(b.vx, b.vy) || BALL_SPEED;
        const curAng = Math.atan2(b.vy, b.vx);

        // Spawn 2 extra clones to triple the count
        const a1 = curAng - spreadAngle;
        const a2 = curAng + spreadAngle;
        toAdd.push(makeBall(b.x, b.y, Math.cos(a1) * sp, Math.sin(a1) * sp, b.zone || "arena"));
        if (S.ballsArr.length + toAdd.length < MAX_BALLS) {
          toAdd.push(makeBall(b.x, b.y, Math.cos(a2) * sp, Math.sin(a2) * sp, b.zone || "arena"));
        }
      }
      for (const nb of toAdd) S.ballsArr.push(nb);
      const after = S.ballsArr.length;
      S.ballsServed += (after - before);
      S.banner = { text: `x3 / ${before} > ${after}`, timer: 3.2 };
    }
  }

  // Brick-break sparks inherit the destroyed brick's color.
  function burst(x, y, color = COL.brick) {
    if (S.sparks.length > 250) return;
    const n = 3;
    for (let i = 0; i < n; i++) {
      S.sparks.push({
        x, y,
        vx: rand(-60, 60),
        vy: rand(-60, 60),
        life: rand(0.2, 0.45),
        t: 0,
        size: rand(1.5, 3),
        color,
      });
    }
  }

  function rewardBurst(x, y) {
    if (S.blasts.length < 24) {
      S.blasts.push({ x, y, t: 0, life: 0.5 });
    }
    for (let i = 0; i < 18 && S.sparks.length < 320; i++) {
      const a = rand(0, Math.PI * 2);
      const speed = rand(90, 290);
      S.sparks.push({
        x, y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        life: rand(0.32, 0.72),
        t: 0,
        size: rand(2, 4),
        color: i % 3 === 0 ? "#fff4bd" : COL.wide,
      });
    }
  }

  // Stage 1 impact blast: destroy every live brick in a small radius.
  function explodeNearbyBricks(x, y, radius = 22) {
    if (S.stage !== 1) return 0;
    const c0 = clamp(Math.floor((x - radius - GRID.x0) / GRID.pitch), 0, GRID.cols - 1);
    const c1 = clamp(Math.floor((x + radius - GRID.x0) / GRID.pitch), 0, GRID.cols - 1);
    const r0 = clamp(Math.floor((y - radius - GRID.y0) / GRID.pitch), 0, GRID.rows - 1);
    const r1 = clamp(Math.floor((y + radius - GRID.y0) / GRID.pitch), 0, GRID.rows - 1);
    const radiusSq = radius * radius;
    let destroyed = 0;

    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const idx = brickGrid[row * GRID.cols + col];
        if (idx <= 0) continue;
        const br = S.bricks[idx - 1];
        if (!br || !br.alive) continue;
        const dx = br.x - x;
        const dy = br.y - y;
        if (dx * dx + dy * dy > radiusSq) continue;
        br.alive = false;
        brickGrid[row * GRID.cols + col] = 0;
        S.cleared++;
        burst(br.x, br.y, br.color);
        destroyed++;
      }
    }

    if (destroyed > 0) {
      if (S.blasts.length < 40) {
        S.blasts.push({ x, y, t: 0, life: 0.44, color: "#ff8a5c", core: "#ffe0a6" });
      }
      for (let i = 0; i < 12 && S.sparks.length < 340; i++) {
        const a = rand(0, Math.PI * 2);
        const speed = rand(80, 240);
        S.sparks.push({
          x, y,
          vx: Math.cos(a) * speed,
          vy: Math.sin(a) * speed,
          life: rand(0.24, 0.52),
          t: 0,
          size: rand(2, 4.5),
          color: i % 2 ? "#ffb84d" : "#ff6b6b",
        });
      }
      S.shake = Math.max(S.shake, 2.2);
      triggerBrickExplosionSound();
    }
    return destroyed;
  }

  function collideArenaRing(ball, prevDist) {
    const dx = ball.x - ARENA.cx;
    const dy = ball.y - ARENA.cy;
    const dist = Math.hypot(dx, dy) || 1;
    if (dist < ARENA.r - ball.r || dist > ARENA.r + ball.r) return false;

    // The bottom notch is a real opening in both directions. Never reflect
    // on the circular wall while the ball is inside this passage.
    const inGatePassage = ball.x >= GATE.left + 1 && ball.x <= GATE.right - 1 &&
      ball.y + ball.r >= GATE.top && ball.y - ball.r <= GATE.bottom;
    if (inGatePassage) return false;

    const nx = dx / dist;
    const ny = dy / dist;
    const dot = ball.vx * nx + ball.vy * ny;

    // Use geometry rather than ball.zone: a stale zone must never let an
    // outside ball cross the top wall or an inside ball escape through it.
    if (prevDist <= ARENA.r && dot > 0) {
      ball.vx -= 2 * dot * nx;
      ball.vy -= 2 * dot * ny;
      ball.x = ARENA.cx + nx * (ARENA.r - ball.r - 0.5);
      ball.y = ARENA.cy + ny * (ARENA.r - ball.r - 0.5);
      triggerWallSound();
      return true;
    }
    if (prevDist >= ARENA.r && dot < 0) {
      ball.vx -= 2 * dot * nx;
      ball.vy -= 2 * dot * ny;
      ball.x = ARENA.cx + nx * (ARENA.r + ball.r + 0.5);
      ball.y = ARENA.cy + ny * (ARENA.r + ball.r + 0.5);
      triggerWallSound();
      return true;
    }
    return false;
  }

  function paddleBounce(ball) {
    const p = S.paddle;
    const half = p.w / 2;
    if (ball.vy > 0 &&
        ball.y + ball.r >= p.y - p.h / 2 &&
        ball.y - ball.r <= p.y + p.h / 2 + 6 &&
        ball.x >= p.x - half - ball.r &&
        ball.x <= p.x + half + ball.r) {
      const t = clamp((ball.x - p.x) / half, -1, 1);
      const ang = -Math.PI / 2 + t * 1.05;
      const prog = S.bricksTotal ? S.cleared / S.bricksTotal : 0;
      const targetSpeed = BALL_SPEED * (1 + prog * 0.25);
      ball.vx = Math.cos(ang) * targetSpeed;
      ball.vy = Math.sin(ang) * targetSpeed;
      ball.y = p.y - p.h / 2 - ball.r - 0.5;
      S.shake = Math.max(S.shake, 2.5);
      triggerPaddleSound();
      return true;
    }
    return false;
  }

  function update(dt) {
    S.time += dt * 1000;
    updatePhysics(dt);
  }

  // ---------- Physics Updates ----------
  const LOSE_Y = 1130;

  function updatePhysics(dt) {
    const slowFactor = (S.slowUntil > S.time) ? 0.55 : 1;
    const wide = (S.wideUntil > S.time);
    S.paddle.w = wide ? 160 : S.paddle.baseW;

    // Slight speed scaling as bricks clear
    const prog = S.bricksTotal ? S.cleared / S.bricksTotal : 0;
    const speedScale = 1 + prog * 0.25;
    const targetSpeed = BALL_SPEED * speedScale;

    // Multistep for stability
    const subSteps = 2;
    const sdt = dt * slowFactor / subSteps;

    for (let bi = S.ballsArr.length - 1; bi >= 0; bi--) {
      const b = S.ballsArr[bi];

      for (let s = 0; s < subSteps; s++) {
        const prevX = b.x;
        const prevY = b.y;
        const prevDist = Math.hypot(prevX - ARENA.cx, prevY - ARENA.cy) || 1;
        b.x += b.vx * sdt;
        b.y += b.vy * sdt;

        const inGateOpening = (b.x >= GATE.left + 1 && b.x <= GATE.right - 1);

        if (b.zone === "arena") {
          // 1. Brick Collisions (O(1) grid query)
          if (b.y <= 705 && b.y >= 230) {
            const col0 = clamp(Math.floor((b.x - b.r - GRID.x0) / GRID.pitch), 0, GRID.cols - 1);
            const col1 = clamp(Math.floor((b.x + b.r - GRID.x0) / GRID.pitch), 0, GRID.cols - 1);
            const row0 = clamp(Math.floor((b.y - b.r - GRID.y0) / GRID.pitch), 0, GRID.rows - 1);
            const row1 = clamp(Math.floor((b.y + b.r - GRID.y0) / GRID.pitch), 0, GRID.rows - 1);
            let hitBrick = false;

            for (let r = row0; r <= row1 && !hitBrick; r++) {
              for (let c = col0; c <= col1 && !hitBrick; c++) {
                const bIdx = brickGrid[r * GRID.cols + c];
                if (bIdx > 0) {
                  const br = S.bricks[bIdx - 1];
                  if (br && br.alive) {
                    const half = GRID.size / 2 + b.r;
                    const ox = br.x - b.x;
                    const oy = br.y - b.y;
                    if (Math.abs(ox) <= half && Math.abs(oy) <= half) {
                      br.alive = false;
                      brickGrid[r * GRID.cols + c] = 0;
                      S.cleared++;
                      if (b.canGrowShield) {
                        growShieldBar();
                        b.canGrowShield = false;
                      }
                      burst(br.x, br.y, br.color);
                      explodeNearbyBricks(br.x, br.y, 22);
                      if (Math.random() < 0.022) spawnPowerup(br.x, br.y);
                      triggerBrickSound();
                      S.shake = Math.max(S.shake, 0.4);

                      // Reflect ball along shallowest overlap axis
                      const overlapX = half - Math.abs(ox);
                      const overlapY = half - Math.abs(oy);
                      if (overlapX < overlapY) {
                        b.vx = ox > 0 ? -Math.abs(b.vx) : Math.abs(b.vx);
                        b.x += (ox > 0 ? -overlapX : overlapX);
                      } else {
                        b.vy = oy > 0 ? -Math.abs(b.vy) : Math.abs(b.vy);
                        b.y += (oy > 0 ? -overlapY : overlapY);
                      }
                      hitBrick = true;
                    }
                  }
                }
              }
            }
          }

          // 2. Defensive Shield Bar: solid on all four faces.
          //    The reference video's first entries repeatedly hit the underside
          //    and fall back through the gate. Bricks are reached by going
          //    around either end, never by passing straight up through it.
          if (b.x + b.r > BAR.x1 && b.x - b.r < BAR.x2 &&
              b.y + b.r > BAR.y1 && b.y - b.r < BAR.y2) {
            if (prevY + b.r <= BAR.y1 && b.vy > 0) {
              b.y = BAR.y1 - b.r - 0.5;
              b.vy = -Math.abs(b.vy);
              triggerBarSound();
            } else if (prevY - b.r >= BAR.y2 && b.vy < 0) {
              b.y = BAR.y2 + b.r + 0.5;
              b.vy = Math.abs(b.vy);
              triggerBarSound();
            } else if (prevX + b.r <= BAR.x1 && b.vx > 0) {
              b.x = BAR.x1 - b.r - 0.5;
              b.vx = -Math.abs(b.vx);
              triggerBarSound();
            } else if (prevX - b.r >= BAR.x2 && b.vx < 0) {
              b.x = BAR.x2 + b.r + 0.5;
              b.vx = Math.abs(b.vx);
              triggerBarSound();
            } else {
              // Resolve a residual overlap without trapping the ball in the bar.
              const penX = Math.min(b.x + b.r - BAR.x1, BAR.x2 - (b.x - b.r));
              const penY = Math.min(b.y + b.r - BAR.y1, BAR.y2 - (b.y - b.r));
              if (penX < penY) {
                const fromLeft = prevX < (BAR.x1 + BAR.x2) / 2;
                b.x = fromLeft ? BAR.x1 - b.r - 0.5 : BAR.x2 + b.r + 0.5;
                b.vx = fromLeft ? -Math.abs(b.vx) : Math.abs(b.vx);
              } else {
                const fromAbove = prevY < (BAR.y1 + BAR.y2) / 2;
                b.y = fromAbove ? BAR.y1 - b.r - 0.5 : BAR.y2 + b.r + 0.5;
                b.vy = fromAbove ? -Math.abs(b.vy) : Math.abs(b.vy);
              }
              triggerBarSound();
            }
          }

          // 3. Gate Exit: switch zones as soon as the ball touches the mouth.
          //    This must happen before the inner wall can reflect it at y~792.
          if (b.vy > 0 && inGateOpening && b.y + b.r >= GATE.top) {
            b.zone = "chamber";
          } else {
            collideArenaRing(b, prevDist);
          }
        } else {
          // b.zone === "chamber" (Outside the arena, in the lower chamber)

          // 1. Visible left/right walls in the lower chamber
          if (b.x <= b.r + SIDE_WALL.left) {
            b.x = b.r + SIDE_WALL.left;
            b.vx = Math.abs(b.vx);
            triggerWallSound();
          } else if (b.x >= SIDE_WALL.right - b.r) {
            b.x = SIDE_WALL.right - b.r;
            b.vx = -Math.abs(b.vx);
            triggerWallSound();
          }

          // 2. Gate Posts Collision
          if (b.y >= 794 && b.y <= 816) {
            if (Math.abs(b.x - GATE.left) <= b.r + 1.5) {
              b.vx = (b.x < GATE.left ? -Math.abs(b.vx) : Math.abs(b.vx));
              b.x = GATE.left + (b.x < GATE.left ? -(b.r + 1.5) : (b.r + 1.5));
              triggerWallSound();
            } else if (Math.abs(b.x - GATE.right) <= b.r + 1.5) {
              b.vx = (b.x > GATE.right ? Math.abs(b.vx) : -Math.abs(b.vx));
              b.x = GATE.right + (b.x > GATE.right ? (b.r + 1.5) : -(b.r + 1.5));
              triggerWallSound();
            }
          }

          // 3. Gate Entrance (passing UP through the notch / 缺口 into the arena)
          if (b.vy < 0 && inGateOpening && b.y <= GATE.top) {
            b.zone = "arena";
            b.canGrowShield = true;
            triggerPaddleSound();
          } else {
            // 4. Solid circular wall in either direction, except inside the notch.
            collideArenaRing(b, prevDist);
          }

          // 5. Paddle bounce
          const p = S.paddle;
          const half = p.w / 2;
          if (b.vy > 0 &&
              b.y + b.r >= p.y - p.h / 2 &&
              b.y - b.r <= p.y + p.h / 2 + 6 &&
              b.x >= p.x - half - b.r &&
              b.x <= p.x + half + b.r) {
            const t = clamp((b.x - p.x) / half, -1, 1);
            const ang = -Math.PI / 2 + t * 1.05;
            b.vx = Math.cos(ang) * targetSpeed;
            b.vy = Math.sin(ang) * targetSpeed;
            b.y = p.y - p.h / 2 - b.r - 0.5;
            S.shake = Math.max(S.shake, 2.5);
            S.stageHits++;
            S.stageHitHistory[S.stage - 1] = S.stageHits;
            triggerPaddleSound();
          }
        }

        // Horizontal stall prevention
        if (Math.abs(b.vy) < 45) {
          b.vy = (b.vy < 0 ? -45 : 45);
        }

        // Normalize speed
        const sp = Math.hypot(b.vx, b.vy);
        if (sp > 1) {
          const k = targetSpeed / sp;
          b.vx *= k;
          b.vy *= k;
        }
      }

      // Trail recording
      if (S.ballsArr.length <= 120) {
        b.trail.push({ x: b.x, y: b.y });
        if (b.trail.length > 8) b.trail.shift();
      }

      // Lost below the paddle, or escaped above the visible screen.
      // In the video ATTEMPT climbs on every lost ball, even during storms.
      if (b.y > LOSE_Y || b.y < -b.r) {
        S.ballsArr.splice(bi, 1);
        S.attempt++;
        triggerLoseSound();
      }
    }

    // Re-serve only when the chamber is completely empty.
    if (S.ballsArr.length === 0) {
      S.slowUntil = 0;
      S.wideUntil = 0;
      S.banner = null;
      resetBall();
    }

    // Powerups falling
    for (let i = S.powerups.length - 1; i >= 0; i--) {
      const p = S.powerups[i];
      p.y += p.vy * dt;
      p.life -= dt;
      const half = S.paddle.w / 2;
      if (p.y + p.r >= S.paddle.y - S.paddle.h / 2 &&
          p.y - p.r <= S.paddle.y + S.paddle.h / 2 + 6 &&
          Math.abs(p.x - S.paddle.x) <= half + p.r) {
        applyPowerup(p.kind);
        S.powerups.splice(i, 1);
        continue;
      }
      if (p.life <= 0 || p.y > VH + 40) S.powerups.splice(i, 1);
    }

    // Centered notice timer
    if (S.banner) {
      S.banner.timer -= dt;
      if (S.banner.timer <= 0) S.banner = null;
    }

    // Sparks
    for (let i = S.sparks.length - 1; i >= 0; i--) {
      const s = S.sparks[i];
      s.t += dt;
      if (s.t >= s.life) { S.sparks.splice(i, 1); continue; }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += 200 * dt;
    }

    // Reward shockwaves
    for (let i = S.blasts.length - 1; i >= 0; i--) {
      const blast = S.blasts[i];
      blast.t += dt;
      if (blast.t >= blast.life) S.blasts.splice(i, 1);
    }

    if (S.shake > 0) S.shake = Math.max(0, S.shake - dt * 10);

    // Stage Cleared: small card inside the arena, physics keeps running.
    if (!S.allClear && S.cleared >= S.bricksTotal && S.bricksTotal > 0) {
      S.allClear = true;
      triggerClearSound();
    }
  }

  // ---------- Drawing ----------
  function draw() {
    const sx = S.shake > 0 ? rand(-S.shake, S.shake) : 0;
    const sy = S.shake > 0 ? rand(-S.shake, S.shake) : 0;

    ctx.save();
    ctx.translate(sx, sy);

    // Background
    ctx.fillStyle = COL.bg;
    ctx.fillRect(-10, -10, VW + 20, VH + 20);

    // Arena ring: the arc stops at the gate posts (video shows an open notch)
    drawArenaRing();

    // Lower-chamber side walls
    drawSideWalls();

    // Bricks (random warm palette)
    const half = GRID.size / 2;
    let lastColor = "";
    for (const br of S.bricks) {
      if (!br.alive) continue;
      if (br.color !== lastColor) {
        ctx.fillStyle = br.color;
        lastColor = br.color;
      }
      ctx.fillRect(br.x - half, br.y - half, GRID.size, GRID.size);
    }

    // Defensive shield bar (metal grating with rungs)
    drawShieldBar();

    // Gate posts at the bottom opening
    drawGate();

    // Reward shockwave rings
    drawBlasts();

    // Sparks (brick debris / reward particles)
    for (const s of S.sparks) {
      const k = 1 - s.t / s.life;
      ctx.globalAlpha = k;
      ctx.fillStyle = s.color || COL.brick;
      ctx.fillRect(s.x - s.size / 2, s.y - s.size / 2, s.size, s.size);
    }
    ctx.globalAlpha = 1;

    // Paddle (rounded capsule with warm gradient highlight)
    drawPaddle();

    // Powerup badges (~26x24 rounded squares in the video)
    for (const pu of S.powerups) {
      const c = PU[pu.kind];
      ctx.save();
      ctx.globalAlpha = clamp(pu.life, 0, 1);
      ctx.strokeStyle = c.color;
      ctx.lineWidth = 2;
      roundRect(pu.x - 13, pu.y - 12, 26, 24, 6);
      ctx.stroke();
      ctx.fillStyle = c.color;
      ctx.font = `700 13px ${FONT_MONO}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(c.label, pu.x, pu.y + 1);
      ctx.restore();
    }

    // Balls + motion tails
    drawBalls();

    ctx.restore();

    // Victory card sits inside the arena, over the still-running ball storm.
    // Drawn after restore so screen shake does not move it.
    if (S.allClear) drawClearCard();

    // HUD overlays
    drawHUD();
  }

  function drawArenaRing() {
    // Arc endpoints where the circle meets the two gate posts; the small gap
    // between them stays open so the posts read as continuations of the arc.
    const dl = GATE.left - ARENA.cx;
    const dr = GATE.right - ARENA.cx;
    const aL = Math.atan2(Math.sqrt(ARENA.r * ARENA.r - dl * dl), dl);
    const aR = Math.atan2(Math.sqrt(ARENA.r * ARENA.r - dr * dr), dr);
    ctx.strokeStyle = COL.ring;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(ARENA.cx, ARENA.cy, ARENA.r, aL, aR + Math.PI * 2);
    ctx.stroke();
  }

  function drawSideWalls() {
    const w = SIDE_WALL.thickness;
    const sides = [
      { x: SIDE_WALL.left - w, inner: SIDE_WALL.left, leftToRight: true },
      { x: SIDE_WALL.right, inner: SIDE_WALL.right, leftToRight: false },
    ];
    for (const side of sides) {
      const grad = ctx.createLinearGradient(side.x, 0, side.x + w, 0);
      if (side.leftToRight) {
        grad.addColorStop(0, "#142638");
        grad.addColorStop(0.55, "#2c4b63");
        grad.addColorStop(1, "#80d8e9");
      } else {
        grad.addColorStop(0, "#80d8e9");
        grad.addColorStop(0.45, "#2c4b63");
        grad.addColorStop(1, "#142638");
      }
      ctx.fillStyle = grad;
      ctx.fillRect(side.x, SIDE_WALL.top, w, SIDE_WALL.bottom - SIDE_WALL.top);

      ctx.strokeStyle = "rgba(220, 249, 255, 0.42)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let y = SIDE_WALL.top + 16; y < SIDE_WALL.bottom; y += 32) {
        ctx.moveTo(side.x + 2, y);
        ctx.lineTo(side.x + w - 2, y);
      }
      ctx.stroke();
    }
  }

  function drawBlasts() {
    for (const blast of S.blasts) {
      const k = clamp(blast.t / blast.life, 0, 1);
      const ease = 1 - Math.pow(1 - k, 3);
      const radius = 8 + ease * 58;
      ctx.save();
      ctx.shadowColor = "#ffb84d";
      ctx.shadowBlur = 14 * (1 - k);
      ctx.globalAlpha = (1 - k) * 0.9;
      ctx.strokeStyle = blast.color || COL.wide;
      ctx.lineWidth = 1 + 3 * (1 - k);
      ctx.beginPath();
      ctx.arc(blast.x, blast.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      if (k < 0.55) {
        ctx.globalAlpha = (1 - k / 0.55) * 0.38;
        ctx.fillStyle = blast.core || "#fff4bd";
        ctx.beginPath();
        ctx.arc(blast.x, blast.y, 10 + 18 * ease, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawClearCard() {
    const w = 262, h = 90;
    const x = (VW - w) / 2, y = ARENA.cy - 84; // video: y ~= 425..515
    ctx.save();
    ctx.fillStyle = "rgba(4, 10, 20, 0.92)";
    ctx.strokeStyle = "rgba(74, 99, 130, 0.9)";
    ctx.lineWidth = 1.5;
    roundRect(x, y, w, h, 10);
    ctx.fill();
    ctx.stroke();
    const finalStage = S.stage === LEVELS.length;
    ctx.fillStyle = COL.text;
    ctx.font = `600 30px ${FONT_SANS}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(finalStage ? "ALL CLEAR" : `STAGE ${pad(S.stage, 2)} CLEAR`, VW / 2, y + 36);
    ctx.font = `600 12px ${FONT_MONO}`;
    ctx.fillStyle = COL.wide;
    ctx.fillText(`PADDLE HITS ${pad(S.stageHits, 3)}`, VW / 2, y + 64);
    ctx.font = `500 12px ${FONT_MONO}`;
    ctx.fillStyle = COL.dim;
    ctx.fillText(finalStage ? "TAP OR PRESS R TO PLAY AGAIN" : `TAP OR PRESS R FOR STAGE ${pad(S.stage + 1, 2)}`, VW / 2, y + h + 24);
    ctx.restore();
  }

  function drawShieldBar() {
    const w = BAR.x2 - BAR.x1;
    const h = BAR.y2 - BAR.y1;
    const grad = ctx.createLinearGradient(0, BAR.y1, 0, BAR.y2);
    grad.addColorStop(0, "#35536a");
    grad.addColorStop(1, COL.barDark);
    ctx.fillStyle = grad;
    ctx.fillRect(BAR.x1, BAR.y1, w, h);
    ctx.strokeStyle = COL.bar;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(BAR.x1, BAR.y1, w, h);

    ctx.strokeStyle = "rgba(220, 249, 255, 0.62)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = BAR.x1 + 6; x < BAR.x2; x += 7) {
      ctx.moveTo(x, BAR.y1 + 1);
      ctx.lineTo(x, BAR.y2 - 1);
    }
    ctx.stroke();
  }

  function drawGate() {
    // Two posts mark the current stage's dynamic notch edges.
    ctx.strokeStyle = COL.gate;
    ctx.lineWidth = 3.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(GATE.left, GATE.top);
    ctx.lineTo(GATE.left, GATE.bottom);
    ctx.moveTo(GATE.right, GATE.top);
    ctx.lineTo(GATE.right, GATE.bottom);
    ctx.stroke();
  }

  function drawPaddle() {
    const p = S.paddle;
    const px = p.x - p.w / 2;
    const py = p.y - p.h / 2;
    const grad = ctx.createLinearGradient(0, py, 0, py + p.h);
    grad.addColorStop(0, "#ffe29a");
    grad.addColorStop(0.45, COL.paddle);
    grad.addColorStop(1, "#e8a83e");
    ctx.fillStyle = grad;
    roundRect(px, py, p.w, p.h, p.h / 2);
    ctx.fill();

    ctx.fillStyle = "rgba(255, 255, 255, 0.28)";
    roundRect(px + 7, py + 4, p.w - 14, 3, 1.5);
    ctx.fill();
  }

  function drawBalls() {
    const count = S.ballsArr.length;
    ctx.fillStyle = COL.ball;
    ctx.strokeStyle = COL.ballTrail;

    if (count <= 120) {
      ctx.shadowColor = COL.ballTrail;
      ctx.shadowBlur = 7;
      // Smooth fading multi-point trail
      for (const b of S.ballsArr) {
        if (b.trail.length > 1) {
          ctx.lineWidth = 2;
          ctx.lineCap = "round";
          for (let i = 1; i < b.trail.length; i++) {
            const a = b.trail[i - 1];
            const c = b.trail[i];
            ctx.globalAlpha = (i / b.trail.length) * 0.5;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(c.x, c.y);
            ctx.stroke();
          }
        }
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    } else {
      // Optimized high-count vector trails for ultra-fast 60fps rendering
      ctx.lineWidth = 1.8;
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        const b = S.ballsArr[i];
        ctx.moveTo(b.x - b.vx * 0.02, b.y - b.vy * 0.02);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();

      // Ball discs
      ctx.globalAlpha = 1;
      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        const b = S.ballsArr[i];
        ctx.moveTo(b.x + b.r, b.y);
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      }
      ctx.fill();
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function drawHUD() {
    ctx.textBaseline = "alphabetic";

    // Header: sans-serif wide face; measured baselines y=95 / 143 / 186.
    ctx.textAlign = "center";
    ctx.fillStyle = COL.text;
    ctx.font = `700 32px ${FONT_SANS}`;
    if ("letterSpacing" in ctx) ctx.letterSpacing = "3px";
    ctx.fillText("PING-PONG", VW / 2, 95);
    ctx.font = `500 15px ${FONT_SANS}`;
    if ("letterSpacing" in ctx) ctx.letterSpacing = "2px";
    ctx.fillStyle = COL.dim;
    ctx.fillText(`STAGE ${pad(S.stage, 2)} / ${pad(LEVELS.length, 2)}  -  GATE ${pad(LEVELS[S.stage - 1].gate, 3)}  /  BAR ${pad(BAR.x2 - BAR.x1, 3)}`, VW / 2, 143);
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";

    // CLEARED (left) & BALLS (right). Video BALLS = live balls, not served.
    ctx.font = `500 17px ${FONT_MONO}`;
    ctx.textAlign = "left";
    ctx.fillStyle = COL.dim;
    ctx.fillText("CLEARED ", 35, 186);
    ctx.fillStyle = COL.text;
    ctx.fillText(`${pad(S.cleared, 4)} / ${pad(S.bricksTotal, 4)}`, 115, 186);

    ctx.textAlign = "right";
    ctx.fillStyle = COL.dim;
    ctx.fillText("BALLS ", VW - 75, 186);
    ctx.fillStyle = COL.text;
    ctx.fillText(pad(S.ballsArr.length, 3), VW - 35, 186);

    // Separator line across bottom at y=1132
    ctx.strokeStyle = COL.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(35, 1132);
    ctx.lineTo(VW - 35, 1132);
    ctx.stroke();

    // Bottom HUD row at y=1182
    ctx.textAlign = "left";
    ctx.font = `500 16px ${FONT_MONO}`;
    ctx.fillStyle = COL.dim;
    ctx.fillText("ATTEMPT " + pad(S.attempt, 2), 35, 1182);
    ctx.fillStyle = COL.dim;
    ctx.fillText("HITS ", 205, 1182);
    ctx.fillStyle = COL.wide;
    ctx.fillText(pad(S.stageHits, 3), 252, 1182);

    // Right-bottom power-up: countdown + proportional bar.
    // WIDE wins when both are active (video at ~88s shows WIDE 3.0s + SLOW / 4s).
    let puColor = null, puText = "NO POWER-UP", puProg = 0;
    if (S.wideUntil > S.time) {
      puColor = COL.wide;
      puText = `WIDE ${((S.wideUntil - S.time) / 1000).toFixed(1)}s`;
      puProg = (S.wideUntil - S.time) / PU.W.dur;
    } else if (S.slowUntil > S.time) {
      puColor = COL.slow;
      puText = `SLOW ${((S.slowUntil - S.time) / 1000).toFixed(1)}s`;
      puProg = (S.slowUntil - S.time) / PU.S.dur;
    }
    ctx.textAlign = "right";
    ctx.fillStyle = puColor || COL.dim;
    ctx.fillText(puText, VW - 35, 1182);
    if (puColor) {
      const barW = 140;
      ctx.strokeStyle = puColor;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(VW - 35 - barW, 1200);
      ctx.lineTo(VW - 35 - barW + barW * clamp(puProg, 0, 1), 1200);
      ctx.stroke();
    }

    // Centered notice at y=900: pick-up / x3 result, then SLOW countdown.
    ctx.textAlign = "center";
    if (S.banner && S.banner.timer > 0) {
      ctx.fillStyle = COL.text;
      ctx.font = `700 24px ${FONT_MONO}`;
      ctx.fillText(S.banner.text, VW / 2, 900);
    } else if (S.slowUntil > S.time) {
      const left = Math.ceil((S.slowUntil - S.time) / 1000);
      ctx.fillStyle = COL.text;
      ctx.font = `700 22px ${FONT_MONO}`;
      ctx.fillText(`SLOW / ${left}s`, VW / 2, 900);
    }
  }

  // ---------- Input Handlers ----------
  let dragging = false;

  function pointerX(clientX) {
    const rect = canvas.getBoundingClientRect();
    return ((clientX - rect.left) / rect.width) * VW;
  }

  canvas.addEventListener("pointerdown", (e) => {
    initAudio();
    if (S.allClear) { advanceStage(); return; }
    dragging = true;
    S.paddle.x = clamp(pointerX(e.clientX), 70, VW - 70);
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    S.paddle.x = clamp(pointerX(e.clientX), 70, VW - 70);
  });
  canvas.addEventListener("pointerup", () => { dragging = false; });
  canvas.addEventListener("pointercancel", () => { dragging = false; });

  window.addEventListener("keydown", (e) => {
    initAudio();
    if (e.key === "r" || e.key === "R") {
      if (S.allClear) advanceStage();
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") S.paddle.x -= 28;
    if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") S.paddle.x += 28;
    S.paddle.x = clamp(S.paddle.x, 70, VW - 70);
  });

  // ---------- Lifecycle ----------
  function startGame(stage = 1) {
    initAudio();
    S.mode = "play";
    S.stage = typeof stage === "number" ? clamp(Math.round(stage), 1, LEVELS.length) : 1;
    S.cleared = 0;
    S.attempt = 1;
    S.ballsServed = 0;
    S.stageHits = 0;
    S.barGrowth = 0;
    if (S.stage === 1 || S.stageHitHistory.length !== LEVELS.length) {
      S.stageHitHistory = Array(LEVELS.length).fill(0);
    }
    S.powerups = [];
    S.sparks = [];
    S.blasts = [];
    S.slowUntil = 0;
    S.wideUntil = 0;
    S.banner = null;
    S.allClear = false;
    S.shake = 0;
    S.time = 0;
    configureGate();
    configureShieldBar();
    buildBricks();
    resetBall();
    document.getElementById("startScreen").classList.add("hidden");
  }

  function advanceStage() {
    if (!S.allClear) return;
    startGame(S.stage === LEVELS.length ? 1 : S.stage + 1);
  }

  document.getElementById("startBtn").addEventListener("click", startGame);

  // ---------- Main Loop ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;
    if (S.mode === "play") {
      S.time += dt * 1000;
      updatePhysics(dt);
    }
    draw();
    requestAnimationFrame(frame);
  }

  configureGate();
  configureShieldBar();
  buildBricks();
  resetBall();
  requestAnimationFrame(frame);
})();
