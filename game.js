(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d", { alpha: false });

  const scoreEl = document.getElementById("score");
  const hintEl = document.getElementById("hint");
  const statusEl = document.getElementById("status");

  const btnRestart = document.getElementById("btnRestart");
  const btnPause = document.getElementById("btnPause");
  const btnMenu = document.getElementById("btnMenu");

  const menu = document.getElementById("menu");
  const btnCloseMenu = document.getElementById("btnCloseMenu");
  const btnMenuStart = document.getElementById("btnMenuStart");
  const playerFacesGrid = document.getElementById("playerFaces");
  const cpuFacesGrid = document.getElementById("cpuFaces");

  const intro = document.getElementById("intro");
  const countdownNumber = document.getElementById("countdownNumber");
  const countdownText = document.getElementById("countdownText");

  // Victory overlay
  const victory = document.getElementById("victory");
  const victoryFace = document.getElementById("victoryFace");
  const victoryTitle = document.getElementById("victoryTitle");
  const victoryName = document.getElementById("victoryName");
  const btnVictoryAgain = document.getElementById("btnVictoryAgain");
  const btnVictoryClose = document.getElementById("btnVictoryClose");

  // ====== Лица (перечень файлов в assets/) ======
  const FACE_FILES = [
    "face_player.png",
    "face_cpu.png",
    "face_1.png",
    "face_2.png",
    "face_3.png",
    "face_4.png"
  ].map(n => `assets/${n}`);

  // ====== Настройки ======
  const WIN_SCORE = 10;
  const WORLD = { w: 900, h: 500 };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  // ====== Canvas DPI ======
  function resize() {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize, { passive: true });
  resize();

  function screenToWorldY(screenY) {
    return (screenY / window.innerHeight) * WORLD.h;
  }

  // ====== WebAudio: эффекты + "толпа" + победная мелодия ======
  let audioCtx = null;

  let crowd = {
    source: null,
    gain: null,
    filter1: null,
    filter2: null,
    lfo: null,
    lfoGain: null,
    started: false,
  };

  // Victory tune
  let victoryTuneTimer = null;
  let victoryTuneStep = 0;

  function ensureAudio() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
    if (audioCtx && !crowd.started) startCrowd();
  }

  function midiToFreq(n) {
    return 440 * Math.pow(2, (n - 69) / 12);
  }

  function playNote({ midi = 60, dur = 0.18, type = "triangle", gain = 0.05 } = {}) {
    if (!audioCtx) return;

    const t0 = audioCtx.currentTime;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();

    o.type = type;
    o.frequency.setValueAtTime(midiToFreq(midi), t0);

    // ADSR-ish
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    o.connect(g);
    g.connect(audioCtx.destination);

    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  function beep({ freq = 440, dur = 0.06, type = "square", gain = 0.04 } = {}) {
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();

    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    o.connect(g);
    g.connect(audioCtx.destination);

    o.start(t0);
    o.stop(t0 + dur);
  }

  function createNoiseBuffer(seconds = 2.0) {
    const sr = audioCtx.sampleRate;
    const len = Math.floor(sr * seconds);
    const buffer = audioCtx.createBuffer(1, len, sr);
    const data = buffer.getChannelData(0);

    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.0990460;
      b1 = 0.96300 * b1 + white * 0.2965164;
      b2 = 0.57000 * b2 + white * 1.0526913;
      data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.12;
    }
    return buffer;
  }

  function startCrowd() {
    if (!audioCtx || crowd.started) return;

    const src = audioCtx.createBufferSource();
    src.buffer = createNoiseBuffer(2.0);
    src.loop = true;

    const g = audioCtx.createGain();
    g.gain.value = 0.0;

    const hp = audioCtx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 250;

    const lp = audioCtx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2200;

    const lfo = audioCtx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 0.12;

    const lfoGain = audioCtx.createGain();
    lfoGain.gain.value = 0.06;

    lfo.connect(lfoGain);
    lfoGain.connect(g.gain);

    src.connect(hp);
    hp.connect(lp);
    lp.connect(g);
    g.connect(audioCtx.destination);

    src.start();
    lfo.start();

    crowd = { source: src, gain: g, filter1: hp, filter2: lp, lfo, lfoGain, started: true };
    setCrowdVolume(0.0, 0.01);
  }

  function setCrowdVolume(vol, rampSec = 0.25) {
    if (!audioCtx || !crowd.gain) return;
    const t0 = audioCtx.currentTime;
    crowd.gain.gain.cancelScheduledValues(t0);
    crowd.gain.gain.setValueAtTime(crowd.gain.gain.value, t0);
    crowd.gain.gain.linearRampToValueAtTime(vol, t0 + rampSec);
  }

  function startVictoryTune() {
    if (!audioCtx) return;
    stopVictoryTune();

    // “midi-like” луп: простая победная последовательность (C major-ish)
    // Играть будем в 140 bpm примерно
    const seq = [
      // аккорд/мелодия: C E G C | D F A D | E G B E | G E D C
      { m: 72, d: 0.16, g: 0.06 }, { m: 76, d: 0.16, g: 0.05 }, { m: 79, d: 0.18, g: 0.05 },
      { m: 74, d: 0.16, g: 0.06 }, { m: 77, d: 0.16, g: 0.05 }, { m: 81, d: 0.18, g: 0.05 },
      { m: 76, d: 0.16, g: 0.06 }, { m: 79, d: 0.16, g: 0.05 }, { m: 83, d: 0.18, g: 0.05 },
      { m: 79, d: 0.14, g: 0.06 }, { m: 76, d: 0.14, g: 0.05 }, { m: 74, d: 0.14, g: 0.05 }, { m: 72, d: 0.22, g: 0.06 },
    ];

    victoryTuneStep = 0;
    victoryTuneTimer = setInterval(() => {
      const s = seq[victoryTuneStep % seq.length];

      // верхняя мелодия
      playNote({ midi: s.m, dur: s.d, type: "triangle", gain: s.g });

      // лёгкий бас на каждую вторую ноту
      if (victoryTuneStep % 2 === 0) {
        playNote({ midi: s.m - 24, dur: 0.20, type: "sine", gain: 0.035 });
      }

      victoryTuneStep++;
    }, 170); // шаг
  }

  function stopVictoryTune() {
    if (victoryTuneTimer) {
      clearInterval(victoryTuneTimer);
      victoryTuneTimer = null;
    }
  }

  function vibe(ms) {
    if (navigator.vibrate) navigator.vibrate(ms);
  }

  // ====== Частицы ======
  const particles = [];
  function spawnParticles(x, y, count, strength, tint = "rgba(255,255,255,0.85)") {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = strength * (0.5 + Math.random() * 0.9);
      particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.35 + Math.random() * 0.35,
        age: 0,
        r: 1.5 + Math.random() * 2.2,
        tint
      });
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.age += dt;
      if (p.age >= p.life) {
        particles.splice(i, 1);
        continue;
      }
      p.vx *= (1 - 2.4 * dt);
      p.vy *= (1 - 2.4 * dt);
      p.vy += 420 * dt * 0.12;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  function drawParticles() {
    for (const p of particles) {
      const t = 1 - (p.age / p.life);
      ctx.globalAlpha = Math.max(0, t);
      ctx.fillStyle = p.tint;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ====== След мяча ======
  const trail = [];
  function pushTrail(x, y) {
    trail.push({ x, y, life: 0.18, age: 0 });
    if (trail.length > 26) trail.shift();
  }
  function updateTrail(dt) {
    for (let i = trail.length - 1; i >= 0; i--) {
      trail[i].age += dt;
      if (trail[i].age >= trail[i].life) trail.splice(i, 1);
    }
  }
  function drawTrail() {
    for (const t of trail) {
      const k = 1 - (t.age / t.life);
      ctx.globalAlpha = Math.max(0, k) * 0.55;
      ctx.fillStyle = "rgba(255, 211, 122, 1)";
      ctx.beginPath();
      ctx.arc(t.x, t.y, 7 * k, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ====== Загрузка картинок ======
  function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.src = src;
      img.onload = () => resolve({ src, img, ok: true });
      img.onerror = () => resolve({ src, img, ok: false });
    });
  }

  const faces = { player: new Image(), cpu: new Image() };

  // ====== Сущности ======
  const court = { padding: 40, netX: WORLD.w / 2 };

  const player = {
    x: 140, y: WORLD.h / 2, r: 26, faceR: 18,
    racket: { w: 10, h: 60, offsetX: 30 },
    targetY: WORLD.h / 2, tilt: 0, lastHitAt: -999,
  };

  const cpu = {
    x: WORLD.w - 140, y: WORLD.h / 2, r: 26, faceR: 18,
    racket: { w: 10, h: 60, offsetX: -30 },
    speed: 260, tilt: 0, lastHitAt: -999,
  };

  const ball = {
    x: WORLD.w / 2, y: WORLD.h / 2, r: 10,
    vx: 360, vy: 160, maxV: 720,
    superUntil: 0, lastOwner: null,
  };

  const state = {
    scoreP: 0,
    scoreC: 0,
    running: true,
    paused: false,

    needsIntro: true,
    inIntro: false,

    victoryShown: false,

    lastTime: performance.now(),
    message: "",
    messageUntil: 0,
  };

  // ====== Управление и скорость свайпа ======
  let isPointerDown = false;
  let swipeSpeed = 0;
  let lastPtr = null;

  function onPointerDown(e) {
    ensureAudio();
    isPointerDown = true;

    const y = screenToWorldY(e.clientY ?? 0);
    player.targetY = y;

    lastPtr = { y, t: performance.now() };
  }

  function onPointerMove(e) {
    if (!isPointerDown) return;
    const y = screenToWorldY(e.clientY ?? 0);
    player.targetY = y;

    const now = performance.now();
    if (lastPtr) {
      const dy = Math.abs(y - lastPtr.y);
      const dt = Math.max(1, now - lastPtr.t) / 1000;
      const v = dy / dt;
      swipeSpeed = lerp(swipeSpeed, v, 0.35);
      lastPtr = { y, t: now };
    } else {
      lastPtr = { y, t: now };
    }
  }

  function onPointerUp() {
    isPointerDown = false;
    lastPtr = null;
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);

  // ====== Коллизии ======
  function racketRect(p) {
    const rx = p.x + p.racket.offsetX - p.racket.w / 2;
    const ry = p.y - p.racket.h / 2;
    return { x: rx, y: ry, w: p.racket.w, h: p.racket.h };
  }

  function circleRectCollision(cx, cy, cr, r) {
    const closestX = clamp(cx, r.x, r.x + r.w);
    const closestY = clamp(cy, r.y, r.y + r.h);
    const dx = cx - closestX;
    const dy = cy - closestY;
    return (dx * dx + dy * dy) <= cr * cr;
  }

  function resetBall(servingDir) {
    ball.x = WORLD.w / 2;
    ball.y = WORLD.h / 2;

    const angle = (Math.random() * 0.9 - 0.45);
    const speed = 420;
    ball.vx = Math.cos(angle) * speed * servingDir;
    ball.vy = Math.sin(angle) * speed;

    ball.superUntil = 0;
    trail.length = 0;
    ball.lastOwner = null;
  }

  function updateScoreUI() {
    scoreEl.textContent = `${state.scoreP} : ${state.scoreC}`;
  }

  // ====== Пауза ======
  function setPaused(p) {
    state.paused = p;
    if (p) {
      btnPause.textContent = "▶";
      if (!state.inIntro && !state.victoryShown) statusEl.textContent = "Пауза";
      setCrowdVolume(0.04, 0.35);
    } else {
      btnPause.textContent = "⏸";
      statusEl.textContent = "";
      state.lastTime = performance.now();
      setCrowdVolume(0.12, 0.5);
    }
  }

  // ====== Супер-удар ======
  function trySuperHit(owner) {
    const threshold = 1100;
    if (owner !== "player") return false;
    if (swipeSpeed >= threshold) {
      ball.superUntil = performance.now() + 1200;
      return true;
    }
    return false;
  }

  function bounceFromRacket(p, isLeft, ownerKey) {
    const rr = racketRect(p);
    const hitPos = (ball.y - rr.y) / rr.h;
    const centerOffset = (hitPos - 0.5) * 2;

    let speed = clamp(Math.hypot(ball.vx, ball.vy) * 1.04, 420, ball.maxV);
    const superHit = trySuperHit(ownerKey);

    if (superHit) {
      speed = clamp(speed * 1.35, 520, ball.maxV);
      statusEl.textContent = "СУПЕР-УДАР!";
      setTimeout(() => { if (!state.paused && !state.inIntro && !state.victoryShown) statusEl.textContent = ""; }, 650);
    }

    const vxSign = isLeft ? 1 : -1;
    const angle = centerOffset * 0.9;

    ball.vx = Math.cos(angle) * speed * vxSign;
    ball.vy = Math.sin(angle) * speed;

    ball.x = isLeft ? (rr.x + rr.w + ball.r + 0.5) : (rr.x - ball.r - 0.5);
    ball.lastOwner = ownerKey;

    const px = isLeft ? (rr.x + rr.w) : rr.x;
    spawnParticles(px, ball.y, superHit ? 26 : 16, superHit ? 520 : 380, "rgba(255,255,255,0.9)");

    if (superHit) {
      vibe([20, 30, 20]);
      if (audioCtx) {
        beep({ freq: 920, dur: 0.05, type: "sawtooth", gain: 0.06 });
        beep({ freq: 620, dur: 0.08, type: "square", gain: 0.04 });
      }
    } else {
      vibe(12);
      if (audioCtx) beep({ freq: 520 + Math.random() * 160, dur: 0.05, type: "square", gain: 0.04 });
    }

    p.lastHitAt = performance.now();
  }

  function onPointScored(who) {
    state.message = who === "PLAYER" ? "Очко тебе!" : "Очко CPU!";
    state.messageUntil = performance.now() + 900;

    vibe(18);
    if (audioCtx) beep({ freq: who === "PLAYER" ? 740 : 330, dur: 0.12, type: "triangle", gain: 0.05 });
    spawnParticles(WORLD.w / 2, WORLD.h / 2, 22, 420, "rgba(255,211,122,0.95)");
  }

  // ====== Интро ======
  let introTimer = null;

  function showIntro(show) {
    if (!intro) return;
    if (show) {
      intro.classList.remove("introHidden");
      intro.classList.add("introVisible");
      intro.setAttribute("aria-hidden", "false");
    } else {
      intro.classList.remove("introVisible");
      intro.classList.add("introHidden");
      intro.setAttribute("aria-hidden", "true");
    }
  }

  function runIntroSequence() {
    state.inIntro = true;
    state.needsIntro = false;

    setPaused(true);
    statusEl.textContent = "Интро";

    showIntro(true);
    countdownText.textContent = "Приготовься…";
    countdownNumber.textContent = "3";
    setCrowdVolume(0.07, 0.5);

    if (introTimer) {
      clearTimeout(introTimer);
      introTimer = null;
    }

    const steps = [
      { n: "3", t: "Приготовься…" },
      { n: "2", t: "Разминка закончена" },
      { n: "1", t: "Судья смотрит строго" },
      { n: "PLAY", t: "Поехали!" },
    ];

    let i = 0;

    const tick = () => {
      const s = steps[i];
      countdownNumber.textContent = s.n;
      countdownText.textContent = s.t;

      ensureAudio();

      if (audioCtx) {
        if (s.n === "PLAY") {
          beep({ freq: 880, dur: 0.14, type: "sine", gain: 0.06 });
          beep({ freq: 660, dur: 0.10, type: "triangle", gain: 0.04 });
        } else {
          const freq = 420 + (3 - i) * 90;
          beep({ freq, dur: 0.08, type: "triangle", gain: 0.05 });
        }
      }

      if (s.n !== "PLAY") vibe(10);
      else vibe([18, 40, 18]);

      i++;
      if (i < steps.length) {
        introTimer = setTimeout(tick, 780);
      } else {
        introTimer = setTimeout(() => {
          state.inIntro = false;
          showIntro(false);
          setPaused(false);
          resetBall(Math.random() < 0.5 ? 1 : -1);

          setCrowdVolume(0.12, 0.9);
          setCrowdVolume(0.18, 0.15);
          setTimeout(() => setCrowdVolume(0.12, 0.65), 260);

          statusEl.textContent = "";
        }, 650);
      }
    };

    introTimer = setTimeout(tick, 350);
  }

  // ====== Victory Overlay ======
  function showVictoryOverlay(winnerKey) {
    // winnerKey: "player" | "cpu"
    state.victoryShown = true;
    setPaused(true);

    // приглушаем толпу, чтобы музыка не кашляла
    setCrowdVolume(0.03, 0.4);

    const isPlayer = winnerKey === "player";
    victoryTitle.textContent = isPlayer ? "ТЫ — ЧЕМПИОН!" : "CPU ПОБЕДИЛ!";
    victoryName.textContent = isPlayer ? "Champion: You" : "Champion: CPU";

    // лицо победителя
    const img = isPlayer ? faces.player : faces.cpu;
    victoryFace.src = img.src;

    victory.classList.remove("hidden");
    victory.setAttribute("aria-hidden", "false");

    // конфетти-частицы
    for (let k = 0; k < 6; k++) {
      spawnParticles(WORLD.w / 2, WORLD.h / 2, 18, 520, "rgba(255,211,122,0.95)");
      spawnParticles(WORLD.w / 2, WORLD.h / 2, 16, 520, "rgba(170,190,255,0.9)");
    }

    // музыка победы
    ensureAudio();
    startVictoryTune();

    // вибро-аплодисменты
    vibe([25, 40, 25, 40, 25]);
  }

  function hideVictoryOverlay() {
    state.victoryShown = false;
    victory.classList.add("hidden");
    victory.setAttribute("aria-hidden", "true");
    stopVictoryTune();
  }

  // ====== Матч ======
  function resetMatch() {
    hideVictoryOverlay();

    state.scoreP = 0;
    state.scoreC = 0;
    state.running = true;

    state.message = "";
    state.messageUntil = 0;

    player.y = WORLD.h / 2;
    player.targetY = WORLD.h / 2;
    cpu.y = WORLD.h / 2;

    swipeSpeed = 0;

    updateScoreUI();
    resetBall(Math.random() < 0.5 ? 1 : -1);

    hintEl.textContent = "Свайп — движение. Быстрый свайп = супер-удар.";
    statusEl.textContent = "";

    // После рестарта: меню -> интро
    state.needsIntro = true;
    showIntro(false);
    openMenu(true);
  }

  // ====== Update ======
  function update(dt) {
    updateTrail(dt);
    updateParticles(dt);

    if (!state.running) return;
    if (state.paused) return;

    swipeSpeed = lerp(swipeSpeed, 0, 1 - Math.pow(0.0006, dt));

    player.y = lerp(player.y, player.targetY, 1 - Math.pow(0.0001, dt));
    player.y = clamp(player.y, court.padding + player.r, WORLD.h - court.padding - player.r);

    const ballComing = ball.vx > 0;
    const desiredY = ballComing ? ball.y : WORLD.h / 2;
    const dy = desiredY - cpu.y;
    const maxStep = cpu.speed * dt * (ballComing ? 1.0 : 0.55);
    cpu.y += clamp(dy, -maxStep, maxStep);
    cpu.y = clamp(cpu.y, court.padding + cpu.r, WORLD.h - court.padding - cpu.r);

    const playerTiltTarget = clamp((ball.y - player.y) / 220, -1, 1) * 0.22;
    const cpuTiltTarget = clamp((ball.y - cpu.y) / 220, -1, 1) * 0.22;
    player.tilt = lerp(player.tilt, playerTiltTarget, 1 - Math.pow(0.001, dt));
    cpu.tilt = lerp(cpu.tilt, cpuTiltTarget, 1 - Math.pow(0.001, dt));

    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    if (performance.now() < ball.superUntil) pushTrail(ball.x, ball.y);

    // стены
    if (ball.y - ball.r <= court.padding) {
      ball.y = court.padding + ball.r;
      ball.vy *= -1;
      spawnParticles(ball.x, court.padding, 8, 240, "rgba(255,255,255,0.75)");
      if (audioCtx) beep({ freq: 260, dur: 0.03, type: "triangle", gain: 0.03 });
    }
    if (ball.y + ball.r >= WORLD.h - court.padding) {
      ball.y = WORLD.h - court.padding - ball.r;
      ball.vy *= -1;
      spawnParticles(ball.x, WORLD.h - court.padding, 8, 240, "rgba(255,255,255,0.75)");
      if (audioCtx) beep({ freq: 260, dur: 0.03, type: "triangle", gain: 0.03 });
    }

    // ракетки
    const rrP = racketRect(player);
    const rrC = racketRect(cpu);

    if (ball.vx < 0 && circleRectCollision(ball.x, ball.y, ball.r, rrP)) {
      bounceFromRacket(player, true, "player");
    }
    if (ball.vx > 0 && circleRectCollision(ball.x, ball.y, ball.r, rrC)) {
      bounceFromRacket(cpu, false, "cpu");
    }

    // голы
    if (ball.x < -50) {
      state.scoreC += 1;
      updateScoreUI();
      onPointScored("CPU");
      resetBall(1);
    }
    if (ball.x > WORLD.w + 50) {
      state.scoreP += 1;
      updateScoreUI();
      onPointScored("PLAYER");
      resetBall(-1);
    }

    // победа
    if (state.scoreP >= WIN_SCORE || state.scoreC >= WIN_SCORE) {
      state.running = false;

      // показываем победителя
      const winnerKey = state.scoreP >= WIN_SCORE ? "player" : "cpu";
      showVictoryOverlay(winnerKey);
    }

    if (performance.now() > state.messageUntil && state.message) state.message = "";
  }

  // ====== Render ======
  function drawCourt() {
    ctx.fillStyle = "#08102a";
    ctx.fillRect(0, 0, WORLD.w, WORLD.h);

    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 4;
    ctx.strokeRect(court.padding, court.padding, WORLD.w - court.padding * 2, WORLD.h - court.padding * 2);

    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 10]);
    ctx.beginPath();
    ctx.moveTo(court.netX, court.padding);
    ctx.lineTo(court.netX, WORLD.h - court.padding);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "rgba(0,0,0,0.12)";
    ctx.fillRect(court.netX - 2, court.padding, 4, WORLD.h - court.padding * 2);
  }

  function drawPlayer(p, faceImg, isLeft) {
    const rr = racketRect(p);
    const towardBall = clamp((ball.y - p.y) / 140, -1, 1);
    const racketAngle = towardBall * 0.35 + (isLeft ? 0.10 : -0.10);

    const sinceHit = (performance.now() - p.lastHitAt) / 1000;
    const hitKick = sinceHit < 0.12 ? (1 - sinceHit / 0.12) : 0;
    const kick = hitKick * 6;

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.tilt);

    ctx.fillStyle = "#c9d6ff";
    ctx.beginPath();
    ctx.arc(0, 0, p.r, 0, Math.PI * 2);
    ctx.fill();

    if (faceImg && faceImg.naturalWidth > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, p.faceR, 0, Math.PI * 2);
      ctx.clip();
      const size = p.faceR * 2;
      ctx.drawImage(faceImg, -p.faceR, -p.faceR, size, size);
      ctx.restore();

      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, p.faceR, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();

    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(rr.x + rr.w / 2 + (isLeft ? kick : -kick), p.y);
    ctx.stroke();

    const racketCx = rr.x + rr.w / 2 + (isLeft ? kick : -kick);
    const racketCy = rr.y + rr.h / 2;

    ctx.save();
    ctx.translate(racketCx, racketCy);
    ctx.rotate(racketAngle);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(-rr.w / 2, -rr.h / 2, rr.w, rr.h);

    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = 2;
    ctx.strokeRect(-rr.w / 2, -rr.h / 2, rr.w, rr.h);
    ctx.restore();
  }

  function drawBall() {
    if (trail.length) drawTrail();

    ctx.fillStyle = "#ffd37a";
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.beginPath();
    ctx.arc(ball.x - 3, ball.y - 4, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawMessage() {
    if (!state.message) return;
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(WORLD.w / 2 - 160, 18, 320, 42);

    ctx.fillStyle = "#ffffff";
    ctx.font = "700 18px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(state.message, WORLD.w / 2, 39);
  }

  function render() {
    const sw = window.innerWidth;
    const sh = window.innerHeight;

    const scale = Math.min(sw / WORLD.w, sh / WORLD.h);
    const offsetX = (sw - WORLD.w * scale) / 2;
    const offsetY = (sh - WORLD.h * scale) / 2;

    ctx.clearRect(0, 0, sw, sh);

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    drawCourt();
    drawParticles();
    drawPlayer(player, faces.player, true);
    drawPlayer(cpu, faces.cpu, false);
    drawBall();
    drawMessage();

    ctx.restore();
  }

  // ====== Loop ======
  function loop(now) {
    const dt = Math.min(0.033, (now - state.lastTime) / 1000);
    state.lastTime = now;

    update(dt);
    render();

    requestAnimationFrame(loop);
  }

  // ====== Меню выбора лиц ======
  let faceList = [];
  let selectedPlayerSrc = null;
  let selectedCpuSrc = null;

  function clearGrid(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  function makeFaceButton(entry, selectedSrc, onSelect) {
    const btn = document.createElement("div");
    btn.className = "faceBtn" + (entry.src === selectedSrc ? " selected" : "");
    const img = document.createElement("img");
    img.src = entry.src;

    const name = document.createElement("div");
    name.className = "faceName";
    name.textContent = entry.src.split("/").pop();

    btn.appendChild(img);
    btn.appendChild(name);

    btn.addEventListener("click", () => onSelect(entry.src));
    return btn;
  }

  function renderMenuGrids() {
    clearGrid(playerFacesGrid);
    clearGrid(cpuFacesGrid);

    for (const entry of faceList) {
      playerFacesGrid.appendChild(
        makeFaceButton(entry, selectedPlayerSrc, (src) => {
          selectedPlayerSrc = src;
          faces.player.src = src;
          renderMenuGrids();
        })
      );
      cpuFacesGrid.appendChild(
        makeFaceButton(entry, selectedCpuSrc, (src) => {
          selectedCpuSrc = src;
          faces.cpu.src = src;
          renderMenuGrids();
        })
      );
    }
  }

  function openMenu(initial = false) {
    showIntro(false);
    state.inIntro = false;

    menu.classList.remove("hidden");

    if (initial) {
      setPaused(true);
      statusEl.textContent = "Выбор лиц";
      setCrowdVolume(0.0, 0.25);
    }
  }

  function closeMenu() {
    menu.classList.add("hidden");
  }

  // ====== UI ======
  btnRestart.addEventListener("click", () => {
    ensureAudio();
    resetMatch();
  });

  btnPause.addEventListener("click", () => {
    ensureAudio();
    if (state.inIntro) return;
    if (!menu.classList.contains("hidden")) return;
    if (state.victoryShown) return;
    setPaused(!state.paused);
  });

  btnMenu.addEventListener("click", () => {
    ensureAudio();
    if (state.victoryShown) return;
    openMenu(false);
  });

  btnCloseMenu.addEventListener("click", () => closeMenu());

  btnMenuStart.addEventListener("click", () => {
    ensureAudio();
    closeMenu();
    statusEl.textContent = "";

    if (state.needsIntro) runIntroSequence();
    else setPaused(false);
  });

  // Victory buttons
  btnVictoryAgain.addEventListener("click", () => {
    ensureAudio();
    resetMatch();
  });
  btnVictoryClose.addEventListener("click", () => {
    ensureAudio();
    hideVictoryOverlay();
    // остаёмся на финальном экране матча (как было), но без оверлея
    statusEl.textContent = "Матч окончен";
  });

  // Тап по победному экрану тоже включает звук
  victory.addEventListener("pointerdown", () => ensureAudio());

  // Автопауза при скрытии вкладки
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      setPaused(true);
      setCrowdVolume(0.03, 0.3);
    }
  });

  // Нажатие по интро оверлею тоже разблокирует звук
  intro.addEventListener("pointerdown", () => ensureAudio());

  // ====== Старт ======
  (async () => {
    const loaded = await Promise.all(FACE_FILES.map(loadImage));
    faceList = loaded.filter(x => x.ok);

    selectedPlayerSrc = faceList[0]?.src || "assets/face_player.png";
    selectedCpuSrc = faceList[1]?.src || faceList[0]?.src || "assets/face_cpu.png";

    faces.player.src = selectedPlayerSrc;
    faces.cpu.src = selectedCpuSrc;

    renderMenuGrids();

    // Подготавливаем матч, но НЕ начинаем до интро
    state.scoreP = 0;
    state.scoreC = 0;
    state.running = true;
    state.paused = true;

    updateScoreUI();
    resetBall(Math.random() < 0.5 ? 1 : -1);

    hintEl.textContent = "Свайп — движение. Быстрый свайп = супер-удар.";
    statusEl.textContent = "Выбор лиц";

    // Сначала меню
    state.needsIntro = true;
    showIntro(false);
    openMenu(true);

    requestAnimationFrame((t) => {
      state.lastTime = t;
      requestAnimationFrame(loop);
    });
  })();
})();
