// Real Sample-Based 8D Binaural & Night Forest Audio Engine
// Uses real field/studio recordings + 3 stereo binaural door-knock fragments from H5Cjttt_J-Q ("Объёмный стук")
window.HorrorAudio = (function () {
  function b64ToArrayBuffer(b64) {
    const bin = window.atob(b64);
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    return bytes.buffer;
  }

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.dryBus = null;
      this.reverbBus = null;
      this.buffers = {};
      this.ready = false;
      this.unlocked = false;
      this.mutedByTab = false;

      // Looping real audio nodes
      this.windGain = null;
      this.windFilter = null;
      this.windStarted = false;

      // Seamless real continuous running loops (forest earth/turf & asphalt road — zero choppy tap-cuts!)
      this.runStarted = false;
      this.runForestSrc = null;
      this.runForestGain = null;
      this.runForestFilter = null;
      this.runRoadSrc = null;
      this.runRoadGain = null;

      this.cropGainL = null;
      this.cropGainR = null;
      this.cropStarted = false;
      this.prevStalkCellZ = null;
      this.prevRowK = null;
      this.cropHitCooldown = 0;
      this.cropShoulderToggle = 1;

      this.subDroneGain = null;

      this.stepSide = 1;
      this.stepIdx = 0;
      this.breathClock = 0;
      this.heartClock = 0.4;
      this._breathIdx = 0;
      this._knockIdx = Math.floor(Math.random() * 3);

      // Spaced-out high-impact 3D horror events
      this.doorKnockTimer = 14.0 + Math.random() * 7.0;
      this.behind8DTimer = 24.0 + Math.random() * 12.0;
    }

    unlock() {
      if (this.unlocked) {
        if (this.ctx && this.ctx.state === "suspended" && !this.mutedByTab) {
          this.ctx.resume().catch(() => {});
        }
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;

      this.ctx = new AC();
      this.unlocked = true;

      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -10;
      comp.knee.value = 12;
      comp.ratio.value = 5.0;
      comp.attack.value = 0.003;
      comp.release.value = 0.16;

      this.master = this.ctx.createGain();
      this.master.gain.value = 1.15;
      this.master.connect(comp);
      comp.connect(this.ctx.destination);

      this.dryBus = this.ctx.createGain();
      this.dryBus.gain.value = 1.0;
      this.dryBus.connect(this.master);

      const convolver = this.ctx.createConvolver();
      convolver.buffer = this._buildForestImpulse(1.9);
      this.reverbBus = this.ctx.createGain();
      this.reverbBus.gain.value = 0.34;
      this.reverbBus.connect(convolver);
      convolver.connect(this.master);

      // Subtle sub-bass dread undertone (pure 42 Hz sine, inaudible as hiss, pure atmosphere)
      const d1 = this.ctx.createOscillator();
      d1.type = "sine";
      d1.frequency.value = 42.0;
      this.subDroneGain = this.ctx.createGain();
      this.subDroneGain.gain.value = 0.0;
      d1.connect(this.subDroneGain);
      this.subDroneGain.connect(this.dryBus);
      d1.start();

      this._decodeAllSamples();
      this._ensureEndMenuAmbient();
    }

    _decodeAllSamples() {
      const sfxData = window.HorrorSfxData || {};
      const keys = Object.keys(sfxData);
      if (!keys.length) return;

      const decodeOne = (key) =>
        new Promise((resolve) => {
          try {
            const ab = b64ToArrayBuffer(sfxData[key]);
            this.ctx.decodeAudioData(
              ab,
              (buf) => {
                this.buffers[key] = buf;
                resolve();
              },
              () => resolve()
            );
          } catch (_) {
            resolve();
          }
        });

      Promise.all(keys.map(decodeOne)).then(() => {
        this.ready = true;
        this._startRealLoopsIfNeeded();
      });
    }

    _startRealLoopsIfNeeded() {
      if (!this.ctx || !this.ready) return;

      // 1. Real Night Forest Wind Loop (deep natural air movement — zero white-noise static!)
      if (!this.windStarted && this.buffers.wind_loop) {
        this.windStarted = true;
        const buf = this.buffers.wind_loop;
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        if (buf.duration > 0.25) {
          src.loopStart = 0.06;
          src.loopEnd = buf.duration - 0.06;
        }
        this.windFilter = this.ctx.createBiquadFilter();
        this.windFilter.type = "lowpass";
        this.windFilter.frequency.value = 920;

        this.windGain = this.ctx.createGain();
        this.windGain.gain.value = 0.0;

        src.connect(this.windFilter);
        this.windFilter.connect(this.windGain);
        this.windGain.connect(this.dryBus);
        this.windGain.connect(this.reverbBus);
        src.start(0, 0.06);
      }

      // 2. Real Tall Grass / Field Crop Rustling Loop (strictly 0.000 gain outside Hemp/Corn rows!)
      if (!this.cropStarted && this.buffers.crop_loop) {
        this.cropStarted = true;
        const buf = this.buffers.crop_loop;

        const makeCropLoopSrc = (offset, rate) => {
          const s = this.ctx.createBufferSource();
          s.buffer = buf;
          s.loop = true;
          s.playbackRate.value = rate;
          if (buf.duration > 0.2) {
            s.loopStart = 0.04;
            s.loopEnd = buf.duration - 0.04;
          }
          s.start(0, Math.min(buf.duration * 0.5, offset));
          return s;
        };

        const srcL = makeCropLoopSrc(0.08, 0.96);
        const srcR = makeCropLoopSrc(0.95, 1.05);

        this.cropGainL = this.ctx.createGain();
        this.cropGainR = this.ctx.createGain();
        this.cropGainL.gain.value = 0.0;
        this.cropGainR.gain.value = 0.0;

        const stageL = this._create8DBinauralStage(-72, 1.0);
        const stageR = this._create8DBinauralStage(72, 1.0);

        srcL.connect(this.cropGainL);
        this.cropGainL.connect(stageL.input);
        stageL.output.connect(this.dryBus);

        srcR.connect(this.cropGainR);
        this.cropGainR.connect(stageR.input);
        stageR.output.connect(this.dryBus);
      }

      // 3. Real Continuous Phase-Locked Forest & Road Running Loops (zero choppy stutters or noise-gate cutouts!)
      if (!this.runStarted && this.buffers.run_forest_loop && this.buffers.run_road_loop) {
        this.runStarted = true;
        const loopPts = window.HorrorSfxLoopPoints || {};

        const makeRunLoop = (key, defaultEnd) => {
          const buf = this.buffers[key];
          const s = this.ctx.createBufferSource();
          s.buffer = buf;
          s.loop = true;
          const pts = loopPts[key];
          if (pts && pts[1] <= buf.duration) {
            s.loopStart = pts[0];
            s.loopEnd = pts[1];
          } else if (buf.duration > 0.3) {
            s.loopStart = 0.12;
            s.loopEnd = Math.min(buf.duration - 0.08, defaultEnd);
          }
          s.start(0, s.loopStart || 0.12);
          return s;
        };

        this.runForestSrc = makeRunLoop("run_forest_loop", 5.48);
        this.runForestFilter = this.ctx.createBiquadFilter();
        this.runForestFilter.type = "lowpass";
        this.runForestFilter.frequency.value = 3000;
        this.runForestGain = this.ctx.createGain();
        this.runForestGain.gain.value = 0.0;

        this.runForestSrc.connect(this.runForestFilter);
        this.runForestFilter.connect(this.runForestGain);
        this.runForestGain.connect(this.dryBus);

        this.runRoadSrc = makeRunLoop("run_road_loop", 5.08);
        this.runRoadGain = this.ctx.createGain();
        this.runRoadGain.gain.value = 0.0;

        this.runRoadSrc.connect(this.runRoadGain);
        this.runRoadGain.connect(this.dryBus);
      }
    }

    setTabHidden(hidden) {
      this.mutedByTab = hidden;
      if (!this.ctx) return;
      if (hidden) this.ctx.suspend().catch(() => {});
      else this.ctx.resume().catch(() => {});
    }

    _buildForestImpulse(seconds) {
      const sr = this.ctx.sampleRate;
      const len = Math.floor(sr * seconds);
      const buf = this.ctx.createBuffer(2, len, sr);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        let lp = 0;
        for (let i = 0; i < len; i++) {
          const t = i / sr;
          const early =
            (Math.abs(t - 0.046 - ch * 0.007) < 0.003 ? 0.44 : 0) +
            (Math.abs(t - 0.112 + ch * 0.006) < 0.004 ? 0.28 : 0);
          const env = Math.exp(-t * 3.1) * 0.40 + early;
          const white = Math.random() * 2 - 1;
          lp = lp * 0.82 + white * 0.18;
          d[i] = lp * env;
        }
      }
      return buf;
    }

    // Psychoacoustic 8D Dual-Ear Binaural Stage (ITD + Head-Shadow ILD + Rear Pinna Notch)
    _create8DBinauralStage(azimuthDeg, distAtten = 1.0) {
      const input = this.ctx.createGain();
      input.gain.value = distAtten;

      const pinnaNotch = this.ctx.createBiquadFilter();
      pinnaNotch.type = "peaking";
      pinnaNotch.frequency.value = 7000;
      pinnaNotch.Q.value = 2.4;

      const rearBodyBoost = this.ctx.createBiquadFilter();
      rearBodyBoost.type = "peaking";
      rearBodyBoost.frequency.value = 900;
      rearBodyBoost.Q.value = 1.3;

      const delayL = this.ctx.createDelay(0.01);
      const delayR = this.ctx.createDelay(0.01);
      const lpL = this.ctx.createBiquadFilter(); lpL.type = "lowpass";
      const lpR = this.ctx.createBiquadFilter(); lpR.type = "lowpass";
      const gainL = this.ctx.createGain();
      const gainR = this.ctx.createGain();
      const merger = this.ctx.createChannelMerger(2);

      input.connect(pinnaNotch);
      pinnaNotch.connect(rearBodyBoost);

      rearBodyBoost.connect(delayL); delayL.connect(lpL); lpL.connect(gainL); gainL.connect(merger, 0, 0);
      rearBodyBoost.connect(delayR); delayR.connect(lpR); lpR.connect(gainR); gainR.connect(merger, 0, 1);

      const setAngle = (deg, t = this.ctx.currentTime) => {
        const rad = (deg * Math.PI) / 180.0;
        const sinA = Math.sin(rad);
        const cosA = Math.cos(rad);

        const rearFactor = Math.max(0, -cosA);
        pinnaNotch.gain.setValueAtTime(-10.5 * rearFactor, t);
        rearBodyBoost.gain.setValueAtTime(3.2 * rearFactor, t);

        const itd = Math.abs(sinA) * 0.00064;
        delayL.delayTime.setValueAtTime(sinA > 0 ? itd : 0.00002, t);
        delayR.delayTime.setValueAtTime(sinA < 0 ? itd : 0.00002, t);

        const shadowL = Math.max(0, sinA);
        const shadowR = Math.max(0, -sinA);

        lpL.frequency.setValueAtTime(16000 - shadowL * 13800, t);
        lpR.frequency.setValueAtTime(16000 - shadowR * 13800, t);

        gainL.gain.setValueAtTime(1.0 - shadowL * 0.74, t);
        gainR.gain.setValueAtTime(1.0 - shadowR * 0.74, t);
      };

      setAngle(azimuthDeg);
      return { input, output: merger, setAngle };
    }

    _playSample8D(key, azDeg, vol = 1.0, rate = 1.0, useReverb = true, startDelay = 0, lpFreq = 0) {
      if (!this.unlocked || this.mutedByTab || !this.buffers[key]) return;
      const now = this.ctx.currentTime + startDelay;
      const stage = this._create8DBinauralStage(azDeg, vol);
      stage.output.connect(this.dryBus);
      if (useReverb) stage.output.connect(this.reverbBus);

      const src = this.ctx.createBufferSource();
      src.buffer = this.buffers[key];
      src.playbackRate.setValueAtTime(rate, now);

      if (lpFreq > 0) {
        const lp = this.ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.setValueAtTime(lpFreq, now);
        src.connect(lp);
        lp.connect(stage.input);
      } else {
        src.connect(stage.input);
      }
      src.start(now);
      return { src, stage };
    }

    // === FIELD-ONLY CROP RUSTLING (Works when running STRAIGHT FORWARD through stalks AND left/right; ZERO outside fields!) ===
    updateCropRustling(dt, cropInfo, forwardSpeed, strafeSpeed) {
      if (!this.unlocked || this.mutedByTab) return;
      this._startRealLoopsIfNeeded();
      if (!this.cropGainL || !this.cropGainR) return;

      const now = this.ctx.currentTime;
      this.cropHitCooldown = Math.max(0, this.cropHitCooldown - dt);

      const contact = cropInfo ? cropInfo.contact : 0;
      const totalSpeed = Math.hypot(forwardSpeed || 0, strafeSpeed || 0);

      // Strictly ZERO rustling outside Hemp/Corn fields, on road, in open aisles between rows, or when stopped!
      if (!cropInfo || contact <= 0.02 || totalSpeed < 0.4) {
        this.cropGainL.gain.setTargetAtTime(0.0, now, 0.045);
        this.cropGainR.gain.setTargetAtTime(0.0, now, 0.045);
        this.prevStalkCellZ = cropInfo ? cropInfo.stalkCellZ : null;
        this.prevRowK = cropInfo ? cropInfo.rowK : null;
        return;
      }

      // Continuous real foliage friction proportional to BOTH physical stalk contact AND forward/lateral running speed!
      const moveFactor = Math.min(1.35, totalSpeed / 8.2);
      const baseVol = Math.min(0.58, contact * moveFactor * 0.48);

      // Subtle directional balance toward whichever side of your shoulders the crop row is brushing
      const rowSide = cropInfo.rowSide || 0; // -1 if row is on right of player, +1 if on left
      const leftBias = contact > 0.78 ? 1.0 : (rowSide < 0 ? 0.65 : 1.15);
      const rightBias = contact > 0.78 ? 1.0 : (rowSide > 0 ? 0.65 : 1.15);

      this.cropGainL.gain.setTargetAtTime(baseVol * leftBias, now, 0.04);
      this.cropGainR.gain.setTargetAtTime(baseVol * rightBias, now, 0.04);

      // Crisp per-stalk brush hits BOTH when running straight forward through stalks (stalkCellZ changes every 1.25m!)
      // AND when strafing across a planted row!
      const crossedForwardStalk =
        this.prevStalkCellZ !== null &&
        cropInfo.stalkCellZ !== this.prevStalkCellZ &&
        contact > 0.22 &&
        forwardSpeed > 1.5;

      const crossedLateralRow =
        this.prevRowK !== null &&
        cropInfo.rowK !== this.prevRowK &&
        Math.abs(strafeSpeed) > 1.2;

      if ((crossedForwardStalk || crossedLateralRow) && this.cropHitCooldown <= 0) {
        this.cropHitCooldown = 0.115; // Natural sprinting stalk-whip cadence (~8 stalks/sec max)
        this.cropShoulderToggle = -this.cropShoulderToggle;
        const az = crossedLateralRow
          ? (strafeSpeed > 0 ? 68 : -68)
          : (contact > 0.72 ? this.cropShoulderToggle * 54 : -rowSide * 62);
        const hitKey = "crop_hit_" + (1 + Math.floor(Math.random() * 3));
        const hitVol = Math.min(0.65, (0.26 + contact * 0.36) * moveFactor);
        const rate = (cropInfo.kind === "hemp" ? 0.94 : 1.06) + (Math.random() - 0.5) * 0.12;
        this._playSample8D(hitKey, az, hitVol, rate, false);
      }

      this.prevStalkCellZ = cropInfo.stalkCellZ;
      this.prevRowK = cropInfo.rowK;
    }

    // === REAL BINAURAL DOOR KNOCK (3 Stereo Fragments Sliced Directly from https://www.youtube.com/watch?v=H5Cjttt_J-Q) ===
    playBinauralDoorKnock() {
      if (!this.unlocked || this.mutedByTab) return;
      const keys = ["knock_1", "knock_2", "knock_3"].filter((k) => !!this.buffers[k]);
      if (!keys.length) return;

      const key = keys[this._knockIdx % keys.length];
      this._knockIdx++;
      const buf = this.buffers[key];
      const now = this.ctx.currentTime;

      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.setValueAtTime(0.98 + Math.random() * 0.04, now);

      // Punchy wooden door body resonance + crisp knuckle transient so the knock cuts through running & wind LOUD and clear!
      const woodBody = this.ctx.createBiquadFilter();
      woodBody.type = "peaking";
      woodBody.frequency.setValueAtTime(185, now);
      woodBody.Q.setValueAtTime(1.15, now);
      woodBody.gain.setValueAtTime(6.0, now);

      const knuckleCrisp = this.ctx.createBiquadFilter();
      knuckleCrisp.type = "peaking";
      knuckleCrisp.frequency.setValueAtTime(2100, now);
      knuckleCrisp.Q.setValueAtTime(1.25, now);
      knuckleCrisp.gain.setValueAtTime(4.8, now);

      const knockLim = this.ctx.createDynamicsCompressor();
      knockLim.threshold.setValueAtTime(-2.5, now);
      knockLim.knee.setValueAtTime(4.0, now);
      knockLim.ratio.setValueAtTime(12.0, now);
      knockLim.attack.setValueAtTime(0.001, now);
      knockLim.release.setValueAtTime(0.09, now);

      const outGain = this.ctx.createGain();
      outGain.gain.setValueAtTime(3.15, now);
      outGain.connect(woodBody);
      woodBody.connect(knuckleCrisp);
      knuckleCrisp.connect(knockLim);
      knockLim.connect(this.ctx.destination);

      // Preserve 100% untouched dummy-head binaural stereo HRTF from H5Cjttt_J-Q!
      // Randomly mirror L<->R channels so sometimes someone knocks on the door to your right, sometimes to your left!
      if (buf.numberOfChannels >= 2 && Math.random() < 0.45) {
        const split = this.ctx.createChannelSplitter(2);
        const merge = this.ctx.createChannelMerger(2);
        src.connect(split);
        split.connect(merge, 0, 1);
        split.connect(merge, 1, 0);
        merge.connect(outGain);
      } else {
        src.connect(outGain);
      }
      src.start(now);
    }

    // === CUTSCENE & GAMEPLAY CUES ===
    playIntroBehindSound() {
      if (!this.unlocked || this.mutedByTab) return;
      // Sharp real dry branch snap right behind neck (176 deg)
      this._playSample8D("twig_1", 176, 0.95, 1.0, true, 0.0);
      this._playSample8D("breath_1", -172, 0.42, 0.78, true, 0.14, 1600);
    }

    playFlashlightDropAndCamSwitch() {
      if (!this.unlocked || this.mutedByTab) return;
      const now = this.ctx.currentTime;
      // Real thud of dropped flashlight hitting dirt ahead-right
      this._playSample8D("step_dirt_1", 32, 0.68, 1.25, true, 0.02);

      // Authentic Sony Handycam NightShot mechanical IR-cut relay click
      for (const [dt, f] of [[0.09, 2050], [0.128, 2750]]) {
        const c = this.ctx.createOscillator();
        c.type = "sine";
        c.frequency.setValueAtTime(f, now + dt);
        const cg = this.ctx.createGain();
        cg.gain.setValueAtTime(0.13, now + dt);
        cg.gain.exponentialRampToValueAtTime(0.001, now + dt + 0.022);
        c.connect(cg);
        cg.connect(this.dryBus);
        c.start(now + dt);
        c.stop(now + dt + 0.026);
      }
    }

    playNeckTwistCreak() {
      if (!this.unlocked || this.mutedByTab) return;
      // Subtle eerie bone/tendon creak as the monster slowly twists its head upside-down!
      this._playSample8D("twig_2", 0, 0.34, 0.48, true, 0.0, 950);
      this._playSample8D("whisper", 0, 0.22, 0.65, true, 0.08, 1200);
    }

    playNightVisionCutToggle(turningOn) {
      if (!this.unlocked || this.mutedByTab) return;
      const now = this.ctx.currentTime;
      const freqs = turningOn ? [1420, 2680] : [2150, 960];
      for (let i = 0; i < freqs.length; i++) {
        const dt = i * 0.028;
        const osc = this.ctx.createOscillator();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(freqs[i], now + dt);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.085, now + dt);
        g.gain.exponentialRampToValueAtTime(0.001, now + dt + 0.024);
        osc.connect(g);
        g.connect(this.dryBus);
        osc.start(now + dt);
        osc.stop(now + dt + 0.028);
      }
    }

    playFaceGlitchSubliminal(intense = false) {
      if (!this.unlocked || this.mutedByTab) return;
      const now = this.ctx.currentTime;
      if (intense) {
        const sub = this.ctx.createOscillator();
        sub.type = "sine";
        sub.frequency.setValueAtTime(64, now);
        sub.frequency.exponentialRampToValueAtTime(26, now + 0.28);
        const sg = this.ctx.createGain();
        sg.gain.setValueAtTime(0.38, now);
        sg.gain.exponentialRampToValueAtTime(0.001, now + 0.30);
        sub.connect(sg);
        sg.connect(this.dryBus);
        sub.start(now);
        sub.stop(now + 0.32);
        this._playSample8D("whisper", (Math.random() - 0.5) * 90, 0.44, 0.72, true, 0, 1750);
      } else {
        this._playSample8D("whisper", (Math.random() - 0.5) * 60, 0.16, 0.80, true, 0, 1300);
      }
    }

    playCrash() {
      if (!this.unlocked || this.mutedByTab) return;
      this.updateRunningLoop(false);
      // Heavy real physical impact against tree trunk/obstacle + realistic forest body collapse onto dirt & leaves!
      this._playSample8D("crash_impact", 0, 1.05, 0.95, true, 0.0);
      this._playSample8D("twig_2", 18, 0.52, 0.88, false, 0.03);
      this._playSample8D("body_fall", 12, 0.92, 0.96, true, 0.18);
    }

    playDeathApproachStep(sideSign) {
      if (!this.unlocked || this.mutedByTab) return;
      const stepKey = Math.random() < 0.5 ? "step_dirt_1" : "step_dirt_2";
      this._playSample8D(stepKey, sideSign * 84, 0.72, 0.82 + Math.random() * 0.06, true, 0.0, 2600);
    }

    playDeathMonsterFinalSting() {
      if (!this.unlocked || this.mutedByTab) return;
      const now = this.ctx.currentTime;
      // Deep suffocating sub-bass dread pulse + eerie dark breath right beside the fallen player
      const sub = this.ctx.createOscillator();
      sub.type = "sine";
      sub.frequency.setValueAtTime(78, now);
      sub.frequency.exponentialRampToValueAtTime(25, now + 0.65);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.68, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.68);
      sub.connect(g);
      g.connect(this.dryBus);
      sub.start(now);
      sub.stop(now + 0.70);

      this._playSample8D("whisper", 0, 0.34, 0.72, true, 0.02, 1350);
    }

    play8DChasingStepsBehind() {
      if (!this.unlocked || this.mutedByTab) return;
      const side = Math.random() < 0.5 ? -1 : 1;
      const dirtKeys = ["step_dirt_1", "step_dirt_2", "step_dirt_3", "step_dirt_4"];
      for (let s = 0; s < 5; s++) {
        const key = dirtKeys[s % dirtKeys.length];
        const az = side * (166 - s * 13);
        const vol = 0.45 + s * 0.09;
        this._playSample8D(key, az, vol, 1.04 + (Math.random() - 0.5) * 0.08, true, s * 0.165);
      }
    }

    play8DBehindTwigOrWhisper() {
      if (!this.unlocked || this.mutedByTab) return;
      const az = (Math.random() < 0.5 ? -1 : 1) * (112 + Math.random() * 48);
      if (Math.random() < 0.58) {
        const k = Math.random() < 0.5 ? "twig_1" : "twig_2";
        this._playSample8D(k, az, 0.75, 0.94 + Math.random() * 0.14, true);
      } else {
        this._playSample8D("whisper", az, 0.56, 0.94 + Math.random() * 0.10, true);
      }
    }

    playWorldHorrorEvent(kind, relX, relZ) {
      if (!this.unlocked || this.mutedByTab) return;
      const valid = (
        kind === "stalker_vanish" || kind === "shadow_vanish" ||
        kind === "crows" || kind === "clock_bell" ||
        kind === "trance_snap" || kind === "infected_weep" ||
        kind === "infected_reveal"
      );
      if (!valid) return;

      const nowT = this.ctx.currentTime;
      // Prevent routine monster reaction sounds from spamming in dense 17-monster tiles!
      if (kind === "trance_snap" || kind === "infected_weep" || kind === "infected_reveal") {
        if (this._lastRoutineEnemySfxAt && nowT - this._lastRoutineEnemySfxAt < 8.5) return;
        this._lastRoutineEnemySfxAt = nowT;
      } else if (kind === "shadow_vanish" || kind === "stalker_vanish") {
        if (this._lastVanishSfxAt && nowT - this._lastVanishSfxAt < 14.0) return;
        this._lastVanishSfxAt = nowT;
      }

      const azDeg = (Math.atan2(relX, -relZ) * 180) / Math.PI;
      const dist = Math.max(1.8, Math.hypot(relX, relZ));
      const atten = Math.min(1.0, 8.2 / dist);

      if (kind === "stalker_vanish" || kind === "shadow_vanish") {
        const now = this.ctx.currentTime;
        const sub = this.ctx.createOscillator();
        sub.type = "sine";
        sub.frequency.setValueAtTime(74, now);
        sub.frequency.exponentialRampToValueAtTime(24, now + 0.48);
        const sg = this.ctx.createGain();
        sg.gain.setValueAtTime(0.60, now);
        sg.gain.exponentialRampToValueAtTime(0.001, now + 0.50);
        sub.connect(sg);
        sg.connect(this.dryBus);
        sub.start(now);
        sub.stop(now + 0.52);
        this._playSample8D("whisper", azDeg, Math.max(0.32, atten * 0.56), 0.78, true);
      } else if (kind === "crows") {
        this._playSample8D("crows", azDeg, Math.max(0.35, atten * 0.85), 0.96 + Math.random() * 0.08, true);
      } else if (kind === "clock_bell") {
        this._playSample8D("clock_bell", azDeg, Math.max(0.32, atten * 0.88), 0.98, true);
      } else if (kind === "trance_snap") {
        // #1 «Ведомый»: eerie hollow exhale + heavy shuffling step as it snaps its head toward you
        this._playSample8D("breath_2", azDeg, Math.max(0.28, atten * 0.62), 0.76, true, 0, 1450);
        this._playSample8D("step_dirt_2", azDeg, Math.max(0.25, atten * 0.52), 0.88, true, 0.08, 1800);
      } else if (kind === "infected_weep") {
        // #2 «Заражённый улыбкой» bait: quiet trembling roadside whisper/sob behind hands
        this._playSample8D("whisper", azDeg, Math.max(0.24, atten * 0.52), 1.12, true, 0, 1500);
        this._playSample8D("breath_1", azDeg, Math.max(0.20, atten * 0.42), 1.18, true, 0.14, 1400);
      } else if (kind === "infected_reveal") {
        // #2 «Заражённый улыбкой» reveal & lunge: sharp rasping gasp + low dread sting as hands drop off the grin!
        const now = this.ctx.currentTime;
        const sub = this.ctx.createOscillator();
        sub.type = "sine";
        sub.frequency.setValueAtTime(86, now);
        sub.frequency.exponentialRampToValueAtTime(31, now + 0.36);
        const sg = this.ctx.createGain();
        sg.gain.setValueAtTime(0.48, now);
        sg.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
        sub.connect(sg);
        sg.connect(this.dryBus);
        sub.start(now);
        sub.stop(now + 0.40);
        this._playSample8D("breath_1", azDeg, Math.max(0.42, atten * 0.85), 1.36, true, 0, 2600);
        this._playSample8D("whisper", azDeg, Math.max(0.34, atten * 0.68), 0.72, true, 0.04, 2100);
      } else if (kind === "effigy_snap") {
        // #5 «Чучело-перевёртыш»: violent dry crack of snapping branches & dry wooden joints!
        this._playSample8D("twig_1", azDeg, Math.max(0.46, atten * 0.88), 0.90 + Math.random() * 0.10, true);
        this._playSample8D("twig_2", azDeg, Math.max(0.42, atten * 0.80), 0.78 + Math.random() * 0.08, true, 0.07);
        this._playSample8D("crop_hit_2", azDeg, Math.max(0.26, atten * 0.50), 0.86, false, 0.05, 1900);
      }
    }

    playThunder() {
      if (!this.unlocked || this.mutedByTab) return;
      const az = (Math.random() - 0.5) * 130;
      this._playSample8D("thunder", az, 0.78, 0.92 + Math.random() * 0.12, true);
    }

    updateRunningLoop(isRunning, onRoad = false, inSwamp = false, speedNorm = 0.0) {
      if (!this.unlocked || this.mutedByTab) return;
      this._startRealLoopsIfNeeded();
      if (!this.runForestGain || !this.runRoadGain) return;

      const now = this.ctx.currentTime;
      if (!isRunning) {
        this.runForestGain.gain.setTargetAtTime(0.0, now, 0.045);
        this.runRoadGain.gain.setTargetAtTime(0.0, now, 0.045);
        return;
      }

      const clampedSpeed = Math.max(0, Math.min(1.2, speedNorm));
      const baseRate = 0.96 + clampedSpeed * 0.13;

      if (this.runForestSrc) {
        const forestRate = inSwamp ? baseRate * 0.91 : baseRate;
        this.runForestSrc.playbackRate.setTargetAtTime(forestRate, now, 0.12);
      }
      if (this.runRoadSrc) {
        this.runRoadSrc.playbackRate.setTargetAtTime(baseRate * 1.02, now, 0.12);
      }
      if (this.runForestFilter) {
        this.runForestFilter.frequency.setTargetAtTime(inSwamp ? 1350 : 3000, now, 0.10);
      }

      const targetForest = onRoad ? 0.05 : (inSwamp ? 0.46 : 0.42);
      const targetRoad = onRoad ? 0.39 : 0.0;
      this.runForestGain.gain.setTargetAtTime(targetForest, now, 0.09);
      this.runRoadGain.gain.setTargetAtTime(targetRoad, now, 0.09);
    }

    // Used only for the slow single calm walk steps in the opening 0..0.55s before stopping
    playFootstep(onRoad = false, inSwamp = false, isCalmWalk = true) {
      if (!this.unlocked || this.mutedByTab) return;
      if (!isCalmWalk) return;
      this.stepSide = -this.stepSide;
      this.stepIdx++;

      const az = this.stepSide * 16;
      const dirtKey = "step_dirt_" + (1 + (this.stepIdx % 4));
      const rate = (onRoad ? 1.08 : inSwamp ? 0.84 : 0.94) + (Math.random() - 0.5) * 0.08;
      this._playSample8D(dirtKey, az, 0.34, rate, true, 0, onRoad ? 2800 : 2200);
    }

    playNearMiss(panVal) {
      if (!this.unlocked || this.mutedByTab) return;
      this._playSample8D("crop_hit_1", panVal * 80, 0.24, 0.68, false, 0, 950);
    }

    playGraze(panVal) {
      if (!this.unlocked || this.mutedByTab) return;
      this._playSample8D("crash_impact", panVal * 78, 0.52, 1.22, true, 0, 2200);
      this._playSample8D("twig_2", panVal * 78, 0.40, 1.08, false, 0.02);
    }

    // Heavy *Into the Dead* monster shoulder-clip stumble (`частично врезались — споткнулись как в оригинале`!)
    playMonsterStumble(panVal) {
      if (!this.unlocked || this.mutedByTab) return;
      const az = Math.max(-90, Math.min(90, panVal * 82));
      this._playSample8D("crash_impact", az, 0.68, 1.08, true, 0.0, 2400);
      this._playSample8D("breath_1", 0, 0.64, 1.18, true, 0.03, 2800);
      this._playSample8D("step_dirt_1", -18, 0.54, 1.25, true, 0.08, 2500);
      this._playSample8D("step_dirt_2",  18, 0.52, 1.22, true, 0.19, 2500);
    }

    // Clean, non-spammy 8D Binaural Close-Ear Scare (`5.2s` cooldown, NO black-monster sub-bass boom!)
    playMonsterClosePass(panVal, kind) {
      if (!this.unlocked || this.mutedByTab) return;
      const now = this.ctx.currentTime;
      if (this._lastClosePassAt && now - this._lastClosePassAt < 5.2) return;
      this._lastClosePassAt = now;

      const az = Math.max(-95, Math.min(95, panVal * 88));

      if (kind === "contorted_strider") {
        // Towering strider: dry bone-claw click & low rasp right past your ear
        this._playSample8D("twig_1", az, 0.38, 0.78 + Math.random() * 0.10, true, 0, 2200);
        this._playSample8D("breath_2", az, 0.36, 0.62, true, 0.02, 1800);
      } else if (kind === "smiling_infected") {
        // Sharp gasp & cloth swipe right past headphone
        this._playSample8D("breath_1", az, 0.40, 1.32 + Math.random() * 0.10, true, 0, 2600);
        this._playSample8D("crop_hit_1", az, 0.28, 0.85, false, 0.02, 1600);
      } else {
        // Choked husk breath & reaching sleeve rustle
        this._playSample8D("breath_2", az, 0.38, 0.68 + Math.random() * 0.08, true, 0, 1900);
        this._playSample8D("crop_hit_2", az, 0.26, 0.78, false, 0.02, 1400);
      }
    }

    // 5000m Finale: Stumbling last exhausted steps & ragged gasps when stopping in the field before the burning wreck
    playEndingStopStepsAndPant() {
      if (!this.unlocked || this.mutedByTab) return;
      this._playSample8D("step_dirt_1", -14, 0.44, 0.92, true, 0.12, 2100);
      this._playSample8D("step_dirt_2",  14, 0.36, 0.84, true, 0.56, 1900);
      this._playSample8D("breath_1", 0, 0.54, 1.08, false, 0.25, 2500);
      this._playSample8D("breath_2", 0, 0.48, 0.96, false, 1.18, 2200);
      this._playHeartbeat(0.65);
    }

    // 5000m Finale: Broken defeated exhale + slow sleeve rustle as the survivor begins slowly lowering the camcorder
    playEndingCamLowerStart() {
      if (!this.unlocked || this.mutedByTab) return;
      // Heavy defeated trembling sigh ("вот и всё, конец...")
      this._playSample8D("breath_2", 0, 0.58, 0.76, false, 0.05, 1850);
      this._playSample8D("crop_hit_2", 14, 0.24, 0.62, false, 0.35, 1050);
      this._playHeartbeat(0.55);
    }

    // Exact frame-synced NightShot click-off right inside the slow despair eye-close!
    playEndingCamPowerOff() {
      if (!this.unlocked || this.mutedByTab) return;
      this.playNightVisionCutToggle(false);
    }

    // 5000m Finale Beat B: Silent crowd of Main Monsters revealed across near, mid & far distances on blink!
    playEndingHordeAppear() {
      if (!this.unlocked || this.mutedByTab) return;
      const now = this.ctx.currentTime;
      const sub = this.ctx.createOscillator();
      sub.type = "sine";
      sub.frequency.setValueAtTime(58, now);
      sub.frequency.exponentialRampToValueAtTime(23, now + 1.05);
      const sg = this.ctx.createGain();
      sg.gain.setValueAtTime(0.001, now);
      sg.gain.linearRampToValueAtTime(0.50, now + 0.10);
      sg.gain.exponentialRampToValueAtTime(0.001, now + 1.10);
      sub.connect(sg);
      sg.connect(this.dryBus);
      sub.start(now);
      sub.stop(now + 1.14);

      this._playSample8D("whisper", -48, 0.38, 0.72, true, 0.04, 1550);
      this._playSample8D("whisper",  48, 0.36, 0.66, true, 0.12, 1500);
      // Sharp terrified catch of breath + pounding heartbeat
      this._playSample8D("breath_1", 0, 0.58, 1.16, false, 0.18, 2600);
      this._playSample8D("step_dirt_3", 0, 0.30, 0.82, true, 0.45, 1750); // Involuntary half-step back
      this._playHeartbeat(0.82);
    }

    playEndingDisbeliefHeartbeat(stress = 0.78) {
      if (!this.unlocked || this.mutedByTab) return;
      this._playHeartbeat(stress);
      this._playSample8D("breath_2", 0, 0.34, 0.94, false, 0.12, 2100);
    }

    // 5000m Finale Beat C: LOUD, VIOLENT HORROR ENTITY RUSH / JUMPSCARE SHRIEK + BONE-CRACKING BLITZ!
    playEndingHordeCharge() {
      if (!this.unlocked || this.mutedByTab) return;
      const now = this.ctx.currentTime;

      // 1. Massive chest-punching sub-bass shock slam (`135 Hz -> 22 Hz`)
      const sub = this.ctx.createOscillator();
      sub.type = "sine";
      sub.frequency.setValueAtTime(135, now);
      sub.frequency.exponentialRampToValueAtTime(22, now + 0.72);
      const sg = this.ctx.createGain();
      sg.gain.setValueAtTime(1.15, now);
      sg.gain.exponentialRampToValueAtTime(0.001, now + 0.76);
      sub.connect(sg);
      sg.connect(this.dryBus);
      sub.start(now);
      sub.stop(now + 0.78);

      // 2. Loud Broadband Horror Bowed-Metal / Screaming Entity Blast (wide peaking EQ instead of narrow choke!)
      const shaper = this.ctx.createWaveShaper();
      const curve = new Float32Array(256);
      for (let i = 0; i < 256; i++) {
        const x = (i / 127.5) - 1.0;
        curve[i] = Math.tanh(x * 6.5);
      }
      shaper.curve = curve;

      const stingPeak = this.ctx.createBiquadFilter();
      stingPeak.type = "peaking";
      stingPeak.frequency.setValueAtTime(1900, now);
      stingPeak.frequency.exponentialRampToValueAtTime(3200, now + 0.08);
      stingPeak.frequency.exponentialRampToValueAtTime(720, now + 0.75);
      stingPeak.Q.setValueAtTime(1.1, now);
      stingPeak.gain.setValueAtTime(7.5, now);

      const stingHp = this.ctx.createBiquadFilter();
      stingHp.type = "highpass";
      stingHp.frequency.setValueAtTime(180, now);

      const stingGain = this.ctx.createGain();
      stingGain.gain.setValueAtTime(0.001, now);
      stingGain.gain.linearRampToValueAtTime(0.92, now + 0.006);
      stingGain.gain.setValueAtTime(0.84, now + 0.16);
      stingGain.gain.exponentialRampToValueAtTime(0.001, now + 0.78);

      const stingPartials = [
        ["sawtooth",  340,  710, 210],
        ["sawtooth",  518, 1080, 295],
        ["sawtooth", 1420, 2980, 490],
        ["square",   1515, 3190, 455],
        ["sawtooth", 2140, 3820, 680]
      ];
      for (const [type, f0, fPeak, fEnd] of stingPartials) {
        const o = this.ctx.createOscillator();
        o.type = type;
        o.frequency.setValueAtTime(f0, now);
        o.frequency.exponentialRampToValueAtTime(fPeak, now + 0.055);
        o.frequency.exponentialRampToValueAtTime(fEnd, now + 0.74);
        const og = this.ctx.createGain();
        og.gain.setValueAtTime(0.38, now);
        o.connect(og);
        og.connect(shaper);
        o.start(now);
        o.stop(now + 0.79);
      }
      shaper.connect(stingHp);
      stingHp.connect(stingPeak);
      stingPeak.connect(stingGain);
      stingGain.connect(this.dryBus);
      stingGain.connect(this.reverbBus);

      // 3. Aggressive Strobe/Shutter Air-Rip Rush (`36 Hz` rapid chop matching unnatural broken-body lunges!)
      const whooshLen = Math.floor(this.ctx.sampleRate * 0.86);
      const whooshBuf = this.ctx.createBuffer(1, whooshLen, this.ctx.sampleRate);
      const wd = whooshBuf.getChannelData(0);
      for (let i = 0; i < whooshLen; i++) {
        const tSec = i / this.ctx.sampleRate;
        const shutter = (Math.sin(tSec * Math.PI * 2 * 36.0) > -0.15) ? 1.0 : 0.08;
        wd[i] = (Math.random() * 2 - 1) * shutter;
      }
      const wSrc = this.ctx.createBufferSource();
      wSrc.buffer = whooshBuf;
      const wFilter = this.ctx.createBiquadFilter();
      wFilter.type = "bandpass";
      wFilter.frequency.setValueAtTime(520, now);
      wFilter.frequency.exponentialRampToValueAtTime(4200, now + 0.36);
      wFilter.frequency.exponentialRampToValueAtTime(920, now + 0.84);
      wFilter.Q.setValueAtTime(1.15, now);
      const wGain = this.ctx.createGain();
      wGain.gain.setValueAtTime(0.01, now);
      wGain.gain.linearRampToValueAtTime(0.95, now + 0.04);
      wGain.gain.linearRampToValueAtTime(1.05, now + 0.48);
      wGain.gain.exponentialRampToValueAtTime(0.001, now + 0.85);
      wSrc.connect(wFilter);
      wFilter.connect(wGain);
      wGain.connect(this.dryBus);
      wSrc.start(now);

      // 4. Deafening frantic skittering stampede & violent bone-cracking snaps closing in!
      const dirtKeys = ["step_dirt_1", "step_dirt_2", "step_dirt_3", "step_dirt_4"];
      const angles = [-72, 68, -54, 50, -38, 35, -24, 22, -14, 13, -8, 7, -4, 3, -1, 0];
      for (let i = 0; i < angles.length; i++) {
        const k = dirtKeys[i % dirtKeys.length];
        const vol = 0.72 + i * 0.045;
        this._playSample8D(k, angles[i], vol, 1.56 + (i % 3) * 0.12, true, i * 0.032, 3600);
      }
      this._playSample8D("twig_1", -38, 0.92, 1.48, true, 0.01, 3800);
      this._playSample8D("twig_2",  36, 0.92, 1.55, true, 0.06, 3800);
      this._playSample8D("twig_1", -16, 0.95, 1.62, true, 0.15, 3800);
      this._playSample8D("twig_2",  14, 0.95, 1.38, true, 0.24, 3800);
      this._playSample8D("breath_1", 0, 0.95, 1.38, false, 0.01, 3200);
      this._playSample8D("breath_2", -12, 0.88, 0.54, true, 0.04, 2400);
      this._playSample8D("breath_2",  12, 0.88, 0.50, true, 0.12, 2400);
    }

    // 5000m Finale Beat D: Jolting awake in bed, gasping/panting from fear, then quickly calming down!
    playWakeUpGaspAndCalm() {
      if (!this.unlocked || this.mutedByTab) return;
      const now = this.ctx.currentTime;
      if (this.windGain) this.windGain.gain.setTargetAtTime(0.0, now, 0.02);
      if (this.subDroneGain) this.subDroneGain.gain.setValueAtTime(0.0, now);
      this.updateRunningLoop(false);
      this.updateCropRustling(0.016, null, 0, 0);

      this._playSample8D("crop_hit_2", 0, 0.34, 0.72, false, 0.0, 900);
      this._playSample8D("breath_1", 0, 0.76, 1.22, false, 0.02, 2900);
      this._playSample8D("breath_2", 0, 0.58, 1.12, false, 0.54, 2600);
      this._playSample8D("breath_1", 0, 0.36, 0.98, false, 1.16, 2200);
      this._playSample8D("breath_2", 0, 0.20, 0.86, false, 1.92, 1800);

      this._playHeartbeat(0.85);
      setTimeout(() => {
        if (this.unlocked && !this.mutedByTab) this._playHeartbeat(0.45);
      }, 480);
    }

    // Soft pillow & duvet rustle as we lie back down to sleep
    playLieDownBlanketRustle() {
      if (!this.unlocked || this.mutedByTab) return;
      this._playSample8D("crop_hit_3", -8, 0.28, 0.68, false, 0.0, 780);
      this._playSample8D("breath_2", 0, 0.16, 0.82, false, 0.28, 1650);
    }

    // Real Binaural Door Knock STRICTLY FROM THE LEFT (`стук в дверь с левой стороны, где наша дверь комнаты`)!
    playBedroomLeftDoorKnock() {
      if (!this.unlocked || this.mutedByTab) return;
      const keys = ["knock_1", "knock_2", "knock_3"].filter((k) => !!this.buffers[k]);
      if (!keys.length) return;

      const buf = this.buffers[keys[0]];
      const now = this.ctx.currentTime;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.setValueAtTime(0.98, now);

      const woodBody = this.ctx.createBiquadFilter();
      woodBody.type = "peaking";
      woodBody.frequency.setValueAtTime(185, now);
      woodBody.Q.setValueAtTime(1.15, now);
      woodBody.gain.setValueAtTime(6.2, now);

      const knuckleCrisp = this.ctx.createBiquadFilter();
      knuckleCrisp.type = "peaking";
      knuckleCrisp.frequency.setValueAtTime(2100, now);
      knuckleCrisp.Q.setValueAtTime(1.25, now);
      knuckleCrisp.gain.setValueAtTime(4.8, now);

      const knockLim = this.ctx.createDynamicsCompressor();
      knockLim.threshold.setValueAtTime(-2.2, now);
      knockLim.knee.setValueAtTime(4.0, now);
      knockLim.ratio.setValueAtTime(12.0, now);
      knockLim.attack.setValueAtTime(0.001, now);
      knockLim.release.setValueAtTime(0.09, now);

      const outGain = this.ctx.createGain();
      outGain.gain.setValueAtTime(3.35, now);
      outGain.connect(woodBody);
      woodBody.connect(knuckleCrisp);
      knuckleCrisp.connect(knockLim);
      knockLim.connect(this.ctx.destination);

      if (buf.numberOfChannels >= 2) {
        // Check which stereo channel has stronger energy so the louder direct ear is ALWAYS routed to LEFT (ch 0)!
        const d0 = buf.getChannelData(0);
        const d1 = buf.getChannelData(1);
        let e0 = 0, e1 = 0;
        const step = Math.max(1, Math.floor(d0.length / 4000));
        for (let i = 0; i < d0.length; i += step) {
          e0 += d0[i] * d0[i];
          e1 += d1[i] * d1[i];
        }
        const split = this.ctx.createChannelSplitter(2);
        const merge = this.ctx.createChannelMerger(2);
        const gainL = this.ctx.createGain();
        const gainR = this.ctx.createGain();
        const shadowLpR = this.ctx.createBiquadFilter();
        shadowLpR.type = "lowpass";
        shadowLpR.frequency.setValueAtTime(3400, now);
        const delayR = this.ctx.createDelay(0.01);
        delayR.delayTime.setValueAtTime(0.00048, now); // Binaural ITD from the left wall!

        gainL.gain.setValueAtTime(1.05, now);
        gainR.gain.setValueAtTime(0.32, now);

        src.connect(split);
        const loudCh = e0 >= e1 ? 0 : 1;
        const quietCh = 1 - loudCh;
        split.connect(gainL, loudCh);
        split.connect(shadowLpR, quietCh);
        shadowLpR.connect(delayR);
        delayR.connect(gainR);

        gainL.connect(merge, 0, 0);
        gainR.connect(merge, 0, 1);
        merge.connect(outGain);
      } else {
        const stage = this._create8DBinauralStage(-78, 1.0);
        src.connect(stage.input);
        stage.output.connect(outGain);
      }
      src.start(now);
    }

    // Lazily initializes the brooding dark-ambient drone chord for the post-ending Drone Forest Title Screen
    _ensureEndMenuAmbient() {
      if (this._endAmbStarted || !this.ctx) return;
      this._endAmbStarted = true;
      const now = this.ctx.currentTime;

      this.endAmbGain = this.ctx.createGain();
      this.endAmbGain.gain.value = 0.0;
      this.endAmbGain.gain.setValueAtTime(0.0, now);

      this.endAmbFilter = this.ctx.createBiquadFilter();
      this.endAmbFilter.type = "lowpass";
      this.endAmbFilter.frequency.setValueAtTime(290, now);
      this.endAmbFilter.Q.setValueAtTime(1.4, now);

      // Haunting minor-9th dark analog horror chord (D1, A1, E2, F2 slightly detuned)
      const voices = [
        ["sawtooth", 36.71, 0.24],
        ["triangle", 36.92, 0.28],
        ["sawtooth", 55.00, 0.16],
        ["sine",     82.41, 0.13],
        ["triangle", 87.31, 0.15]
      ];
      for (const [type, freq, amp] of voices) {
        const osc = this.ctx.createOscillator();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, now);
        const vg = this.ctx.createGain();
        vg.gain.setValueAtTime(amp, now);
        osc.connect(vg);
        vg.connect(this.endAmbFilter);
        osc.start(now);
      }

      this.endAmbFilter.connect(this.endAmbGain);
      this.endAmbGain.connect(this.dryBus);
      this.endAmbGain.connect(this.reverbBus);
    }

    playPickup() {
      if (!this.unlocked || this.mutedByTab) return;
      const now = this.ctx.currentTime;
      for (const [dt, f] of [[0, 940], [0.07, 1410]]) {
        const osc = this.ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(f, now + dt);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.16, now + dt);
        g.gain.exponentialRampToValueAtTime(0.001, now + dt + 0.10);
        osc.connect(g);
        g.connect(this.dryBus);
        osc.start(now + dt);
        osc.stop(now + dt + 0.11);
      }
    }

    _playBreath(stress) {
      const key = (this._breathIdx++ % 2 === 0) ? "breath_1" : "breath_2";
      const vol = 0.08 + stress * 0.16;
      const rate = 0.92 + stress * 0.16 + (Math.random() - 0.5) * 0.05;
      this._playSample8D(key, 0, vol, rate, false, 0, 2800);
    }

    _playHeartbeat(stress) {
      const now = this.ctx.currentTime;
      for (const [dt, f0, amp] of [[0, 58, 1.0], [0.17, 46, 0.68]]) {
        const osc = this.ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(f0, now + dt);
        osc.frequency.exponentialRampToValueAtTime(28, now + dt + 0.12);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.001, now + dt);
        g.gain.linearRampToValueAtTime((0.13 + 0.20 * stress) * amp, now + dt + 0.015);
        g.gain.exponentialRampToValueAtTime(0.001, now + dt + 0.14);
        osc.connect(g);
        g.connect(this.dryBus);
        osc.start(now + dt);
        osc.stop(now + dt + 0.15);
      }
    }

    updateAmbienceAndVitals(dt, speedNorm, battery, trauma, horrorGlitch, mode) {
      if (!this.unlocked || this.mutedByTab) return;
      this._startRealLoopsIfNeeded();
      this._ensureEndMenuAmbient();
      const now = this.ctx.currentTime;

      // Track elapsed time in end_menu for a silky-smooth S-curve swell out of bedroom silence
      const justEnteredEnd = (mode === "end_menu" && this._prevMode !== "end_menu");
      this._prevMode = mode;
      this._endMenuTime = (mode === "end_menu") ? ((this._endMenuTime || 0) + Math.max(0, dt)) : 0;
      const endU = Math.max(0, Math.min(1, (this._endMenuTime - 0.85) / 7.65));
      const endFade = endU * endU * (3.0 - 2.0 * endU);

      // Brooding dark horror pad swells ultra-smoothly from dead silence on the post-ending Drone Forest screen (`mode === "end_menu"`)
      if (this.endAmbGain && this.endAmbFilter) {
        if (justEnteredEnd) {
          this.endAmbGain.gain.cancelScheduledValues(now);
          this.endAmbGain.gain.setValueAtTime(0.0, now);
        }
        const targetAmb = mode === "end_menu" ? (0.22 * endFade) : 0.0;
        this.endAmbGain.gain.setTargetAtTime(targetAmb, now + (justEnteredEnd ? 0.01 : 0), mode === "end_menu" ? 0.16 : 0.22);
        if (mode === "end_menu") {
          const lpFreq = 80 + (165 + Math.sin(now * 0.26) * 50) * endFade;
          this.endAmbFilter.frequency.setTargetAtTime(lpFreq, now, 0.18);
        }
      }

      // Gentle natural modulation of the real low-howling forest wind (0 inside apartment bedroom, S-curve fade on end_menu!)
      if (this.windGain && this.windFilter) {
        if (mode === "bedroom") {
          this.windGain.gain.setTargetAtTime(0.0, now, 0.04);
        } else {
          if (justEnteredEnd) {
            this.windGain.gain.cancelScheduledValues(now);
            this.windGain.gain.setValueAtTime(0.0, now);
          }
          const swell = 0.78 + 0.22 * Math.sin(now * 0.27) * Math.cos(now * 0.13);
          const baseW = mode === "end_menu" ? (0.12 * endFade) : (mode === "gameover" ? 0.18 : 0.26);
          const tauW = mode === "end_menu" ? 0.18 : 0.25;
          this.windGain.gain.setTargetAtTime(baseW * swell, now + (justEnteredEnd ? 0.01 : 0), tauW);
          this.windFilter.frequency.setTargetAtTime(820 + Math.sin(now * 0.22) * 220, now, 0.25);
        }
      }

      if (this.subDroneGain) {
        if (justEnteredEnd) {
          this.subDroneGain.gain.cancelScheduledValues(now);
          this.subDroneGain.gain.setValueAtTime(0.0, now);
        }
        const targetSub = mode === "bedroom"
          ? 0.0
          : (mode === "end_menu"
              ? (0.040 * endFade)
              : ((mode === "death" ? 0.055 : 0.032) + horrorGlitch * 0.07 + trauma * 0.04));
        this.subDroneGain.gain.setTargetAtTime(targetSub, now + (justEnteredEnd ? 0.01 : 0), mode === "end_menu" ? 0.18 : 0.08);
      }

      if (mode !== "run") {
        this.updateCropRustling(dt, null, 0, 0);
        if (mode !== "intro") {
          this.updateRunningLoop(false);
        }
        if (mode === "death") {
          this.breathClock += dt;
          if (this.breathClock >= 1.55) {
            this.breathClock = 0;
            this._playBreath(0.32);
          }
        }
        return;
      }

      const lowBattStress = battery < 0.25 ? (0.25 - battery) / 0.25 : 0;
      const stress = Math.min(1.0, 0.15 + speedNorm * 0.30 + lowBattStress * 0.50 + trauma * 0.80);

      this.breathClock += dt;
      const breathPeriod = Math.max(1.05, 1.95 - stress * 0.75);
      if (this.breathClock >= breathPeriod) {
        this.breathClock = 0;
        this._playBreath(stress);
      }

      if (stress > 0.48) {
        this.heartClock -= dt;
        if (this.heartClock <= 0) {
          this.heartClock = Math.max(0.46, 0.95 - stress * 0.42);
          this._playHeartbeat(stress);
        }
      }

      // Authentic Binaural 3D Door Knock from H5Cjttt_J-Q (2–3 sliced variants)
      this.doorKnockTimer -= dt;
      if (this.doorKnockTimer <= 0) {
        this.doorKnockTimer = 38.0 + Math.random() * 22.0;
        this.playBinauralDoorKnock();
      }

      // Spaced-out 8D footsteps / branch snap / whisper behind neck
      this.behind8DTimer -= dt;
      if (this.behind8DTimer <= 0) {
        this.behind8DTimer = 24.0 + Math.random() * 15.0;
        if (Math.random() < 0.45) this.play8DChasingStepsBehind();
        else this.play8DBehindTwigOrWhisper();
      }
    }
  }

  return { AudioEngine };
})();
