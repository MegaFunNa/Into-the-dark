// Main Game Loop — 1.9s Flashlight Intro, Energetic Sprinting Camcorder, Fair Tree Graze & Blink-Reveal Death Cutscene
(function () {
  "use strict";

  let ysdk = null;
  let adShowing = false;
  let pausedByPlatform = false;
  let gameplayActive = false;

  function setGameplayActive(active) {
    const next = Boolean(active);
    if (!ysdk || !ysdk.features || !ysdk.features.GameplayAPI) return;
    if (next === gameplayActive) return;
    gameplayActive = next;
    try {
      if (next) ysdk.features.GameplayAPI.start();
      else ysdk.features.GameplayAPI.stop();
    } catch (e) {}
  }

  function showDeathFullscreenAd() {
    setGameplayActive(false);
    if (!ysdk || !ysdk.adv || typeof ysdk.adv.showFullscreenAdv !== "function" || adShowing) return;
    try {
      ysdk.adv.showFullscreenAdv({
        callbacks: {
          onOpen: () => {
            adShowing = true;
            keys.left = false;
            keys.right = false;
            touchLeft = false;
            touchRight = false;
            audio.setTabHidden(true);
          },
          onClose: () => {
            adShowing = false;
            audio.setTabHidden(document.hidden || portraitLocked || pausedByPlatform);
          },
          onError: () => {
            adShowing = false;
            audio.setTabHidden(document.hidden || portraitLocked || pausedByPlatform);
          }
        }
      });
    } catch (e) {
      adShowing = false;
      audio.setTabHidden(document.hidden || portraitLocked || pausedByPlatform);
    }
  }

  if (typeof window.YaGames !== "undefined") {
    window.YaGames.init()
      .then((sdk) => {
        ysdk = sdk;
        if (ysdk.features && ysdk.features.LoadingAPI) {
          ysdk.features.LoadingAPI.ready();
        }
        if (typeof ysdk.on === "function") {
          ysdk.on("game_api_pause", () => {
            pausedByPlatform = true;
            keys.left = false;
            keys.right = false;
            touchLeft = false;
            touchRight = false;
            audio.setTabHidden(true);
          });
          ysdk.on("game_api_resume", () => {
            pausedByPlatform = false;
            if (!adShowing) {
              audio.setTabHidden(document.hidden || portraitLocked);
            }
          });
        }
        if (state && (state.mode === "intro" || state.mode === "run")) {
          setGameplayActive(true);
        }
      })
      .catch(() => {});
  }

  document.addEventListener("contextmenu", (e) => e.preventDefault());
  document.addEventListener("selectstart", (e) => e.preventDefault());

  const rootEl = document.getElementById("game-root");
  const glCanvas = document.getElementById("game-canvas");
  const blinkCanvas = document.getElementById("blink-canvas");
  const blinkCtx = blinkCanvas.getContext("2d");
  const hintEl = document.getElementById("controls-hint");
  const crashOverlay = document.getElementById("crash-overlay");
  const crashOsdCanvas = document.getElementById("crash-osd-canvas");
  const restartBtn = document.getElementById("restart-btn");

  const hasCoarsePointer = Boolean(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
  const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent || "");
  let isTouchDevice = hasCoarsePointer || isMobileUA || (("ontouchstart" in window) && navigator.maxTouchPoints > 0 && window.innerWidth <= 1024);

  // === RENDERER ===
  const renderer = new THREE.WebGLRenderer({
    canvas: glCanvas,
    antialias: false,
    powerPreference: "high-performance",
    stencil: false
  });
  renderer.setClearColor(0x010202, 1);
  renderer.outputEncoding = THREE.sRGBEncoding;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020406);
  // Smooth atmospheric distance mist (`небольшой туман`) that 100% dissolves distant objects by 45m BEFORE tile spawn!
  scene.fog = new THREE.Fog(0x08130c, 7.5, 45.0);

  const camera = new THREE.PerspectiveCamera(68, 16 / 9, 0.10, 96.0);
  camera.rotation.order = "YXZ";

  // === SEAMLESS NIGHT SKY DOME (Faint zenith stars fading smoothly into exact scene.fog.color at horizon -> ZERO pop-in!) ===
  const skyCanvas = document.createElement("canvas");
  skyCanvas.width = 1024;
  skyCanvas.height = 512;
  const sCtx = skyCanvas.getContext("2d");
  sCtx.clearRect(0, 0, 1024, 512);
  const skyGrad = sCtx.createLinearGradient(0, 0, 0, 512);
  skyGrad.addColorStop(0.00, "rgba(1, 2, 5, 0.92)");
  skyGrad.addColorStop(0.24, "rgba(2, 4, 8, 0.65)");
  skyGrad.addColorStop(0.41, "rgba(2, 4, 8, 0.0)"); // Transparent at horizon so horizon === scene.fog.color 100%!
  skyGrad.addColorStop(1.00, "rgba(0, 0, 0, 0.0)");
  sCtx.fillStyle = skyGrad;
  sCtx.fillRect(0, 0, 1024, 512);
  for (let i = 0; i < 65; i++) {
    const sx = Math.floor(Math.random() * 1024);
    const sy = Math.floor(8 + Math.random() * 92);
    const a = 0.08 + Math.random() * 0.16;
    sCtx.fillStyle = `rgba(180, 200, 225, ${a})`;
    sCtx.fillRect(sx, sy, 1, 1);
  }

  const skyTex = new THREE.CanvasTexture(skyCanvas);
  skyTex.minFilter = THREE.LinearFilter;
  skyTex.magFilter = THREE.LinearFilter;
  const skyDome = new THREE.Mesh(
    new THREE.SphereGeometry(78, 20, 14),
    new THREE.MeshBasicMaterial({
      map: skyTex,
      side: THREE.BackSide,
      transparent: true,
      fog: false,
      depthWrite: false
    })
  );
  scene.add(skyDome);

  // === CONSTANT LIGHT RIG (Dual-SpotLight Real Optical Flashlight + NightShot Rig — Zero shader recompilation!) ===
  const camLightTarget = new THREE.Object3D();
  scene.add(camLightTarget);

  const camSpot = new THREE.SpotLight(0xc4ffd4, 3.15, 54.0, 0.70, 0.65, 1.30);
  camSpot.target = camLightTarget;
  scene.add(camSpot);

  // Secondary wide outer corona spill for realistic dual-zone flashlight projection (0 intensity during NightShot)
  const flashOuterSpot = new THREE.SpotLight(0xffdfb8, 0.0, 26.0, 0.72, 0.72, 1.50);
  flashOuterSpot.target = camLightTarget;
  scene.add(flashOuterSpot);

  const camSpill = new THREE.PointLight(0x68ae7c, 0.78, 14.5, 1.72);
  scene.add(camSpill);

  const hemiLight = new THREE.HemisphereLight(0x21392a, 0x060b07, 0.32);
  scene.add(hemiLight);

  const moonLight = new THREE.DirectionalLight(0x426650, 0.24);
  moonLight.position.set(-18, 34, -25);
  scene.add(moonLight);
  scene.add(moonLight.target);

  // === SUBSYSTEMS ===
  const osd = new window.HorrorVhsOsd.VcrOsdRenderer();
  const audio = new window.HorrorAudio.AudioEngine();
  const textures = window.HorrorTextures.buildAll();
  const world = new window.HorrorWorld.WorldManager(scene, textures, { mobile: isTouchDevice });

  // === CUTSCENE PROPS (Realistic 3D Handheld Flashlight + Classic Black Monster!) ===
  const flashlightProp = world.createFlashlightProp();
  scene.add(flashlightProp);

  const introMonster = world.createBlackMonster();
  introMonster.group.visible = false;
  scene.add(introMonster.group);

  const deathMonster = world.createBlackMonster();
  deathMonster.group.visible = false;
  scene.add(deathMonster.group);

  const camcorderProp = world.createCamcorderProp();
  camcorderProp.visible = false;
  scene.add(camcorderProp);

  // Lone Burning Mi-8 Helicopter blazing in the wide open field at 5,000m (visible from afar!)
  const endingHeli = world.createCrashedHelicopter(true);
  endingHeli.visible = false;
  scene.add(endingHeli);

  // 5,000m Finale Wide-Map Silhouettes of 42 Main Monsters (`по всей видимой карте, включая левый и правый фланги`) + Apartment Bedroom!
  const finaleHordeGroup = new THREE.Group();
  finaleHordeGroup.visible = false;
  scene.add(finaleHordeGroup);
  const finaleMonsters = [];
  for (let i = 0; i < 42; i++) {
    const fm = world.createFinaleBlackMonster();
    finaleHordeGroup.add(fm.group);
    finaleMonsters.push({
      model: fm,
      wx: 0, wy: 0, wz: 0,
      chargeWx: 0, chargeWz: 0,
      sprintSpeed: 14.8 + (i % 6) * 0.62,
      phase: i * 1.37,
      headTilt: (i % 2 === 0 ? -1 : 1) * (0.18 + (i % 3) * 0.06)
    });
  }
  const apartmentBedroom = world.createApartmentBedroom();

  // Pre-render our ACTUAL 3D Main Monster's grinning face into a 512x512 alpha texture for the subliminal glitch overlay!
  const monsterFaceRT = new THREE.WebGLRenderTarget(512, 512, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    depthBuffer: true,
    stencilBuffer: false
  });
  (function bakeMainMonsterFaceTexture() {
    const faceScene = new THREE.Scene();
    const faceMonster = world.createBlackMonster();
    faceMonster.head.rotation.set(0.06, 0.0, -0.06);
    faceScene.add(faceMonster.group);

    const keyL = new THREE.PointLight(0xd8e6f5, 2.8, 3.5);
    keyL.position.set(0.05, 2.08, 1.15);
    const rimL1 = new THREE.PointLight(0x8fb0d4, 3.2, 3.5);
    rimL1.position.set(-0.58, 2.12, -0.15);
    const rimL2 = new THREE.PointLight(0x8fb0d4, 3.2, 3.5);
    rimL2.position.set( 0.62, 2.12, -0.15);
    faceScene.add(keyL, rimL1, rimL2, new THREE.AmbientLight(0x28323e, 0.85));

    const faceCam = new THREE.PerspectiveCamera(34, 1.0, 0.05, 6.0);
    faceCam.position.set(0.05, 1.885, 0.84);
    faceCam.lookAt(0.035, 1.868, 0.13);

    const prevClearCol = renderer.getClearColor(new THREE.Color());
    const prevClearAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(monsterFaceRT);
    renderer.setClearColor(0x000000, 0.0);
    renderer.clear(true, true, false);
    renderer.render(faceScene, faceCam);
    renderer.setRenderTarget(null);
    renderer.setClearColor(prevClearCol, prevClearAlpha);
  })();

  // === LOW-RES VHS RENDER TARGET & COMPOSITE SHADER ===
  let vhsRT = new THREE.WebGLRenderTarget(640, 360, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    depthBuffer: true,
    stencilBuffer: false
  });

  const postScene = new THREE.Scene();
  const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const vhsUniforms = {
    tDiffuse: { value: vhsRT.texture },
    tOsd: { value: osd.texture },
    tMonsterFace: { value: monsterFaceRT.texture },
    uTime: { value: 0 },
    uAspect: { value: 16 / 9 },
    uBattery: { value: 1.0 },
    uTrauma: { value: 0 },
    uAfBlur: { value: 0 },
    uHandSpeed: { value: 0 },
    uHorrorGlitch: { value: 0 },
    uCamcorderOn: { value: 0.0 },
    uNightVision: { value: 1.0 },
    uFaceGlitchAmt: { value: 0.0 },
    uFaceGlitchSeed: { value: 0.0 }
  };

  const postMat = new THREE.ShaderMaterial({
    uniforms: vhsUniforms,
    vertexShader: window.HorrorShaders.PostVertexShader,
    fragmentShader: window.HorrorShaders.PostFragmentShader,
    depthWrite: false,
    depthTest: false
  });
  postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat));

  let lastRtCamOn = null;
  let rtCamModeFlag = false;
  function syncRenderTargetSize(isCamOn = rtCamModeFlag) {
    rtCamModeFlag = Boolean(isCamOn);
    const w = Math.max(320, rootEl.clientWidth || window.innerWidth);
    const h = Math.max(200, rootEl.clientHeight || window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, isTouchDevice ? 1.0 : 1.5);
    const aspect = w / h;
    if (rtCamModeFlag) {
      const rtH = isTouchDevice ? 300 : 380;
      const rtW = Math.max(300, Math.round(rtH * aspect));
      vhsRT.setSize(rtW, rtH);
    } else {
      const maxH = isTouchDevice ? 540 : 720;
      const minH = isTouchDevice ? 360 : 480;
      const rtH = Math.min(maxH, Math.max(minH, Math.round(h * dpr)));
      const rtW = Math.min(isTouchDevice ? 960 : 1280, Math.max(540, Math.round(rtH * aspect)));
      vhsRT.setSize(rtW, rtH);
    }
    lastRtCamOn = rtCamModeFlag;
  }

  let portraitLocked = false;
  let touchLeft = false;
  let touchRight = false;

  function applyTouchDeviceUI() {
    if (!isTouchDevice) return;
    document.body.classList.add("is-touch");
    if (hintEl) {
      hintEl.innerHTML = "НАЖИМАЙТЕ НА ЛЕВУЮ ИЛИ ПРАВУЮ СТОРОНУ ЭКРАНА — УКЛОНЯТЬСЯ &nbsp;|&nbsp; ПОДБИРАЙТЕ ЯЩИКИ ДЛЯ БАТАРЕЕК";
    }
  }
  applyTouchDeviceUI();

  function updateOrientationLock() {
    const nextLocked = isTouchDevice && (window.innerHeight > window.innerWidth);
    if (nextLocked !== portraitLocked) {
      portraitLocked = nextLocked;
      document.body.classList.toggle("portrait-locked", portraitLocked);
      if (portraitLocked) {
        keys.left = false;
        keys.right = false;
        touchLeft = false;
        touchRight = false;
        audio.setTabHidden(true);
      } else {
        audio.setTabHidden(document.hidden);
      }
    }
  }

  function requestMobileFullscreen() {
    if (!isTouchDevice) return;
    try {
      const el = document.documentElement;
      const isFs = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
      if (!isFs && el) {
        const req = el.requestFullscreen || el.webkitRequestFullscreen;
        if (typeof req === "function") {
          const p = req.call(el, { navigationUI: "hide" });
          if (p && typeof p.catch === "function") p.catch(() => {});
        }
      }
      if (window.screen && window.screen.orientation && typeof window.screen.orientation.lock === "function") {
        window.screen.orientation.lock("landscape").catch(() => {});
      }
    } catch (e) {}
  }

  // === RESIZE HANDLER ===
  function onResize() {
    updateOrientationLock();
    const w = Math.max(320, rootEl.clientWidth || window.innerWidth);
    const h = Math.max(200, rootEl.clientHeight || window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, isTouchDevice ? 1.0 : 2);

    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);

    blinkCanvas.width = w;
    blinkCanvas.height = h;

    const aspect = w / h;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    vhsUniforms.uAspect.value = aspect;

    syncRenderTargetSize();
  }
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", () => {
    setTimeout(onResize, 80);
  });

  // === INPUT ===
  const keys = { left: false, right: false };
  onResize();

  function unlockAudioOnce() {
    audio.unlock();
  }

  let sevenStreakCount = 0;
  let lastSevenTime = 0;

  const BEST_DIST_KEY = "into_the_dark_best_m";
  function loadBestDistance() {
    try {
      const raw = window.localStorage ? window.localStorage.getItem(BEST_DIST_KEY) : null;
      const num = raw ? parseFloat(raw) : 0;
      return Number.isFinite(num) && num > 0 ? num : 0;
    } catch (e) {
      return 0;
    }
  }
  function saveBestDistance(meters) {
    try {
      if (window.localStorage) {
        window.localStorage.setItem(BEST_DIST_KEY, String(Math.floor(meters)));
      }
    } catch (e) {}
  }
  function formatDistanceRu(meters) {
    const m = Math.max(0, Math.floor(meters));
    const kmStr = (m / 1000).toFixed(2);
    return `${m} М (${kmStr} KM)`;
  }
  function updateCrashStatsUI(runDist, bestDist, isNewRecord) {
    const distLine = `ПРОЙДЕНО: ${formatDistanceRu(runDist)}`;
    const bestLine = isNewRecord
      ? `НОВЫЙ РЕКОРД: ${formatDistanceRu(bestDist)}`
      : `РЕКОРД: ${formatDistanceRu(bestDist)}`;
    const tipLine = "ПОДБИРАЙТЕ ЯЩИКИ С СИГНАЛЬНОЙ ШАШКОЙ, ЧТОБЫ ПОЛУЧАТЬ БАТАРЕЙКИ";
    const promptLine = "[ НАЖМИТЕ ПРОБЕЛ ИЛИ КОСНИТЕСЬ ЭКРАНА ]";

    if (crashOsdCanvas) {
      crashOsdCanvas.dataset.distText = distLine;
      crashOsdCanvas.dataset.bestText = bestLine;
      crashOsdCanvas.dataset.isNewRecord = isNewRecord ? "1" : "0";
      if (window.HorrorVhsOsd && typeof window.HorrorVhsOsd.renderOsdLines === "function") {
        window.HorrorVhsOsd.renderOsdLines(crashOsdCanvas, [
          { text: distLine, y: 10, scaleX: 2, scaleY: 3, color: "#ecece0" },
          { text: bestLine, y: 40, scaleX: 2, scaleY: 2, color: isNewRecord ? "#ece6a8" : "#cfcfc2" },
          { text: tipLine, y: 74, scaleX: 1, scaleY: 2, color: "#a4b0a2" },
          { text: promptLine, y: 98, scaleX: 1, scaleY: 2, color: "#889488" }
        ]);
      }
    }
  }

  function warpTo2950() {
    if (crashOverlay) crashOverlay.classList.remove("visible", "ending-complete");
    state.mode = "run";
    state.endedByGoal = false;
    state.usedDebugWarp = true;
    state.debugNoMonsters = true;
    state.endingHeliPlaced = false;
    state.endingInBedroom = false;
    state.endingTime = 0;
    state.monsterStumbleTimer = 0;
    endingHeli.visible = false;
    finaleHordeGroup.visible = false;
    apartmentBedroom.group.visible = false;
    introMonster.group.visible = false;
    deathMonster.group.visible = false;
    flashlightProp.visible = false;
    camcorderProp.visible = false;
    if (camcorderProp.userData && camcorderProp.userData.lcdMat) {
      camcorderProp.userData.lcdMat.color.setHex(0x12261a);
    }
    if (state.battery <= 0.01) {
      state.battery = 0.65;
      state.camcorderThrown = false;
    }
    if (!state.camcorderThrown && state.battery > 0.001) {
      state.camcorderOn = true;
      state.nightVisionOn = true;
    } else {
      state.camcorderOn = false;
      state.nightVisionOn = false;
    }
    state.blink = 0;
    state.screenFade = 0.0;
    state.trauma = 0;
    state.horrorGlitch = 0;
    state.faceGlitchDur = 0;
    state.distance = 2950;
    state.z = -2950;
    state.x = world.roadCenterX(-2950);
    state.y = world.terrainHeight(state.x, state.z) + EYE_HEIGHT;
    state.vx = 0;
    state.speed = MAX_SPEED;
    world.update(state.x, state.z, 0.016, state.battery, null, true, true);
    placeFinaleHelicopterAhead();
  }

  window.addEventListener("keydown", (e) => {
    unlockAudioOnce();

    // Quick test shortcut: pressing "777" three times in a row warps straight to 2,950m (50m before 3 km goal)!
    if (!e.repeat) {
      const isSeven = (e.code === "Digit7" || e.code === "Numpad7" || e.key === "7");
      if (isSeven) {
        const now = performance.now();
        if (now - lastSevenTime > 2500) sevenStreakCount = 0;
        sevenStreakCount++;
        lastSevenTime = now;
        if (sevenStreakCount >= 3) {
          sevenStreakCount = 0;
          warpTo2950();
          e.preventDefault();
          return;
        }
      } else {
        sevenStreakCount = 0;
      }
    }

    if (state.mode === "gameover" && !state.endedByGoal && !e.repeat) {
      if (adShowing || pausedByPlatform) {
        e.preventDefault();
        return;
      }
      if (e.code === "Space" || e.code === "Enter" || e.code === "KeyR" || e.code === "KeyA" || e.code === "KeyD" || e.code === "ArrowLeft" || e.code === "ArrowRight") {
        startIntroCutscene();
        e.preventDefault();
        return;
      }
    }
    if (e.code === "KeyA" || e.code === "ArrowLeft") {
      keys.left = true;
      e.preventDefault();
    } else if (e.code === "KeyD" || e.code === "ArrowRight") {
      keys.right = true;
      e.preventDefault();
    }
  });

  window.addEventListener("keyup", (e) => {
    if (e.code === "KeyA" || e.code === "ArrowLeft") keys.left = false;
    else if (e.code === "KeyD" || e.code === "ArrowRight") keys.right = false;
  });

  window.addEventListener("blur", () => {
    keys.left = false;
    keys.right = false;
    touchLeft = false;
    touchRight = false;
  });

  document.addEventListener("visibilitychange", () => {
    audio.setTabHidden(document.hidden || portraitLocked || adShowing || pausedByPlatform);
  });

  function syncTouchesFromEvent(e) {
    if (portraitLocked) {
      touchLeft = false;
      touchRight = false;
      return;
    }
    const w = Math.max(1, window.innerWidth);
    let left = false;
    let right = false;
    const list = e.touches || [];
    for (let i = 0; i < list.length; i++) {
      const tx = list[i].clientX;
      if (tx < w * 0.5) left = true;
      else right = true;
    }
    touchLeft = left;
    touchRight = right;
  }

  rootEl.addEventListener("touchstart", (e) => {
    if (!isTouchDevice) {
      isTouchDevice = true;
      applyTouchDeviceUI();
      onResize();
    }
    unlockAudioOnce();
    if (e.target && restartBtn && (e.target === restartBtn || restartBtn.contains(e.target))) {
      return;
    }
    requestMobileFullscreen();
    if (portraitLocked) {
      e.preventDefault();
      return;
    }
    if (state.mode === "gameover" && !state.endedByGoal) {
      if (adShowing || pausedByPlatform) {
        e.preventDefault();
        return;
      }
      touchLeft = false;
      touchRight = false;
      startIntroCutscene();
      e.preventDefault();
      return;
    }
    syncTouchesFromEvent(e);
    e.preventDefault();
  }, { passive: false });

  rootEl.addEventListener("touchmove", (e) => {
    if (e.target && restartBtn && (e.target === restartBtn || restartBtn.contains(e.target))) {
      return;
    }
    syncTouchesFromEvent(e);
    e.preventDefault();
  }, { passive: false });

  rootEl.addEventListener("touchend", (e) => {
    if (e.target && restartBtn && (e.target === restartBtn || restartBtn.contains(e.target))) {
      return;
    }
    syncTouchesFromEvent(e);
    e.preventDefault();
  }, { passive: false });

  rootEl.addEventListener("touchcancel", (e) => {
    syncTouchesFromEvent(e);
  }, { passive: false });

  if (restartBtn) {
    restartBtn.addEventListener("click", (e) => {
      unlockAudioOnce();
      requestMobileFullscreen();
      e.stopPropagation();
      if (adShowing || pausedByPlatform) return;
      if (state.mode === "gameover" || state.mode === "end_menu") {
        startIntroCutscene();
      }
    });
  }

  // Mouse clicks on desktop ONLY unlock audio / restart on gameover — NEVER hijack keyboard steering!
  window.addEventListener("pointerdown", (e) => {
    unlockAudioOnce();
    if (adShowing || pausedByPlatform) return;
    if (e.pointerType !== "touch" && state.mode === "gameover" && !state.endedByGoal && !portraitLocked) {
      startIntroCutscene();
    }
  }, { passive: true });

  // === GAME, CUTSCENE & SPRINTING CAMERA STATE ===
  const EYE_HEIGHT = 1.66;
  const BASE_SPEED = 8.0;
  const MAX_SPEED = 11.4;
  const STRAFE_MAX = 7.4;
  const GOAL_DISTANCE = 3000;

  const state = {
    mode: "intro", // "intro" | "run" | "ending" | "death" | "gameover"
    x: 0,
    y: EYE_HEIGHT,
    z: 0,
    vx: 0,
    distance: 0,
    bestDistance: loadBestDistance(),
    usedDebugWarp: false,
    runClock: 0,
    speed: BASE_SPEED,
    stepPhase: 0,
    stepFoot: 1,
    battery: 1.0,
    trauma: 0,
    horrorGlitch: 0,
    afBlur: 0,
    afTimer: 8.5,
    blink: 0.0,
    screenFade: 0.0,
    camcorderOn: false,
    nightVisionOn: true,
    nvToggleTimer: 1.4,
    camcorderThrown: false,
    camThrowPos: new THREE.Vector3(),
    camThrowVel: new THREE.Vector3(),
    camThrowActiveTime: 0,
    faceGlitchTimer: 8.5,
    faceGlitchDur: 0,
    faceGlitchPeak: 0,
    faceGlitchSeed: 0,
    endingHeliPlaced: false,
    endingHeliX: 0,
    endingHeliY: 0,
    endingHeliZ: -3014,
    endingTime: 0,
    endingHadCamcorder: true,
    endingCamPutAwayPlayed: false,
    endingStep1Played: false,
    endingStep2Played: false,
    endingStep3Played: false,
    endingBreathPlayed: false,
    lightningTimer: 18.0,
    lightningFlash: 0,
    hintHidden: false,

    // Intro Cutscene (~1.92s)
    introTime: 0,
    introSnapPlayed: false,
    introThrowPlayed: false,
    flashThrown: false,
    flashPos: new THREE.Vector3(),
    flashVel: new THREE.Vector3(),

    // Blink-Based Death Cutscene (`просто лежим в темноте и моргаем -> после какого-то моргания появляется монстр -> закрытие глаз = конец игры!`)
    deathTime: 0,
    deathBlinks: [],        // Array of scheduled slow blinks: { startOpen, startClose, startShut, startReopen, endReopen, isMonsterBlink }
    deathMonsterSpawnT: 0,  // Exact closed-eye timestamp when monster silently appears
    deathFinalCloseStartT: 0,
    deathFinalCloseEndT: 0,
    deathMonsterShown: false,
    gameOverTime: 0,

    // Energetic Sprinting Handheld Camcorder Physics
    armPosX: 0,
    armPosY: 0,
    armVelX: 0,
    armVelY: 0,
    wristYaw: 0,
    wristPitch: -0.026,
    wristRoll: 0,
    wristRollVel: 0
  };

  function startIntroCutscene() {
    if (crashOverlay) crashOverlay.classList.remove("visible", "ending-complete");
    setGameplayActive(true);

    state.mode = "intro";
    state.x = 0;
    state.z = 3.5;
    state.y = world.terrainHeight(0, 3.5) + EYE_HEIGHT;
    state.vx = 0;
    state.distance = 0;
    state.usedDebugWarp = false;
    state.runClock = 0;
    state.speed = 2.5;
    state.stepPhase = 0;
    state.battery = 1.0;
    state.trauma = 0;
    state.horrorGlitch = 0;
    state.afBlur = 0;
    state.blink = 0.85;
    state.screenFade = 0.0;
    state.camcorderOn = false;
    state.nightVisionOn = true;
    state.nvToggleTimer = 1.4;
    state.camcorderThrown = false;
    state.camThrowActiveTime = 0;
    state.faceGlitchTimer = 8.0 + Math.random() * 5.0;
    state.faceGlitchDur = 0;
    state.faceGlitchPeak = 0;
    state.monsterStumbleTimer = 0;
    state.debugNoMonsters = false;
    state.hintHidden = false;
    state.endingHeliPlaced = false;
    state.endingTime = 0;
    state.endedByGoal = false;
    state.gameOverTime = 0;

    state.introTime = 0;
    state.introSnapPlayed = false;
    state.introTwistPlayed = false;
    state.introThrowPlayed = false;
    state.flashThrown = false;

    state.armPosX = 0;
    state.armPosY = 0;
    state.armVelX = 0;
    state.armVelY = 0;
    state.wristYaw = 0;
    state.wristPitch = -0.026;
    state.wristRoll = 0;
    state.wristRollVel = 0;

    introMonster.group.visible = false;
    if (introMonster.head) introMonster.head.rotation.set(0.10, 0.0, 0.34);
    deathMonster.group.visible = false;
    if (deathMonster.head) deathMonster.head.rotation.set(0.12, 0.0, -0.22);
    flashlightProp.visible = true;
    camcorderProp.visible = false;
    if (camcorderProp.userData && camcorderProp.userData.lcdMat) {
      camcorderProp.userData.lcdMat.color.setHex(0x12261a);
    }
    endingHeli.visible = false;
    finaleHordeGroup.visible = false;
    apartmentBedroom.group.visible = false;
    state.endingInBedroom = false;
    audio.updateRunningLoop(false);

    if (hintEl) hintEl.style.opacity = "0";

    world.reset();
    world.update(0, 3.5, 0.016, 1.0, null, true);
  }

  function startDeathCutscene(crashCol = null) {
    if (crashCol && crashCol.targetSafeX !== null && crashCol.targetSafeX !== undefined) {
      state.x = crashCol.targetSafeX;
    }
    if (crashCol && crashCol.targetSafeZ !== null && crashCol.targetSafeZ !== undefined) {
      state.z = crashCol.targetSafeZ;
    }
    state.mode = "death";
    state.endedByGoal = false;
    // Keep camcorder briefly on for 0.15s during impact ONLY if we hadn't already thrown it away at 0% battery!
    state.camcorderOn = !state.camcorderThrown;
    state.faceGlitchDur = 0;
    state.faceGlitchPeak = 0;
    state.trauma = 1.0;
    state.horrorGlitch = 1.0;
    state.deathTime = 0;
    state.deathMonsterShown = false;
    state.deathStep1Played = false;
    state.deathStep2Played = false;
    state.gameOverTime = 0;
    state.vx = 0;
    state.speed = 0;

    // Record exact pre-crash position & orientation (ZERO frame-0 teleport!)
    state.crashStartX = state.x;
    state.crashStartZ = state.z;
    state.crashStartY = camera.position.y;
    state.crashStartPitch = camera.rotation.x;
    state.crashStartYaw = camera.rotation.y;
    state.crashStartRoll = camera.rotation.z;

    flashlightProp.visible = false;
    camcorderProp.visible = false;
    introMonster.group.visible = false;
    deathMonster.group.visible = false;
    audio.updateRunningLoop(false);
    if (hintEl) hintEl.style.opacity = "0";

    // Pick whichever side (+1 right or -1 left) beside our fallen body has the clearest view free of trunks & vehicles!
    const minClearanceForSide = (side) => {
      const testX = state.crashStartX + side * 1.55;
      const testZ = state.crashStartZ + 0.35;
      let minD = 999;
      for (const tile of world.tiles.values()) {
        for (const ob of tile.obstacles) {
          if (ob.active === false) continue;
          let d;
          if (ob.type === "box") {
            const cy = Math.cos(ob.yaw || 0), sy = Math.sin(ob.yaw || 0);
            const rx = testX - ob.x, rz = testZ - ob.z;
            const lx = Math.abs(rx * cy - rz * sy) - (ob.hx || 1.0);
            const lz = Math.abs(rx * sy + rz * cy) - (ob.hz || 1.0);
            d = Math.hypot(Math.max(0, lx), Math.max(0, lz));
          } else {
            d = Math.hypot(testX - ob.x, testZ - ob.z) - (ob.crashR || 0.3);
          }
          if (d < minD) minD = d;
        }
      }
      return minD;
    };
    const clearR = minClearanceForSide(1);
    const clearL = minClearanceForSide(-1);
    if (crashCol && crashCol.hitOb && crashCol.hitOb.type === "box" && Math.abs(state.crashStartX - crashCol.hitOb.x) > 0.35) {
      state.deathSide = state.crashStartX >= crashCol.hitOb.x ? 1 : -1;
    } else if (Math.abs(clearR - clearL) < 0.35) {
      state.deathSide = Math.random() < 0.5 ? 1 : -1;
    } else {
      state.deathSide = clearR >= clearL ? 1 : -1;
    }

    // Physical resting position after rebounding off the obstacle and collapsing onto our side
    state.fallEndX = state.crashStartX + state.deathSide * 0.42;
    state.fallEndZ = state.crashStartZ + 1.12;
    if (crashCol && crashCol.hitOb && crashCol.hitOb.type === "box") {
      // Ensure rebound end position stays safely outside the vehicle/box hull
      const ob = crashCol.hitOb;
      const cy = Math.cos(ob.yaw || 0), sy = Math.sin(ob.yaw || 0);
      const rx = state.fallEndX - ob.x, rz = state.fallEndZ - ob.z;
      const lx = rx * cy - rz * sy, lz = rx * sy + rz * cy;
      if (Math.abs(lx) < ob.hx + 0.32 && Math.abs(lz) < ob.hz + 0.32) {
        const pushLx = (lx >= 0 ? 1 : -1) * (ob.hx + 0.42);
        state.fallEndX = ob.x + pushLx * cy + lz * sy;
        state.fallEndZ = ob.z - pushLx * sy + lz * cy;
      }
    }
    const endGroundY = world.terrainHeight(state.fallEndX, state.fallEndZ);

    // Standing tall & motionless beside us (`сбоку от нас`) staring down
    state.deathMonsterX = state.fallEndX + state.deathSide * 1.95;
    state.deathMonsterZ = state.fallEndZ - 0.82;
    state.deathMonsterY = world.terrainHeight(state.deathMonsterX, state.deathMonsterZ);
    const dxM = state.deathMonsterX - state.fallEndX;
    const dzM = state.deathMonsterZ - state.fallEndZ;
    const dyM = (state.deathMonsterY + 1.62) - (endGroundY + 0.22);
    state.deathTargetYaw = Math.atan2(-dxM, -dzM);
    state.deathTargetPitch = Math.atan2(dyM, Math.hypot(dxM, dzM));

    // Build 2 or 3 slow heavy dying blinks after hitting the ground before the monster appears beside us!
    const numBlinksBeforeMonster = 2 + Math.floor(Math.random() * 2); // 2 or 3 blinks
    state.deathBlinks = [];
    let cursor = 0.86; // After 0.72s physical crash, gravity collapse & head hitting dirt
    for (let i = 0; i < numBlinksBeforeMonster; i++) {
      const openHold = 0.85 + Math.random() * 0.40;
      const closeDur = 0.36;
      const shutHold = 0.22;
      const reopenDur = 0.48;
      const isMonsterBlink = (i === numBlinksBeforeMonster - 1);

      const startOpen = cursor;
      const startClose = startOpen + openHold;
      const startShut = startClose + closeDur;
      const startReopen = startShut + shutHold;
      const endReopen = startReopen + reopenDur;

      state.deathBlinks.push({ startOpen, startClose, startShut, startReopen, endReopen, isMonsterBlink });
      if (isMonsterBlink) {
        // Monster appears silently BESIDE us while eyes are 100% CLOSED (`startShut + 0.08`)
        state.deathMonsterSpawnT = startShut + 0.08;
        state.deathStep1T = Math.max(0.95, state.deathMonsterSpawnT - 1.50);
        state.deathStep2T = Math.max(1.35, state.deathMonsterSpawnT - 0.62);
        // Eyes open slowly (`0.48s`) + stay wide open for `1.65s` staring at the motionless grinning monster beside us,
        // then slowly close (`0.68s`) -> END OF GAME!
        state.deathFinalCloseStartT = endReopen + 1.65;
        state.deathFinalCloseEndT = state.deathFinalCloseStartT + 0.68;
      }
      cursor = endReopen;
    }

    audio.playCrash();
    if (ysdk && ysdk.features && ysdk.features.GameplayAPI) {
      ysdk.features.GameplayAPI.stop();
    }
  }

  // Ensures a silent, open clearing around the lone crashed Mi-8 helicopter at 5,000m regardless of where the player ran!
  function ensureFinaleClearing(hx, hz) {
    for (const tile of world.tiles.values()) {
      for (const e of tile.enemies) {
        if ((e.wx - hx) ** 2 + (e.wz - hz) ** 2 < 28.0 * 28.0) {
          e.group.visible = false;
          if (e.ob) e.ob.active = false;
        }
      }
      for (let i = tile.obstacles.length - 1; i >= 0; i--) {
        const ob = tile.obstacles[i];
        if ((ob.x - hx) ** 2 + (ob.z - hz) ** 2 < 26.0 * 26.0) {
          tile.obstacles.splice(i, 1);
        }
      }
      // Hide any roadside power poles, trees or wrecks standing inside the 22m finale clearing so the Mi-8 & horde frame cleanly!
      for (const child of tile.group.children) {
        if (child === tile.terrainMesh || child === tile.foliageMesh) continue;
        if (child.position.x === 0 && child.position.y === 0 && child.position.z === 0) continue; // Keep road ribbon mesh
        const cwx = tile.centerX + child.position.x;
        const cwz = tile.centerZ + child.position.z;
        if ((cwx - hx) ** 2 + (cwz - hz) ** 2 < 22.0 * 22.0) {
          child.visible = false;
        }
      }
    }
  }

  function placeFinaleHelicopterAhead() {
    if (state.endingHeliPlaced) return;
    state.endingHeliPlaced = true;
    const remDist = Math.max(29.0, GOAL_DISTANCE - state.distance + 29.0);
    state.endingHeliX = state.x + 1.85;
    state.endingHeliZ = state.z - remDist;
    state.endingHeliY = world.terrainSurfaceHeight(state.endingHeliX, state.endingHeliZ) - 0.14;
    endingHeli.position.set(state.endingHeliX, state.endingHeliY, state.endingHeliZ);
    endingHeli.rotation.set(0.07, -0.62, -0.18);
    endingHeli.visible = true;
    world.updateHelicopterFire(endingHeli, totalTime);
    ensureFinaleClearing(state.endingHeliX, state.endingHeliZ);
  }

  // Spreads 42 Main Monsters WIDE ACROSS THE ENTIRE VISIBLE OPEN FIELD, HORIZON, AND LEFT/RIGHT FLANKS!
  function layoutFinaleMonstersAroundGaze() {
    const px = state.x;
    const pz = state.z;
    const dxH = state.endingHeliX - px;
    const dzH = state.endingHeliZ - pz;
    const lenH = Math.hypot(dxH, dzH) || 1.0;
    const fwdX = dxH / lenH;
    const fwdZ = dzH / lenH;
    const rightX = -fwdZ;
    const rightZ = fwdX;

    // [lateralMeters, forwardMeters] spanning front, left flank, right flank & full visible horizon!
    const relLayout = [
      // Fore-Mid Silhouettes (`13.2m .. 16.4m` away — crisp faces, sunken eyes & jagged grins clearly readable in HD!)
      [-14.2, 13.4], [ -8.8, 13.2], [ -4.4, 14.8], [  4.8, 14.6], [  9.2, 13.4], [ 14.8, 13.8],
      // Left & Right Flanks (`lat: ±14..±28m`, `fwd: +2..+12m` — clearly visible when looking left & right!)
      [-15.5,  3.2], [-22.5,  6.2], [-18.5, 10.2], [-28.0, 11.8],
      [ 15.5,  3.5], [ 22.8,  6.5], [ 18.8, 10.4], [ 28.5, 12.0],
      // Wide Mid-Field Silhouettes (`19.5m .. 29.8m` across far-left, left, center-beyond & far-right!)
      [-26.5, 20.8], [-20.4, 22.6], [-13.8, 21.2], [ -7.6, 23.8], [ -2.6, 27.4], [  3.2, 28.2],
      [  8.4, 23.0], [ 14.6, 21.8], [ 20.8, 23.4], [ 27.2, 21.0], [-18.2, 28.8], [ 18.8, 29.4],
      // Horizon-Spanning Distant Silhouettes (`32.5m .. 48.0m` all along the entire visible horizon!)
      [-42.0, 36.0], [-34.5, 33.5], [-28.2, 39.0], [-21.5, 35.2], [-15.4, 40.5], [ -9.2, 34.8],
      [ -3.8, 42.0], [  1.8, 37.5], [  7.4, 43.2], [ 13.2, 35.6], [ 19.5, 41.0], [ 26.4, 36.4],
      [ 33.8, 34.0], [ 41.5, 37.2], [-24.0, 47.5], [ 23.5, 48.5]
    ];

    for (let i = 0; i < finaleMonsters.length; i++) {
      const fm = finaleMonsters[i];
      const [lat, fwd] = relLayout[i];
      fm.wx = px + rightX * lat + fwdX * fwd;
      fm.wz = pz + rightZ * lat + fwdZ * fwd;
      fm.wy = world.terrainSurfaceHeight(fm.wx, fm.wz);

      // Charge start positions on Blink #2: front wave launches from `15.4m..17.8m` across the field
      // so at explosive ~16.5 m/s stop-motion burst speed they rocket straight at us before eyes slam shut at ~2.4m!
      let chargeFwd, chargeLat;
      if (i < 6) {
        chargeFwd = 15.4 + (i % 3) * 1.15;
        chargeLat = lat * 0.50;
      } else if (i < 14) {
        chargeFwd = 8.8 + (i % 4) * 2.2;
        chargeLat = lat * 0.62;
      } else {
        chargeFwd = 18.8 + Math.max(0, fwd - 14.0) * 0.50;
        chargeLat = lat * 0.62;
      }
      fm.chargeWx = px + rightX * chargeLat + fwdX * chargeFwd;
      fm.chargeWz = pz + rightZ * chargeLat + fwdZ * chargeFwd;

      fm.model.group.position.set(fm.wx, fm.wy, fm.wz);
      fm.model.group.rotation.y = Math.atan2(px - fm.wx, pz - fm.wz);
      fm.model.legL.rotation.set(0, 0, 0);
      fm.model.legR.rotation.set(0, 0, 0);
      fm.model.torso.position.set(0, 0.92, 0);
      fm.model.torso.rotation.set(0.06, 0, 0);
      fm.model.armL.rotation.set(0, 0, 0.04);
      fm.model.armR.rotation.set(0, 0, -0.04);
      fm.model.head.rotation.set(0.10, 0, fm.headTilt);
    }
  }

  function startEndingCutscene() {
    if (!state.endingHeliPlaced) {
      placeFinaleHelicopterAhead();
    } else {
      ensureFinaleClearing(state.endingHeliX, state.endingHeliZ);
    }
    state.mode = "ending";
    state.endedByGoal = true;
    state.distance = GOAL_DISTANCE;
    if (!state.usedDebugWarp && GOAL_DISTANCE > state.bestDistance) {
      state.bestDistance = GOAL_DISTANCE;
      saveBestDistance(GOAL_DISTANCE);
    }
    state.endingTime = 0;
    state.endingBaseZ = 0;
    state.endingStopSoundPlayed = false;
    state.endingHadCamcorder = !state.camcorderThrown && state.camcorderOn;
    state.endingCamLowerPlayed = false;
    state.endingCamPowerOffPlayed = false;
    state.endingHordeSpawned = false;
    state.endingHordeAppearSoundPlayed = false;
    state.endingHeart1Played = false;
    state.endingHeart2Played = false;
    state.endingHordeCharging = false;
    state.endingChargeSoundPlayed = false;
    state.endingEyeSlamStartT = 0;
    state.endingBedroomStartT = 0;
    state.endingInBedroom = false;
    state.endingWakeSoundPlayed = false;
    state.endingLieDownSoundPlayed = false;
    state.endingDoorKnockPlayed = false;
    state.endMenuTime = 0;
    state.endGlitchTimer = 6.5;
    state.faceGlitchDur = 0;
    state.faceGlitchPeak = 0;
    state.horrorGlitch = 0;

    finaleHordeGroup.visible = false;
    apartmentBedroom.group.visible = false;

    if (hintEl) hintEl.style.opacity = "0";
    if (ysdk && ysdk.features && ysdk.features.GameplayAPI) {
      ysdk.features.GameplayAPI.stop();
    }
  }

  startIntroCutscene();

  renderer.compile(scene, camera);

  let lastCloseFlinchAt = -10;
  let lastShadowGlitchAt = -20;

  function triggerHorrorEvent(kind, relX, relZ, enemyKind) {
    if (kind === "close_pass") {
      const pan = Math.max(-0.98, Math.min(0.98, relX / 2.2));
      audio.playMonsterClosePass(pan, enemyKind);
      // ZERO camera VHS glitch spam! Only a subtle physical wrist flinch on razor-close passes (`>= 4.5s` apart)
      if (totalTime - lastCloseFlinchAt > 4.5) {
        lastCloseFlinchAt = totalTime;
        state.trauma = Math.min(1.0, state.trauma + 0.10);
        state.wristRollVel += (relX > 0 ? -1 : 1) * 0.24;
      }
      return;
    }
    audio.playWorldHorrorEvent(kind, relX, relZ);
    if ((kind === "stalker_vanish" || kind === "shadow_vanish") && (totalTime - lastShadowGlitchAt > 14.0)) {
      lastShadowGlitchAt = totalTime;
      state.horrorGlitch = Math.max(state.horrorGlitch, 0.58);
      state.trauma = Math.min(1.0, state.trauma + 0.12);
      state.afBlur = Math.max(state.afBlur, 0.35);
      state.wristRollVel += (relX > 0 ? -1 : 1) * 0.20;
    }
    // Routine monster sightings (`infected_reveal`, `trance_snap`, `crows`, `chapel_bell`) NO LONGER glitch or blur the camera!
  }

  function smoothstep01(t) {
    const c = Math.max(0, Math.min(1, t));
    return c * c * (3 - 2 * c);
  }

  // === MAIN ANIMATION LOOP ===
  let prevTime = performance.now();
  let totalTime = 0;

  function tick(now) {
    requestAnimationFrame(tick);

    if (portraitLocked || adShowing || pausedByPlatform) {
      prevTime = now;
      return;
    }

    const dt = Math.min(0.05, Math.max(0.001, (now - prevTime) * 0.001));
    prevTime = now;
    totalTime += dt;

    skyDome.position.set(state.x, state.y, state.z);

    // =========================================================================
    // MODE 1: OPENING 1.9s FLASHLIGHT MINI-CUTSCENE
    // =========================================================================
    if (state.mode === "intro") {
      state.introTime += dt;
      const t = state.introTime;

      if (t < 0.22) {
        state.blink = Math.max(0, 0.85 * (1.0 - t / 0.22));
      } else if (t < 1.74) {
        state.blink = 0.0;
      }

      if (t >= 0.48 && !state.introSnapPlayed) {
        state.introSnapPlayed = true;
        audio.playIntroBehindSound();
        const mz = state.z + 2.85;
        const mx = state.x + 0.08;
        introMonster.group.visible = true;
        introMonster.group.position.set(mx, world.terrainHeight(mx, mz), mz);
        introMonster.group.rotation.set(0, Math.PI, 0);
        if (introMonster.head) introMonster.head.rotation.set(0.10, 0.0, 0.34);
      }

      if (introMonster.group.visible) {
        // Monster body stands 100% EERILY STILL (`не дрыгается`), while its grinning head unnaturally twists upside-down!
        const mz = introMonster.group.position.z;
        const baseMx = 0.08;
        introMonster.group.position.set(baseMx, world.terrainHeight(baseMx, mz), mz);
        introMonster.group.rotation.set(0, Math.PI, 0);

        if (t >= 0.80 && !state.introTwistPlayed) {
          state.introTwistPlayed = true;
          audio.playNeckTwistCreak();
        }
        if (introMonster.head) {
          const twistU = smoothstep01((t - 0.78) / 0.54);
          const headRoll = 0.34 - twistU * 2.56; // Twists ~147° almost completely upside-down!
          const headPitch = 0.10 + Math.sin(twistU * Math.PI) * 0.14;
          const headYaw = Math.sin(twistU * Math.PI) * 0.12;
          introMonster.head.rotation.set(headPitch, headYaw, headRoll);
        }
      }

      const moveSpeed = t < 0.55 ? 2.6 : t < 1.38 ? 0.25 : (3.5 + ((t - 1.38) / 0.68) * 5.0);
      state.z -= moveSpeed * dt;
      state.y = world.terrainHeight(state.x, state.z) + EYE_HEIGHT;

      const prevSin = Math.sin(state.stepPhase);
      state.stepPhase += dt * (t < 1.38 ? 5.2 : 12.8);
      const curSin = Math.sin(state.stepPhase);
      if ((prevSin < 0 && curSin >= 0) || (prevSin > 0 && curSin <= 0)) {
        if (t < 0.55) audio.playFootstep(false, false, true);
      }

      let yaw = 0;
      let pitch = -0.03 + Math.sin(state.stepPhase) * (t < 1.38 ? 0.012 : 0.035);
      let roll = 0;
      if (t >= 0.52 && t < 0.84) {
        const u = smoothstep01((t - 0.52) / 0.32);
        yaw = -Math.PI * u;
        roll = Math.sin(u * Math.PI) * 0.10;
        vhsUniforms.uAfBlur.value = Math.sin(u * Math.PI) * 0.55;
      } else if (t >= 0.84 && t < 1.38) {
        yaw = -Math.PI + (Math.random() - 0.5) * 0.012;
        pitch = 0.05 + (Math.random() - 0.5) * 0.010;
        vhsUniforms.uAfBlur.value = 0.0;
      } else if (t >= 1.38 && t < 1.74) {
        const u = smoothstep01((t - 1.38) / 0.36);
        yaw = -Math.PI * (1.0 - u);
        roll = -Math.sin(u * Math.PI) * 0.12;
        pitch = -0.05 - Math.sin(u * Math.PI) * 0.06;
        vhsUniforms.uAfBlur.value = Math.sin(u * Math.PI) * 0.55;
      } else {
        vhsUniforms.uAfBlur.value = 0.0;
      }

      const walkBobY = Math.abs(Math.cos(state.stepPhase * 0.5)) * (t < 1.38 ? -0.022 : -0.052);
      const walkBobX = Math.sin(state.stepPhase * 0.5) * (t < 1.38 ? 0.018 : 0.045);
      camera.position.set(state.x + walkBobX, state.y + walkBobY, state.z);
      camera.rotation.set(pitch, yaw, roll);

      if (t >= 1.50 && !state.flashThrown) {
        state.flashThrown = true;
        const handWorld = new THREE.Vector3(0.24, -0.22, -0.42).applyEuler(camera.rotation).add(camera.position);
        state.flashPos.copy(handWorld);
        const fwd = new THREE.Vector3(0.28, -0.15, -1.0).applyEuler(camera.rotation).normalize();
        state.flashVel.copy(fwd).multiplyScalar(7.5);
      }

      if (t >= 1.66 && t < 1.80) {
        state.blink = smoothstep01((t - 1.66) / 0.14);
      } else if (t >= 1.80) {
        if (!state.camcorderOn) {
          state.camcorderOn = true;
          introMonster.group.visible = false;
          flashlightProp.visible = false;
          state.horrorGlitch = 0.38;
          state.afBlur = 0.32;
          if (!state.introThrowPlayed) {
            state.introThrowPlayed = true;
            audio.playFlashlightDropAndCamSwitch();
          }
          if (hintEl && !state.hintHidden) hintEl.style.opacity = "1";
        }
        state.blink = Math.max(0, 1.0 - smoothstep01((t - 1.80) / 0.22));
      }

      if (!state.camcorderOn) {
        // Real Optical Dual-Zone Flashlight (Crisp Bright Center Hotspot + Soft Wide Corona Spill — ZERO fake cylinder!)
        camSpot.color.setHex(0xfff1d6);
        camSpot.intensity = 6.8;
        camSpot.distance = 40.0;
        camSpot.angle = 0.37;
        camSpot.penumbra = 0.44;

        flashOuterSpot.color.setHex(0xffddb4);
        flashOuterSpot.intensity = 1.95;
        flashOuterSpot.distance = 27.0;
        flashOuterSpot.angle = 0.78;
        flashOuterSpot.penumbra = 0.72;

        camSpill.color.setHex(0xffe4b8);
        camSpill.intensity = 0.28;
        camSpill.distance = 9.5;
        hemiLight.color.setHex(0x101722);
        hemiLight.intensity = 0.085;
        moonLight.intensity = 0.065;
        scene.fog.near = 5.5;
        scene.fog.far = 34.0;
        scene.fog.color.setRGB(0.008, 0.012, 0.018);

        if (!state.flashThrown) {
          const handSwayX = Math.sin(state.stepPhase * 0.5) * 0.012;
          const handSwayY = Math.abs(Math.cos(state.stepPhase * 0.5)) * -0.014;
          const rightHand = new THREE.Vector3(0.22 + handSwayX, -0.185 + handSwayY, -0.36).applyEuler(camera.rotation).add(camera.position);
          flashlightProp.position.copy(rightHand);

          // Aim flashlight barrel & bezel (-Z) directly at the natural center of view ahead!
          const aimWorldPt = new THREE.Vector3(0.0, -0.14, -14.0).applyEuler(camera.rotation).add(camera.position);
          const beamDir = aimWorldPt.clone().sub(rightHand).normalize();
          const zAxis = beamDir.clone().negate(); // Local -Z (lens) points along +beamDir
          const upHint = new THREE.Vector3(0, 1, 0).applyEuler(camera.rotation);
          const xAxis = new THREE.Vector3().crossVectors(upHint, zAxis).normalize();
          const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
          const basisMat = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
          flashlightProp.quaternion.setFromRotationMatrix(basisMat);

          const lensWorldPos = rightHand.clone().addScaledVector(beamDir, 0.20);
          camSpot.position.copy(lensWorldPos);
          flashOuterSpot.position.copy(lensWorldPos);
          camSpill.position.copy(camera.position);
          camLightTarget.position.copy(aimWorldPt);
        } else {
          state.flashVel.y -= 13.5 * dt;
          state.flashPos.addScaledVector(state.flashVel, dt);
          const gy = world.terrainHeight(state.flashPos.x, state.flashPos.z) + 0.05;
          if (state.flashPos.y < gy) {
            state.flashPos.y = gy;
            state.flashVel.multiplyScalar(0.35);
          }
          flashlightProp.position.copy(state.flashPos);
          flashlightProp.rotation.x += dt * 11.0;
          flashlightProp.rotation.z += dt * 8.5;
          camSpot.position.copy(state.flashPos);
          flashOuterSpot.position.copy(state.flashPos);
          const tumbleDir = new THREE.Vector3(0, -0.25, -1).applyEuler(flashlightProp.rotation);
          camLightTarget.position.copy(state.flashPos).addScaledVector(tumbleDir, 12.0);
        }
      } else {
        flashOuterSpot.intensity = 0.0;
        camSpot.color.setHex(0xc4ffd4);
        camSpot.intensity = 3.15;
        camSpot.distance = 52.0;
        camSpot.angle = 0.70;
        camSpot.penumbra = 0.65;
        camSpill.color.setHex(0x68ae7c);
        camSpill.intensity = 0.78;
        camSpill.distance = 14.5;
        hemiLight.color.setHex(0x21392a);
        hemiLight.intensity = 0.32;
        moonLight.intensity = 0.24;
        scene.fog.near = 7.5;
        scene.fog.far = 45.0;
        scene.fog.color.setRGB(0.022, 0.052, 0.032);

        camSpot.position.set(camera.position.x + 0.04, camera.position.y + 0.05, camera.position.z);
        camSpill.position.copy(camera.position);
        const lookDir = new THREE.Vector3(0, -0.02, -1).applyEuler(camera.rotation);
        camLightTarget.position.copy(camSpot.position).addScaledVector(lookDir, 18.0);
      }

      world.update(state.x, state.z, dt, state.battery, null);
      audio.updateAmbienceAndVitals(dt, 0.2, state.battery, 0, 0, "intro");

      if (t >= 2.12) {
        state.mode = "run";
        state.blink = 0;
        state.speed = BASE_SPEED;
        if (ysdk && ysdk.features && ysdk.features.GameplayAPI) {
          ysdk.features.GameplayAPI.start();
        }
      }
    }

    // =========================================================================
    // MODE 2: MAIN SPRINTING VHS NIGHTSHOT GAMEPLAY
    // =========================================================================
    else if (state.mode === "run") {
      state.runClock += dt;

      if (!state.hintHidden && state.runClock > 6.0) {
        state.hintHidden = true;
        if (hintEl) hintEl.style.opacity = "0";
      }

      const inputDir = ((keys.right || touchRight) ? 1 : 0) - ((keys.left || touchLeft) ? 1 : 0);

      const targetSpeed = Math.min(MAX_SPEED, BASE_SPEED + state.distance * 0.0056);
      state.speed += (targetSpeed - state.speed) * Math.min(1, dt * 2.4);

      const targetVx = inputDir * STRAFE_MAX;
      const accel = inputDir !== 0 ? 15.5 : 11.5;
      state.vx += (targetVx - state.vx) * Math.min(1, dt * accel);

      const prevX = state.x;
      const prevZ = state.z;
      const stepZ = state.speed * dt;
      state.z -= stepZ;
      state.x += state.vx * dt;
      state.distance += stepZ;

      // Spawn the lone burning Mi-8 helicopter ahead in the wide open field as soon as we enter 2,916m+!
      if (!state.endingHeliPlaced && state.distance >= GOAL_DISTANCE - 84.0) {
        placeFinaleHelicopterAhead();
      }
      if (state.endingHeliPlaced) {
        world.updateHelicopterFire(endingHeli, totalTime);
        ensureFinaleClearing(state.endingHeliX, state.endingHeliZ);
      }

      // Trigger the 3,000m Lone Crashed Helicopter Finale upon reaching 3,000m!
      if (state.distance >= GOAL_DISTANCE) {
        startEndingCutscene();
        return;
      }

      const groundY = world.terrainHeight(state.x, state.z);
      state.y += (groundY + EYE_HEIGHT - state.y) * Math.min(1, dt * 14.0);

      const cropInfo = world.getCropRustleAt(state.x, state.z);
      audio.updateCropRustling(dt, cropInfo, state.speed, state.vx);

      const onRoadNow = Math.abs(state.x - world.roadCenterX(state.z)) < 3.6;
      const inSwampNow = world.zoneAt(state.x, state.z) === 3;
      const runSpeedNorm = (state.speed - BASE_SPEED) / (MAX_SPEED - BASE_SPEED);
      audio.updateRunningLoop(true, onRoadNow, inSwampNow, Math.max(0, runSpeedNorm));

      const prevSin = Math.sin(state.stepPhase);
      state.stepPhase += dt * state.speed * 1.66;
      const curSin = Math.sin(state.stepPhase);
      if ((prevSin < 0 && curSin >= 0) || (prevSin > 0 && curSin <= 0)) {
        state.stepFoot = curSin >= 0 ? 1 : -1;

        state.armVelY -= state.stepFoot === 1 ? 0.58 : 0.44;
        state.armVelX += state.stepFoot * 0.24;
        state.wristRollVel += state.stepFoot === 1 ? 0.44 : -0.36;
      }

      // Camcorder battery drains down to 0.0 (~65s full charge if you miss battery crates!)
      if (!state.camcorderThrown) {
        state.battery = Math.max(0.0, state.battery - dt * 0.0155);

        if (state.battery > 0.001 && world.checkBatteryPickup(state.x, state.z)) {
          state.battery = Math.min(1.0, state.battery + 0.55);
          state.nightVisionOn = true;
          state.horrorGlitch = Math.max(state.horrorGlitch, 0.20);
          audio.playPickup();
        }

        const barsNow = state.battery <= 0.001 ? 0 : Math.ceil(state.battery * 4);
        if (barsNow > 1) {
          state.nightVisionOn = true;
          state.faceGlitchDur = 0;
        } else if (barsNow === 1) {
          // Requirement 2: On 1 battery bar, NightShot intermittently cuts OUT and back IN (spaced out so it's tense, not spammy!)
          state.nvToggleTimer -= dt;
          if (state.nvToggleTimer <= 0) {
            state.nightVisionOn = !state.nightVisionOn;
            state.nvToggleTimer = state.nightVisionOn
              ? (3.4 + Math.random() * 2.6)   // Longer steady NightShot ON window
              : (0.42 + Math.random() * 0.48); // Brief sudden dark NightShot cutout!
            state.horrorGlitch = Math.max(state.horrorGlitch, 0.14);
            audio.playNightVisionCutToggle(state.nightVisionOn);
          }

          // Rare & barely visible main-monster face VHS interference — STRICTLY ONLY WHEN IN NIGHT VISION MODE!
          if (state.nightVisionOn) {
            state.faceGlitchTimer -= dt;
            if (state.faceGlitchTimer <= 0) {
              state.faceGlitchTimer = 15.0 + Math.random() * 9.0; // Genuinely rare!
              state.faceGlitchDur = 0.13 + Math.random() * 0.08;
              state.faceGlitchPeak = 0.14 + Math.random() * 0.04; // Barely visible ghostly VHS bleed!
              state.faceGlitchSeed = Math.random() * 100.0;
              state.horrorGlitch = Math.max(state.horrorGlitch, 0.18);
              audio.playFaceGlitchSubliminal(false);
            }
          } else {
            state.faceGlitchDur = 0;
          }
        }

        // Requirement 2: When battery hits ZERO, hero throws away the dead camcorder and sprints in darkness!
        if (state.battery <= 0.001) {
          state.battery = 0.0;
          state.camcorderThrown = true;
          state.camcorderOn = false;
          state.nightVisionOn = false;
          state.faceGlitchDur = 0;
          state.faceGlitchTimer = 3.2 + Math.random() * 2.5;
          state.blink = Math.max(state.blink, 0.42);
          state.trauma = Math.min(1.0, state.trauma + 0.22);
          audio.playFlashlightDropAndCamSwitch();

          // Spawn & hurl the 3D Handycam prop forward-right onto the ground!
          camcorderProp.visible = true;
          state.camThrowActiveTime = 0;
          const handWorld = new THREE.Vector3(0.22, -0.16, -0.38).applyEuler(camera.rotation).add(camera.position);
          state.camThrowPos.copy(handWorld);
          const throwDir = new THREE.Vector3(0.32, 0.06, -1.0).applyEuler(camera.rotation).normalize();
          state.camThrowVel.copy(throwDir).multiplyScalar(8.4);
          state.camThrowVel.z -= state.speed * 0.65;
          camcorderProp.position.copy(state.camThrowPos);
        }
      } else {
        // Sprinting in darkness WITHOUT camcorder: animate hurled camcorder & intermittent monster-face hallucinations!
        if (camcorderProp.visible) {
          state.camThrowActiveTime += dt;
          state.camThrowVel.y -= 14.5 * dt;
          state.camThrowPos.addScaledVector(state.camThrowVel, dt);
          const gy = world.terrainHeight(state.camThrowPos.x, state.camThrowPos.z) + 0.06;
          if (state.camThrowPos.y < gy) {
            state.camThrowPos.y = gy;
            state.camThrowVel.y = Math.abs(state.camThrowVel.y) * 0.28;
            state.camThrowVel.x *= 0.55;
            state.camThrowVel.z *= 0.55;
          }
          camcorderProp.position.copy(state.camThrowPos);
          camcorderProp.rotation.x += dt * 9.5;
          camcorderProp.rotation.z += dt * 7.2;
          if (state.camThrowActiveTime > 3.5 || state.camThrowPos.z > state.z + 6.0) {
            camcorderProp.visible = false;
          }
        }

        state.faceGlitchTimer -= dt;
        if (state.faceGlitchTimer <= 0) {
          state.faceGlitchTimer = 10.5 + Math.random() * 7.5;
          state.faceGlitchDur = 0.18 + Math.random() * 0.12;
          state.faceGlitchPeak = 0.42 + Math.random() * 0.14;
          state.faceGlitchSeed = Math.random() * 100.0;
          state.trauma = Math.min(1.0, state.trauma + 0.10);
          audio.playFaceGlitchSubliminal(true);
        }
      }

      if (state.faceGlitchDur > 0) {
        state.faceGlitchDur = Math.max(0, state.faceGlitchDur - dt);
      }

      // Fair Tree & Obstacle Collision:
      // Dead-on trunk center = lethal crash; clipping outer edge (`немного попадаешь`) = survivable shoulder stumble!
      const col = world.checkPlayerInteraction(prevX, prevZ, state.x, state.z, (state.monsterStumbleTimer || 0) > 0);
      if (col.nearMissPan !== null) {
        audio.playNearMiss(col.nearMissPan);
        state.trauma = Math.min(1.0, state.trauma + 0.07);
      }
      if (col.hit === "crash") {
        startDeathCutscene(col);
      } else if (col.hit === "monster_stumble") {
        // Authentic *Into the Dead* partial-shoulder monster stumble (`спотыкание как в оригинале`! Second clip within 3.2s = lethal!)
        if (col.targetSafeX !== null) {
          state.x = col.targetSafeX;
        } else {
          state.x += col.pushX * 0.28;
        }
        state.monsterStumbleTimer = 3.2;
        state.vx = col.pushX * 2.55;
        state.speed = Math.max(4.6, state.speed * 0.56);
        state.armVelY -= 4.4; // Heavy downward trip dip as if legs caught!
        state.armVelX += (col.pushX > 0 ? 1 : -1) * 2.6;
        state.wristPitch -= 0.20;
        state.wristRollVel += (col.pushX > 0 ? -1 : 1) * 0.92;
        state.trauma = Math.min(1.0, state.trauma + 0.52);
        state.blink = Math.max(state.blink, 0.52);
        state.horrorGlitch = Math.max(state.horrorGlitch, 0.26);
        audio.playMonsterStumble(col.pan);
      } else if (col.hit === "graze") {
        if (col.targetSafeX !== null) {
          state.x = col.targetSafeX;
        } else {
          state.x += col.pushX * 0.25;
        }
        if (col.targetSafeZ !== null && col.targetSafeZ !== undefined) {
          state.z = col.targetSafeZ;
        }
        state.vx = col.pushX * 2.2;
        state.speed = Math.max(5.6, state.speed * 0.84);
        state.trauma = Math.min(1.0, state.trauma + 0.36);
        state.horrorGlitch = Math.max(state.horrorGlitch, 0.44);
        state.blink = Math.max(state.blink, 0.35);
        state.wristRollVel += (col.pushX > 0 ? -1 : 1) * 0.58;
        audio.playGraze(col.pan);
      }

      if (state.monsterStumbleTimer > 0) {
        state.monsterStumbleTimer = Math.max(0, state.monsterStumbleTimer - dt);
      }

      world.update(state.x, state.z, dt, state.battery, triggerHorrorEvent, false, Boolean(state.debugNoMonsters));

      state.trauma = Math.max(0, state.trauma - dt * 0.90);
      state.horrorGlitch = Math.max(0, state.horrorGlitch - dt * 1.45);
      state.blink = Math.max(0, state.blink - dt * 2.8);

      state.afTimer -= dt;
      if (state.afTimer <= 0) {
        state.afTimer = 8.0 + Math.random() * 9.0;
        state.afBlur = Math.max(state.afBlur, 0.42);
      }
      state.afBlur = Math.max(0, state.afBlur - dt * 1.35);

      state.lightningTimer -= dt;
      if (state.lightningTimer <= 0) {
        state.lightningTimer = 18.0 + Math.random() * 20.0;
        state.lightningFlash = 1.0;
        setTimeout(() => audio.playThunder(), 350 + Math.random() * 550);
      }
      state.lightningFlash = Math.max(0, state.lightningFlash - dt * 4.2);

      if (state.mode === "run") {
        const springK = 34.0;
        const damp = 9.6;
        state.armVelX += (-state.armPosX * springK - state.armVelX * damp) * dt;
        state.armVelY += (-state.armPosY * springK - state.armVelY * damp) * dt;
        state.armPosX += state.armVelX * dt;
        state.armPosY += state.armVelY * dt;

        const swayX = Math.sin(state.stepPhase * 0.5) * 0.054 + Math.sin(totalTime * 2.1) * 0.014;
        const swayY = -Math.abs(Math.cos(state.stepPhase * 0.5)) * 0.056 + Math.cos(totalTime * 1.8) * 0.012;

        const shakeAmt = state.trauma * state.trauma;
        const shakeX = (Math.random() - 0.5) * 0.16 * shakeAmt;
        const shakeY = (Math.random() - 0.5) * 0.16 * shakeAmt;

        camera.position.set(
          state.x + 0.20 + swayX + state.armPosX + shakeX,
          state.y - 0.13 + swayY + state.armPosY + shakeY,
          state.z
        );

        const targetYaw = (-state.vx / STRAFE_MAX) * 0.088 + Math.sin(state.stepPhase * 0.5) * 0.018;
        const targetPitch = -0.026 + Math.cos(state.stepPhase) * 0.020 + state.armPosY * 0.30;
        const targetRoll = (-state.vx / STRAFE_MAX) * 0.095 + Math.sin(state.stepPhase * 0.5) * 0.026;

        state.wristYaw += (targetYaw - state.wristYaw) * Math.min(1, dt * 9.0);
        state.wristPitch += (targetPitch - state.wristPitch) * Math.min(1, dt * 10.0);

        state.wristRollVel += ((targetRoll - state.wristRoll) * 40.0 - state.wristRollVel * 9.5) * dt;
        state.wristRoll += state.wristRollVel * dt;

        camera.rotation.set(
          state.wristPitch + (Math.random() - 0.5) * 0.06 * shakeAmt,
          state.wristYaw + (Math.random() - 0.5) * 0.06 * shakeAmt,
          state.wristRoll + (Math.random() - 0.5) * 0.10 * shakeAmt
        );

        const flash = state.lightningFlash > 0.65 || (state.lightningFlash > 0.25 && state.lightningFlash < 0.42) ? state.lightningFlash : 0;
        moonLight.position.set(state.x - 18, 34, state.z - 25);
        moonLight.target.position.set(state.x, 0, state.z - 12);

        if (!state.camcorderThrown && state.camcorderOn && state.nightVisionOn) {
          // Active Camcorder NightShot IR illumination
          let irFlicker = 1.0;
          if (state.battery <= 0.25) {
            const wave = Math.sin(totalTime * 28.0) * Math.cos(totalTime * 41.0);
            irFlicker = wave > 0.68 ? 0.38 : 0.85;
          }
          const battPower = 0.52 + 0.48 * state.battery;
          flashOuterSpot.intensity = 0.0;
          camSpot.color.setHex(0xc4ffd4);
          camSpot.intensity = 3.15 * battPower * irFlicker;
          camSpot.distance = 52.0;
          camSpot.angle = 0.70;
          camSpot.penumbra = 0.65;
          camSpill.color.setHex(0x68ae7c);
          camSpill.intensity = 0.78 * battPower * irFlicker;
          camSpill.distance = 14.5;

          camSpot.position.set(camera.position.x + 0.04, camera.position.y + 0.05, camera.position.z);
          camSpill.position.copy(camera.position);
          const lookDir = new THREE.Vector3(0, -0.02, -1).applyEuler(camera.rotation);
          camLightTarget.position.copy(camSpot.position).addScaledVector(lookDir, 18.0);

          hemiLight.color.setHex(0x21392a);
          hemiLight.intensity = 0.32;
          moonLight.intensity = 0.24 + flash * 2.4;
          scene.fog.near = 7.5;
          scene.fog.far = state.endingHeliPlaced ? 118.0 : 45.0;
          scene.fog.color.setRGB(0.022 + flash * 0.09, 0.052 + flash * 0.15, 0.032 + flash * 0.11);
        } else {
          // Thrown-away camcorder OR 1-bar NightShot cut-out:
          // ZERO flashlight or circle from the player, VERY dark ahead — except burning Mi-8 fire visible across the open field!
          flashOuterSpot.intensity = 0.0;
          camSpot.intensity = 0.0;
          camSpill.intensity = 0.0;

          hemiLight.color.setHex(0x111a26);
          hemiLight.groundColor.setHex(0x030508);
          hemiLight.intensity = 0.125 + flash * 0.36;
          moonLight.color.setHex(0x3d5470);
          moonLight.intensity = 0.135 + flash * 2.2;
          scene.fog.near = 2.2;
          scene.fog.far = state.endingHeliPlaced ? 96.0 : 11.5;
          scene.fog.color.setRGB(0.0022 + flash * 0.06, 0.0032 + flash * 0.09, 0.0048 + flash * 0.13);
        }

        const speedNorm = (state.speed - BASE_SPEED) / (MAX_SPEED - BASE_SPEED);
        audio.updateAmbienceAndVitals(dt, Math.max(0, speedNorm), state.battery, state.trauma, state.horrorGlitch, "run");
      }
    }

    // =========================================================================
    // MODE 2B: EMOTIONAL 5,000M OPEN-FIELD BURNING HELICOPTER -> HORDE -> BEDROOM -> LEFT DOOR KNOCK -> DRONE FOREST FINALE
    // =========================================================================
    else if (state.mode === "ending") {
      state.endingTime += dt;
      const t = state.endingTime;

      const evalBlinkWindow = (time, cStart, closeDur, shutHold, reopenDur) => {
        const sShut = cStart + closeDur;
        const sReopen = sShut + shutHold;
        const eReopen = sReopen + reopenDur;
        if (time < cStart || time >= eReopen) return 0.0;
        if (time < sShut) return smoothstep01((time - cStart) / closeDur);
        if (time < sReopen) return 1.0;
        return 1.0 - smoothstep01((time - sReopen) / reopenDur);
      };

      // Switch from open field to apartment bedroom once the fast 2.5–3.0m panic eye-slam reaches 100% black!
      const bedroomTriggerT = state.endingBedroomStartT > 0 ? state.endingBedroomStartT : 19.90;
      if (t >= bedroomTriggerT && !state.endingInBedroom) {
        state.endingInBedroom = true;
        state.endingBedroomActualT = t;
        state.camcorderOn = false;
        state.nightVisionOn = false;
        finaleHordeGroup.visible = false;
        endingHeli.visible = false;
        camcorderProp.visible = false;
        flashlightProp.visible = false;
        apartmentBedroom.group.visible = true;
        if (!state.endingWakeSoundPlayed) {
          state.endingWakeSoundPlayed = true;
          audio.playWakeUpGaspAndCalm();
        }
      }

      if (!state.endingInBedroom) {
        // ==================== PHASE 1: OPEN FIELD BURNING MI-8, GROUNDED STOP & UNNATURAL HORDE RUSH ====================
        world.updateHelicopterFire(endingHeli, totalTime);

        let stepBobX = 0.0;
        let stepBobY = 0.0;
        let stepPitchBob = 0.0;
        let stepRollBob = 0.0;

        if (t < 0.85) {
          // Grounded 2-3 heavy braking steps on grass (NO icy gliding!) -> stops cleanly ~22m before the burning Mi-8!
          const stopU = Math.pow(1.0 - smoothstep01(t / 0.85), 1.35);
          const curSpd = Math.max(0, state.speed * stopU);
          const minStopZ = state.endingHeliZ + 22.0;
          if (state.z > minStopZ) {
            state.z = Math.max(minStopZ, state.z - curSpd * dt);
          }
          state.vx *= Math.exp(-dt * 9.5);
          state.x += state.vx * dt;
          state.stepPhase += dt * Math.max(2.0, curSpd * 1.66);
          const bobGain = Math.min(1.0, curSpd / BASE_SPEED);
          stepBobX = Math.sin(state.stepPhase * 0.5) * 0.048 * bobGain;
          stepBobY = -Math.abs(Math.cos(state.stepPhase * 0.5)) * 0.052 * bobGain;
          stepPitchBob = Math.cos(state.stepPhase) * 0.022 * bobGain;
          stepRollBob = Math.sin(state.stepPhase * 0.5) * 0.028 * bobGain;
          audio.updateRunningLoop(curSpd > 2.2, false, false, 0);
          if (t >= 0.22 && !state.endingStopSoundPlayed) {
            state.endingStopSoundPlayed = true;
            audio.playEndingStopStepsAndPant();
          }
          state.endingBaseZ = state.z;
        } else {
          audio.updateRunningLoop(false);
          if (!state.endingBaseZ) state.endingBaseZ = state.z;
          // Involuntary terrified half-step backward (`+0.62m`) right as we see the silhouettes across the field (`10.20 .. 11.45s`)!
          if (t >= 10.20 && t < 11.45) {
            const backU = smoothstep01(Math.min(1.0, (t - 10.20) / 0.85));
            state.z = state.endingBaseZ + 0.62 * backU;
          }
        }
        audio.updateCropRustling(dt, null, 0, 0);

        const groundY = world.terrainSurfaceHeight(state.x, state.z);
        state.y += (groundY + EYE_HEIGHT - state.y) * Math.min(1, dt * 14.0);
        world.update(state.x, state.z, dt, state.battery, null);

        // 1) Realization Through Camcorder (`0.85 .. 3.90s`): subtle slow disbelief head-shake ("нет... это конец...")
        // 2) Logical Camcorder Put-Away (`3.90 .. 6.20s`): brief tired eye-blink (`3.90 .. 4.54s`) switches camcorder OFF
        //    at `t = 4.15s` (`camcorderOn = false`), switching to full-HD naked-eye vision while lowering the powered-off 3D camcorder!
        // 3) Standing Alone in Pitch-Dark Naked-Eye Silence (`6.20 .. 9.60s` — 3.40s alone watching the burning Mi-8)
        let disbeliefYaw = 0.0;
        let gazeAroundYaw = 0.0;
        let lowerPitch = 0.0;
        let lowerY = 0.0;
        let putAwayBlur = 0.0;

        if (t >= 1.65 && t < 3.75) {
          const dEnv = Math.sin(smoothstep01((t - 1.65) / 2.10) * Math.PI);
          disbeliefYaw = Math.sin((t - 1.65) * 4.2) * 0.042 * dEnv;
        }

        if (state.endingHadCamcorder) {
          if (t >= 3.90 && !state.endingCamLowerPlayed) {
            state.endingCamLowerPlayed = true;
            audio.playEndingCamLowerStart();
          }
          if (t >= 3.90 && t < 6.30) {
            const uBow = smoothstep01((t - 3.90) / 2.40);
            const dip = Math.sin(uBow * Math.PI);
            lowerPitch = -0.17 * dip;
            lowerY = -0.055 * dip;
          }
          if (t >= 3.90 && t < 4.15) {
            putAwayBlur = smoothstep01((t - 3.90) / 0.22) * 0.35;
          }
          // Power off camcorder strictly inside the quick eye-close (`4.10 .. 4.26s`), BEFORE lowering it visibly in naked-eye mode!
          if (t >= 4.15 && state.camcorderOn) {
            state.camcorderOn = false;
            state.nightVisionOn = false;
            if (camcorderProp.userData && camcorderProp.userData.lcdMat) {
              camcorderProp.userData.lcdMat.color.setHex(0x040605);
            }
            if (!state.endingCamPowerOffPlayed) {
              state.endingCamPowerOffPlayed = true;
              audio.playEndingCamPowerOff();
            }
          }
        } else {
          if (state.camcorderOn) {
            state.camcorderOn = false;
            state.nightVisionOn = false;
          }
          if (t >= 3.90 && !state.endingCamLowerPlayed) {
            state.endingCamLowerPlayed = true;
            audio.playEndingCamLowerStart();
          }
          if (t >= 3.90 && t < 6.30) {
            const dip = Math.sin(smoothstep01((t - 3.90) / 2.40) * Math.PI);
            lowerPitch = -0.15 * dip;
            lowerY = -0.045 * dip;
          }
        }

        // Exact death-blink intervals AFTER standing alone in darkness until `9.60s`:
        // - Appearance Blink #0: `9.60 .. 10.66s` (shut `9.96 .. 10.18s` -> 42 Main Monsters appear across horizon & both flanks!)
        // - Looking left & right in shock (`10.90 .. 15.02s`) seeing faces & glowing smiles on both sides, with Blink #1 (`12.50 .. 13.56s`)
        // - Blink #2 (`15.05 .. 15.87s`, shut `15.41 .. 15.63s` -> unnatural broken-body stop-motion horror sprint!)
        if (t >= 10.02 && !state.endingHordeSpawned) {
          state.endingHordeSpawned = true;
          layoutFinaleMonstersAroundGaze();
          finaleHordeGroup.visible = true;
        }
        if (t >= 10.22 && !state.endingHordeAppearSoundPlayed) {
          state.endingHordeAppearSoundPlayed = true;
          audio.playEndingHordeAppear();
          state.trauma = 0.18;
        }
        if (t >= 11.50 && !state.endingHeart1Played) {
          state.endingHeart1Played = true;
          audio.playEndingDisbeliefHeartbeat(0.76);
        }
        if (t >= 14.00 && !state.endingHeart2Played) {
          state.endingHeart2Played = true;
          audio.playEndingDisbeliefHeartbeat(0.90);
        }

        // Look around LEFT (`10.90 .. 12.75s`) then RIGHT (`12.75 .. 14.30s`) then back to CENTER (`14.30 .. 15.02s`)!
        if (t >= 10.90 && t < 12.10) {
          gazeAroundYaw = 0.76 * smoothstep01((t - 10.90) / 1.20);
        } else if (t >= 12.10 && t < 12.75) {
          gazeAroundYaw = 0.76;
        } else if (t >= 12.75 && t < 13.70) {
          const uLR = smoothstep01((t - 12.75) / 0.95);
          gazeAroundYaw = 0.76 * (1.0 - uLR) - 0.74 * uLR;
        } else if (t >= 13.70 && t < 14.30) {
          gazeAroundYaw = -0.74;
        } else if (t >= 14.30 && t < 15.02) {
          gazeAroundYaw = -0.74 * (1.0 - smoothstep01((t - 14.30) / 0.72));
        }

        // Inside Blink #2 (`t >= 15.48s`, eyes 100% shut): snap horde to `~15.4m..30m` & launch broken-body blitz!
        if (t >= 15.48 && !state.endingHordeCharging) {
          state.endingHordeCharging = true;
          for (const fm of finaleMonsters) {
            fm.wx = fm.chargeWx;
            fm.wz = fm.chargeWz;
            fm.wy = world.terrainSurfaceHeight(fm.wx, fm.wz);
            fm.model.group.position.set(fm.wx, fm.wy, fm.wz);
            fm.model.group.rotation.y = Math.atan2(state.x - fm.wx, state.z - fm.wz);
          }
        }
        if (t >= 15.58 && !state.endingChargeSoundPlayed) {
          state.endingChargeSoundPlayed = true;
          audio.playEndingHordeCharge();
          state.trauma = 0.72;
          state.horrorGlitch = 0.45;
        }

        // Animate TERRIFYING, UNNATURAL, BROKEN-BODY STOP-MOTION HORROR RUSH (`t >= 15.48s`):
        // Quantized explosive surge lunges + violently snapped necks (`±1.45 rad`) + twisted spines + splayed claw flailing!
        if (state.endingHordeCharging) {
          let minDistP = 999.0;
          for (const fm of finaleMonsters) {
            const dxP = state.x - fm.wx;
            const dzP = state.z - fm.wz;
            const distP = Math.hypot(dxP, dzP);
            const dirX = dxP / (distP || 1);
            const dirZ = dzP / (distP || 1);
            const perpX = -dirZ;
            const perpZ = dirX;

            // Stop-motion / broken-cadence surge: brief `35ms` tense crouches alternating with explosive 2.4x lunges!
            const snapTick = Math.floor(t * 21.0 + fm.phase * 4.3);
            const burstPhase = (t * 11.5 + fm.phase * 0.7) % 1.0;
            const surgeMult = burstPhase < 0.34 ? 0.25 : 2.15;
            const stepM = fm.sprintSpeed * surgeMult * dt;
            fm.wx += dirX * stepM;
            fm.wz += dirZ * stepM;
            fm.wy = world.terrainSurfaceHeight(fm.wx, fm.wz);
            const newDist = Math.max(0, distP - stepM);
            if (newDist < minDistP) minDistP = newDist;

            // Violent bone-snapping asymmetric contortions quantized on `snapTick`!
            const cyc = t * 32.0 + fm.phase;
            const sL = Math.sin(cyc);
            const cL = Math.cos(cyc);
            const h1 = Math.sin(snapTick * 17.91 + fm.phase * 7.3);
            const h2 = Math.cos(snapTick * 29.43 + fm.phase * 3.7);
            const h3 = Math.sin(snapTick * 43.17 + fm.phase * 11.1);
            const latSnap = h1 * 0.42 * Math.min(1.0, distP / 7.5);

            fm.model.group.position.set(fm.wx + perpX * latSnap, fm.wy, fm.wz + perpZ * latSnap);
            fm.model.group.rotation.y = Math.atan2(dxP, dzP) + h2 * 0.26;
            fm.model.legL.rotation.x = sL * 1.38;
            fm.model.legR.rotation.x = -sL * 1.38;
            fm.model.torso.position.y = 0.86 + Math.abs(cL) * 0.16 - 0.08;
            // Spine violently arches backward or lunges deeply forward at sharp broken angles!
            fm.model.torso.rotation.x = (h3 > 0.35 ? -0.22 : 0.74) + h1 * 0.18;
            fm.model.torso.rotation.y = h2 * 0.56;
            fm.model.torso.rotation.z = h1 * 0.46;
            // Arms flail overhead / twisted sideways like a broken marionette!
            fm.model.armL.rotation.set(-1.95 - sL * 0.85 + h1 * 0.45, h2 * 0.35,  0.48 + h3 * 0.42);
            fm.model.armR.rotation.set(-1.95 + sL * 0.85 - h2 * 0.45, h1 * 0.35, -0.48 - h3 * 0.42);
            // Neck violently snaps up to ±1.45 rad (nearly upside-down/sideways!) every ~48ms!
            fm.model.head.rotation.set(-0.42 + h2 * 0.48, h1 * 0.54, h3 * 1.45);
          }

          // Start ultra-fast 0.12s eye-slam at 4.70m so eyes hit 100% shut right when closest contorted monster is ~2.4–2.8m away!
          if (state.endingEyeSlamStartT === 0 && (minDistP <= 4.70 || t >= 17.90)) {
            state.endingEyeSlamStartT = t;
            state.endingBedroomStartT = t + 0.17;
          }
        }

        state.trauma = Math.max(0, state.trauma - dt * 0.85);
        const heaveAmp = t < 3.9 ? 0.016 : 0.009;
        const breathSwayY = t < 0.85 ? 0.0 : Math.sin(t * (t < 3.9 ? 3.8 : 2.5)) * heaveAmp;
        const fearTrembleX = state.endingHordeCharging
          ? Math.sin(t * 54.0) * 0.024
          : (state.endingHordeSpawned ? Math.sin(t * 29.0) * 0.004 : 0);

        const camOffset = state.camcorderOn ? 0.18 : 0.0;
        camera.position.set(
          state.x + camOffset + stepBobX + fearTrembleX,
          state.y - (state.camcorderOn ? 0.10 : 0.02) + stepBobY + breathSwayY + lowerY,
          state.z
        );

        const lookDx = state.endingHeliX - camera.position.x;
        const lookDy = (state.endingHeliY + 1.55) - camera.position.y;
        const lookDz = state.endingHeliZ - camera.position.z;
        const desiredYaw = Math.atan2(-lookDx, -lookDz) + disbeliefYaw + gazeAroundYaw;
        const desiredPitch = Math.atan2(lookDy, Math.hypot(lookDx, lookDz)) + lowerPitch + stepPitchBob;
        const yawBlend = t < 0.85 ? 3.2 : 5.5;
        state.wristYaw += (desiredYaw - state.wristYaw) * Math.min(1, dt * yawBlend);
        state.wristPitch += (desiredPitch - state.wristPitch) * Math.min(1, dt * 5.0);
        state.wristRoll += (stepRollBob - state.wristRoll) * Math.min(1, dt * 7.5);
        camera.rotation.set(state.wristPitch, state.wristYaw, state.wristRoll);

        // Lower the POWERED-OFF 3D camcorder in full-HD naked-eye mode (`4.22 .. 6.20s`)!
        if (state.endingHadCamcorder && !state.camcorderOn && t >= 4.22 && t < 6.20) {
          camcorderProp.visible = true;
          const dropU = smoothstep01((t - 4.22) / 1.98);
          const handTremble = Math.sin(t * 31.0) * 0.005 * (1.0 - dropU * 0.6);
          const localOff = new THREE.Vector3(
            0.16 + handTremble,
            -0.04 - 0.34 * dropU,
            -0.44 + 0.08 * dropU
          ).applyEuler(camera.rotation);
          camcorderProp.position.copy(camera.position).add(localOff);
          camcorderProp.rotation.set(
            camera.rotation.x - 0.48 * dropU,
            camera.rotation.y + 0.24 * dropU,
            camera.rotation.z - 0.28 * dropU
          );
        } else {
          camcorderProp.visible = false;
        }

        // Lighting: NightShot while held, then TRUE PITCH-DARK NAKED-EYE NIGHT matching gameplay without camera!
        // Only the burning Mi-8 firelight & the monsters' faces/glowing eyes + toothy smiles pierce the darkness!
        moonLight.position.set(state.endingHeliX - 8, 32, state.endingHeliZ + 14);
        moonLight.target.position.set(state.endingHeliX, state.endingHeliY + 1.2, state.endingHeliZ - 8);
        if (state.camcorderOn && state.nightVisionOn) {
          flashOuterSpot.intensity = 0.0;
          camSpot.color.setHex(0xc4ffd4);
          camSpot.intensity = 2.85;
          camSpot.distance = 68.0;
          camSpot.position.copy(camera.position);
          camSpill.intensity = 0.65;
          camSpill.position.copy(camera.position);
          camLightTarget.position.set(state.endingHeliX, state.endingHeliY + 1.4, state.endingHeliZ);
          hemiLight.color.setHex(0x21392a);
          hemiLight.intensity = 0.34;
          moonLight.intensity = 0.30;
          scene.fog.near = 9.0;
          scene.fog.far = 76.0;
          scene.fog.color.setRGB(0.022, 0.052, 0.032);
        } else {
          camSpot.intensity = 0.0;
          flashOuterSpot.intensity = 0.0;
          if (camcorderProp.visible) {
            camSpill.color.setHex(0x88a4c2);
            camSpill.intensity = 1.15;
            camSpill.distance = 0.75;
            camSpill.position.copy(camera.position).add(new THREE.Vector3(0.14, 0.08, -0.26).applyEuler(camera.rotation));
          } else {
            camSpill.intensity = 0.0;
          }

          hemiLight.color.setHex(0x131e2c);
          hemiLight.groundColor.setHex(0x030508);
          hemiLight.intensity = 0.145;
          moonLight.color.setHex(0x466182);
          moonLight.intensity = 0.165;
          scene.fog.near = 2.8;
          scene.fog.far = 72.0;
          scene.fog.color.setRGB(0.0022, 0.0032, 0.0048);
        }

        // Eyelid envelope across Phase 1:
        // 1) Quick natural blink as camcorder powers off (`3.90 .. 4.54s`, shut `4.10 .. 4.26s`)
        // 2) Appearance Blink #0 (`9.60 .. 10.66s`)
        // 3) Disbelief Blink #1 (`12.50 .. 13.56s`) & Blink #2 (`15.05 .. 15.87s`)
        // 4) Fast 0.12s panic eye-slam as soon as closest monster reaches ~4.70m (shut at ~2.4–2.8m)!
        let bVal = 0.0;
        if (state.endingHadCamcorder) {
          bVal = Math.max(bVal, evalBlinkWindow(t, 3.90, 0.20, 0.16, 0.28));
        }
        bVal = Math.max(bVal, evalBlinkWindow(t, 9.60, 0.36, 0.22, 0.48));  // Appearance blink (#0)
        bVal = Math.max(bVal, evalBlinkWindow(t, 12.50, 0.36, 0.22, 0.48)); // 1st blink (#1) while looking across flanks
        bVal = Math.max(bVal, evalBlinkWindow(t, 15.05, 0.36, 0.22, 0.24)); // 2nd blink (#2) -> reveals broken-body rush!
        if (state.endingEyeSlamStartT > 0) {
          bVal = Math.max(bVal, smoothstep01(Math.min(1.0, (t - state.endingEyeSlamStartT) / 0.12)));
        }
        state.blink = bVal;
        vhsUniforms.uAfBlur.value = putAwayBlur;
        audio.updateAmbienceAndVitals(dt, 0, state.battery, state.trauma, 0, "death");

      } else {
        // ==================== PHASE 2: UNHURRIED APARTMENT BEDROOM WAKE-UP -> LONG CALM -> LEFT KNOCK -> SLOW FADE ====================
        const wakeT0 = (state.endingBedroomActualT || 18.20) + 0.04;
        const bt = Math.max(0, t - wakeT0); // Seconds since snapping eyes open in bed
        const roomBaseY = apartmentBedroom.group.position.y;

        camSpot.intensity = 0.0;
        camSpill.intensity = 0.0;
        flashOuterSpot.intensity = 0.0;
        moonLight.intensity = 0.06;
        hemiLight.color.setHex(0x4e443a);
        hemiLight.intensity = 0.44;
        scene.fog.near = 14.0;
        scene.fog.far = 42.0;
        scene.fog.color.setRGB(0.012, 0.011, 0.016);
        vhsUniforms.uAfBlur.value = 0.0;
        state.trauma = 0.0;

        // 1) Sit-up jolt (`0.0 .. 0.52s`) -> stays propped while looking around & calming down (`0.52 .. 8.45s`) -> slowly lies back down (`8.45 .. 10.95s`)!
        let sitU = 0.0;
        if (bt < 0.52) {
          const u = bt / 0.52;
          sitU = 1.0 - Math.pow(1.0 - u, 2.8);
        } else if (bt < 8.45) {
          sitU = 1.0;
        } else if (bt < 10.95) {
          sitU = 1.0 - smoothstep01((bt - 8.45) / 2.50);
        } else {
          sitU = 0.0;
        }

        if (bt >= 8.55 && !state.endingLieDownSoundPlayed) {
          state.endingLieDownSoundPlayed = true;
          audio.playLieDownBlanketRustle();
        }

        // 2) Scared panting right upon waking (`0.0 .. 2.60s`) that gradually calms into quiet peaceful breathing
        const pantEnv = Math.exp(-bt * 1.15);
        const calmEnv = 1.0 - pantEnv;
        const breathBobY = Math.sin(bt * 10.6) * 0.022 * pantEnv + Math.sin(bt * 2.0) * 0.005 * calmEnv;
        const breathPitch = Math.cos(bt * 10.6) * 0.018 * pantEnv;

        // 3) Unhurried Head Turn Choreography:
        // - `0.00 .. 2.75s`: Catching breath in the quiet dark room ("это был всего лишь сон...")
        // - `2.75 .. 4.30s`: Slowly turn head LEFT (`yaw -> +1.04 rad`) toward our closed bedroom door
        // - `4.30 .. 5.40s`: Quiet 1.1s pause looking at the closed wooden door
        // - `5.40 .. 6.95s`: Slowly turn head toward the headboard wall (`yaw -> +2.14 rad`)
        // - `6.95 .. 8.45s`: Calm 1.5s pause taking in the warm bedside lamp & moonlit night window
        // - `8.45 .. 10.95s`: Slowly sink back onto the pillow (`yaw -> +0.16 rad`) & close eyes to sleep!
        let lookYaw = 0.0;
        let lookPitchAdd = 0.0;
        let headShiftX = 0.0;
        let headRoll = 0.0;

        if (bt < 2.75) {
          lookYaw = Math.sin(bt * 4.2) * 0.03 * pantEnv;
          lookPitchAdd = 0.0;
        } else if (bt < 4.30) {
          const u = smoothstep01((bt - 2.75) / 1.55);
          lookYaw = 1.04 * u;
          lookPitchAdd = 0.07 * u;
          headShiftX = -0.04 * u;
        } else if (bt < 5.40) {
          lookYaw = 1.04;
          lookPitchAdd = 0.07;
          headShiftX = -0.04;
        } else if (bt < 6.95) {
          const u = smoothstep01((bt - 5.40) / 1.55);
          lookYaw = 1.04 + (2.14 - 1.04) * u;
          lookPitchAdd = 0.07 - 0.03 * u;
          headShiftX = 0.08 * u - 0.04 * (1.0 - u);
        } else if (bt < 8.45) {
          lookYaw = 2.14;
          lookPitchAdd = 0.04;
          headShiftX = 0.08;
        } else {
          const u = smoothstep01(Math.min(1.0, (bt - 8.45) / 2.45));
          lookYaw = 2.14 * (1.0 - u) + 0.16 * u;
          lookPitchAdd = 0.04 * (1.0 - u);
          headShiftX = 0.08 * (1.0 - u);
          headRoll = -0.045 * u;
        }

        const camRelX = headShiftX;
        const camRelY = 0.78 + 0.30 * sitU + breathBobY;
        const camRelZ = 0.78 - 0.52 * sitU;
        const basePitch = 0.06 * (1.0 - sitU) + (-0.11) * sitU;

        camera.position.set(camRelX, roomBaseY + camRelY, camRelZ);
        camera.rotation.set(basePitch + lookPitchAdd + breathPitch, lookYaw, headRoll);

        // 4) Bedroom Eyelids: Snap open on wake (`bt: 0.00 .. 0.24s`), stay open while calming down,
        //    then close slowly & sleepily as we sink into the pillow (`bt: 9.35 .. 11.00s`)!
        let bBed = 0.0;
        if (t < wakeT0) {
          bBed = 1.0;
        } else if (bt < 0.24) {
          bBed = 1.0 - smoothstep01(bt / 0.24);
        } else if (bt >= 9.35) {
          bBed = smoothstep01(Math.min(1.0, (bt - 9.35) / 1.65));
        }
        state.blink = bBed;

        // 5) 2.35 seconds of deep quiet stillness after closing eyes -> REAL BINAURAL DOOR KNOCK FROM THE LEFT (`bt = 13.35s`)!
        if (bt >= 13.35 && !state.endingDoorKnockPlayed) {
          state.endingDoorKnockPlayed = true;
          audio.playBedroomLeftDoorKnock();
        }

        // 6) ~1.40s after the knock starts (`bt = 13.35s -> 14.75s`), immediately start the smooth black cross-fade into the Drone Forest & titles!
        if (bt >= 14.75) {
          setGameplayActive(false);
          state.blink = 0.0;
          state.screenFade = 1.0;
          state.mode = "end_menu";
          state.endMenuTime = 0;
          state.endGlitchTimer = 8.2 + Math.random() * 2.8;
          state.faceGlitchDur = 0;
          state.faceGlitchPeak = 0;
          apartmentBedroom.group.visible = false;
          endingHeli.visible = false;
          finaleHordeGroup.visible = false;
          state.droneZ = -640.0;
          state.droneX = world.roadCenterX(state.droneZ) * 0.35;
          world.update(state.droneX, state.droneZ, 0.016, 1.0, null, true, true);
          if (crashOverlay) {
            crashOverlay.classList.add("ending-complete", "visible");
          }
        }

        audio.updateAmbienceAndVitals(dt, 0, state.battery, 0, 0, "bedroom");
      }
    }

    // =========================================================================
    // MODE 2C: POST-ENDING LOW-ALTITUDE DRONE VIEW OVER MONSTER-FREE FOREST + DARK AMBIENCE + RARE SUBTLE FACE GLITCHES
    // =========================================================================
    else if (state.mode === "end_menu") {
      state.endMenuTime += dt;
      const et = state.endMenuTime;

      // Pure smooth black fade-in (NO eyelid blink shape!) revealing the drone forest & `INTO THE DARK` titles
      state.blink = 0.0;
      state.screenFade = et < 0.25 ? 1.0 : (1.0 - smoothstep01(Math.min(1.0, (et - 0.25) / 5.5)));
      state.camcorderOn = false;
      state.nightVisionOn = false;
      vhsUniforms.uAfBlur.value = 0.0;

      // Quiet slow low-altitude aerial drone flight gliding just above the dark moonlit forest (`hideAllEnemies = true`!)
      state.droneZ -= dt * 2.35;
      // Seamless loop well before the 5,000m open field so the drone glides over endless forest forever
      if (state.droneZ < -4650.0) {
        state.droneZ = -640.0;
        state.droneX = world.roadCenterX(state.droneZ) * 0.35;
        world.update(state.droneX, state.droneZ, 0.016, 1.0, null, true, true);
      }
      const targetDroneX = world.roadCenterX(state.droneZ) * 0.35 + Math.sin(et * 0.15) * 5.2;
      state.droneX += (targetDroneX - state.droneX) * Math.min(1, dt * 0.85);

      world.update(state.droneX, state.droneZ, dt, 1.0, null, false, true);

      const groundH = world.terrainHeight(state.droneX, state.droneZ);
      const droneY = groundH + 11.2 + Math.sin(et * 0.42) * 0.32;
      camera.position.set(state.droneX, droneY, state.droneZ);
      camera.rotation.set(
        -0.31 + Math.sin(et * 0.27) * 0.018,
        Math.sin(et * 0.15) * 0.08,
        Math.cos(et * 0.15) * 0.022
      );

      // Moody silver-blue night moonlight over the dark treetops
      camSpot.intensity = 0.0;
      camSpill.intensity = 0.0;
      flashOuterSpot.color.setHex(0x6e8fb8);
      flashOuterSpot.intensity = 1.35;
      flashOuterSpot.distance = 68.0;
      flashOuterSpot.angle = 1.05;
      flashOuterSpot.penumbra = 0.92;
      flashOuterSpot.position.set(state.droneX, droneY + 8.0, state.droneZ + 4.0);
      camLightTarget.position.set(state.droneX, groundH + 1.5, state.droneZ - 26.0);

      hemiLight.color.setHex(0x283a52);
      hemiLight.groundColor.setHex(0x05080d);
      hemiLight.intensity = 0.48;
      moonLight.color.setHex(0x7a9ec4);
      moonLight.intensity = 0.62;
      moonLight.position.set(state.droneX - 18, droneY + 26, state.droneZ - 24);
      moonLight.target.position.set(state.droneX, groundH, state.droneZ - 18);
      scene.fog.near = 14.0;
      scene.fog.far = 72.0;
      scene.fog.color.setRGB(0.016, 0.024, 0.038);

      // Occasional, barely-visible subliminal Main Monster face glitches (`едва заметные редкие глитчи с мордой главного монстра`)
      if (et > 5.5) {
        state.endGlitchTimer -= dt;
        if (state.endGlitchTimer <= 0) {
          state.endGlitchTimer = 4.8 + Math.random() * 4.2;
          state.faceGlitchDur = 0.11 + Math.random() * 0.06;
          state.faceGlitchPeak = 0.16 + Math.random() * 0.07; // Barely-visible ghostly tear (`0.16 .. 0.23`)!
          state.faceGlitchSeed = Math.random() * 100.0;
          state.horrorGlitch = 0.07;
        }
      }
      if (state.faceGlitchDur > 0) {
        state.faceGlitchDur = Math.max(0, state.faceGlitchDur - dt);
      }
      state.horrorGlitch = Math.max(0, state.horrorGlitch - dt * 1.8);
      state.trauma = 0.0;

      audio.updateAmbienceAndVitals(dt, 0, 1.0, 0.0, state.horrorGlitch, "end_menu");
    }

    // =========================================================================
    // MODE 3 & 4: REALISTIC PHYSICAL CRASH & FALL -> BLINK REVEAL OF MOTIONLESS GRINNING MONSTER BESIDE US -> GAME OVER!
    // =========================================================================
    if (state.mode === "death" || state.mode === "gameover") {
      if (state.mode === "death") {
        state.deathTime += dt;
      } else {
        state.gameOverTime += dt;
      }
      const t = state.deathTime;
      const side = state.deathSide || 1;

      // Camcorder violently tears & gets knocked out of hands during the first 0.15s of impact!
      if (t >= 0.15 && state.camcorderOn) {
        state.camcorderOn = false;
      }
      state.trauma = Math.max(0, state.trauma - dt * 1.6);
      state.horrorGlitch = Math.max(0, state.horrorGlitch - dt * 2.2);

      if (!state.camcorderOn) {
        camSpot.intensity = 0.0;
        flashOuterSpot.intensity = 0.0;
        hemiLight.color.setHex(0x101926);
        hemiLight.intensity = 0.055;
        moonLight.intensity = 0.045;
        scene.fog.near = 5.0;
        scene.fog.far = 32.0;
        scene.fog.color.setRGB(0.006, 0.010, 0.016);
      }
      vhsUniforms.uAfBlur.value = t < 0.7 ? Math.max(0, (0.7 - t) * 0.55) : 0.0;

      // 1. Smooth horizontal physical rebound off obstacle (NO frame-0 teleport!)
      const reboundU = 1.0 - Math.pow(Math.max(0, 1.0 - Math.min(1, t / 0.64)), 2.6);
      const curX = state.crashStartX + (state.fallEndX - state.crashStartX) * reboundU;
      const curZ = state.crashStartZ + (state.fallEndZ - state.crashStartZ) * reboundU;
      state.x = curX;
      state.z = curZ;
      const groundY = world.terrainHeight(curX, curZ);

      // 2. Realistic vertical gravity trajectory: knees buckle (0..0.12s) -> quadratic free-fall (0.12..0.50s) -> damped ground bounce (0.50..0.74s)
      const startRelH = Math.max(1.2, state.crashStartY - world.terrainHeight(state.crashStartX, state.crashStartZ));
      let relH = 0.22;
      if (t < 0.12) {
        const u = t / 0.12;
        relH = startRelH - 0.16 * (u * u);
      } else if (t < 0.50) {
        const gU = (t - 0.12) / 0.38;
        const gravDrop = gU * gU; // Real 0.5 * g * t^2 acceleration!
        relH = (startRelH - 0.16) * (1.0 - gravDrop) + 0.21 * gravDrop;
      } else if (t < 0.74) {
        const bU = (t - 0.50) / 0.24;
        // Shoulder & head hitting forest dirt/leaves with damped physical bounce
        relH = 0.22 + Math.sin(bU * Math.PI) * 0.062 * (1.0 - bU * 0.45);
      } else {
        relH = 0.22;
      }

      // 3. Realistic angular head snap -> sideways body topple -> ground impact jolt -> shallow breathing rest
      const breathTilt = t > 0.75 ? Math.sin(t * 2.1) * 0.006 : 0;
      let camPitch, camYaw, camRoll;
      if (t < 0.12) {
        const u = smoothstep01(t / 0.12);
        // Sharp head whip on impact with tree trunk!
        camPitch = state.crashStartPitch + 0.26 * u;
        camYaw = state.crashStartYaw - side * 0.14 * u;
        camRoll = state.crashStartRoll - side * 0.30 * u;
      } else {
        const toppleU = smoothstep01((t - 0.12) / 0.52);
        // Secondary jolt right at t = 0.50s when shoulder/head hits the forest floor
        const hitShock = (t >= 0.48 && t < 0.68) ? Math.sin(((t - 0.48) / 0.20) * Math.PI) * 0.11 : 0.0;
        const p0 = state.crashStartPitch + 0.26;
        const y0 = state.crashStartYaw - side * 0.14;
        const r0 = state.crashStartRoll - side * 0.30;

        camPitch = p0 * (1.0 - toppleU) + (state.deathTargetPitch + breathTilt - hitShock * 0.5) * toppleU;
        camYaw = y0 * (1.0 - toppleU) + state.deathTargetYaw * toppleU;
        camRoll = r0 * (1.0 - toppleU) + (side * (0.36 + hitShock)) * toppleU;
      }

      camera.position.set(curX, groundY + relH, curZ);
      camera.rotation.set(camPitch, camYaw, camRoll);

      // Quiet slow footsteps on dirt approaching from that side before the blink reveal
      if (!state.deathStep1Played && t >= state.deathStep1T) {
        state.deathStep1Played = true;
        audio.playDeathApproachStep(side);
      }
      if (!state.deathStep2Played && t >= state.deathStep2T) {
        state.deathStep2Played = true;
        audio.playDeathApproachStep(side);
      }

      // Spawn our sculpted pitch-black grinning monster BESIDE US (`сбоку от нас`) & COMPLETELY MOTIONLESS (`не трясётся`)
      // while eyelids are 100% CLOSED on the target blink!
      if (!state.deathMonsterShown && t >= state.deathMonsterSpawnT) {
        state.deathMonsterShown = true;
        deathMonster.group.visible = true;

        const mx = state.deathMonsterX;
        const mz = state.deathMonsterZ;
        const my = state.deathMonsterY;
        deathMonster.group.position.set(mx, my, mz);
        deathMonster.group.rotation.order = "YXZ";
        const faceYaw = Math.atan2(state.fallEndX - mx, state.fallEndZ - mz);
        // Completely motionless (`не трясётся`), hunched forward so its sunken eyes, ribs, claws & wide toothy grin loom right over us!
        deathMonster.group.rotation.set(0.28, faceYaw, 0);

        audio.playDeathMonsterFinalSting();
      }

      // Never brighten the dark forest when the death monster appears — keep the exact pitch-dark night!
      camSpill.intensity = 0.0;
      flashOuterSpot.intensity = 0.0;

      // Compute exact eyelid blink openness: impact flinch -> groggy recovery -> slow blinks -> monster reveal -> final eye-close!
      if (state.mode === "gameover") {
        state.blink = 1.0;
      } else if (t < 0.16) {
        state.blink = smoothstep01(t / 0.16) * 0.94;
      } else if (t < 0.82) {
        state.blink = 0.94 * (1.0 - smoothstep01((t - 0.16) / 0.66));
      } else if (t >= state.deathFinalCloseStartT) {
        state.blink = smoothstep01((t - state.deathFinalCloseStartT) / (state.deathFinalCloseEndT - state.deathFinalCloseStartT));
        if (t >= state.deathFinalCloseEndT) {
          state.blink = 1.0;
          state.mode = "gameover";
          const runM = Math.max(0, Math.floor(state.distance));
          let isNewRec = false;
          if (!state.usedDebugWarp && runM > state.bestDistance) {
            state.bestDistance = runM;
            saveBestDistance(runM);
            isNewRec = true;
          }
          updateCrashStatsUI(runM, state.bestDistance, isNewRec);
          if (crashOverlay) {
            crashOverlay.classList.remove("ending-complete");
            crashOverlay.classList.add("visible");
          }
          showDeathFullscreenAd();
        }
      } else {
        let bVal = 0.0;
        for (const b of state.deathBlinks) {
          if (t >= b.startClose && t < b.startShut) {
            bVal = smoothstep01((t - b.startClose) / (b.startShut - b.startClose));
            break;
          } else if (t >= b.startShut && t < b.startReopen) {
            bVal = 1.0;
            break;
          } else if (t >= b.startReopen && t < b.endReopen) {
            bVal = 1.0 - smoothstep01((t - b.startReopen) / (b.endReopen - b.startReopen));
            break;
          }
        }
        state.blink = bVal;
      }

      audio.updateAmbienceAndVitals(dt, 0, state.battery, 0.15, 0, state.mode === "gameover" ? "gameover" : "death");
    }

    // === RENDER 3D SCENE & POST-PROCESSING ===
    if (lastRtCamOn !== Boolean(state.camcorderOn)) {
      syncRenderTargetSize(Boolean(state.camcorderOn));
    }
    if (state.camcorderOn) {
      osd.update(state.runClock, state.battery, state.distance, state.afBlur, state.nightVisionOn);
    }

    const desiredFar = (isTouchDevice && state.mode === "run" && state.distance < 2750) ? 52.0 : 96.0;
    if (camera.far !== desiredFar) {
      camera.far = desiredFar;
      camera.updateProjectionMatrix();
    }
    flashOuterSpot.visible = flashOuterSpot.intensity > 0.001;
    camSpill.visible = camSpill.intensity > 0.001;

    scene.background.copy(scene.fog.color);
    renderer.setRenderTarget(vhsRT);
    renderer.render(scene, camera);

    vhsUniforms.uTime.value = totalTime;
    vhsUniforms.uBattery.value = state.battery;
    vhsUniforms.uTrauma.value = state.trauma;
    vhsUniforms.uHandSpeed.value = Math.min(1.0, Math.abs(state.vx) / STRAFE_MAX);
    vhsUniforms.uHorrorGlitch.value = state.horrorGlitch;
    vhsUniforms.uCamcorderOn.value = state.camcorderOn ? 1.0 : 0.0;
    vhsUniforms.uNightVision.value = state.nightVisionOn ? 1.0 : 0.0;
    const activeFaceGlitch = (
      state.faceGlitchDur > 0 &&
      (state.mode === "end_menu" || (state.mode === "run" && (!state.camcorderOn || state.nightVisionOn)))
    ) ? state.faceGlitchPeak : 0.0;
    vhsUniforms.uFaceGlitchAmt.value = activeFaceGlitch;
    vhsUniforms.uFaceGlitchSeed.value = state.faceGlitchSeed;
    if (state.mode === "run") {
      vhsUniforms.uAfBlur.value = state.afBlur;
    }

    renderer.setRenderTarget(null);
    renderer.render(postScene, postCam);

    // Eyelid Blink / Death Eye-Close Overlay + Fullscreen Fade
    window.HorrorShaders.drawEyelidBlink(blinkCtx, blinkCanvas.width, blinkCanvas.height, state.blink, state.trauma);
    if (state.screenFade > 0.002) {
      blinkCtx.fillStyle = "rgba(1, 2, 1, " + Math.min(1, state.screenFade).toFixed(3) + ")";
      blinkCtx.fillRect(0, 0, blinkCanvas.width, blinkCanvas.height);
    }
  }

  window.__DEBUG_GAME = { state, world, camera, audio, renderer, deathMonster, camcorderProp, endingHeli, startIntroCutscene, startDeathCutscene, startEndingCutscene, warpTo2950 };

  requestAnimationFrame(tick);
})();
