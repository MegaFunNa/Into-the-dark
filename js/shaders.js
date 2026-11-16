// Complete 1998 VHS / Hi8 NightShot Camcorder Signal & Optics Pipeline
window.HorrorShaders = {
  PostVertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,

  PostFragmentShader: `
    uniform sampler2D tDiffuse;
    uniform sampler2D tOsd;
    uniform sampler2D tMonsterFace;
    uniform float uTime;
    uniform float uAspect;
    uniform float uBattery;
    uniform float uTrauma;
    uniform float uAfBlur;
    uniform float uHandSpeed;
    uniform float uHorrorGlitch;
    uniform float uCamcorderOn;
    uniform float uNightVision;
    uniform float uFaceGlitchAmt;
    uniform float uFaceGlitchSeed;
    varying vec2 vUv;

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    float noise1(float x) {
      float i = floor(x);
      float f = fract(x);
      return mix(hash12(vec2(i, 1.7)), hash12(vec2(i + 1.0, 1.7)), f * f * (3.0 - 2.0 * f));
    }

    // Sample scene with optional camcorder autofocus hunting softness
    vec3 sampleScene(vec2 uv, float blurAmt) {
      vec2 clamped = clamp(uv, vec2(0.002), vec2(0.998));
      if (blurAmt < 0.02) {
        return texture2D(tDiffuse, clamped).rgb;
      }
      vec2 r = vec2(blurAmt * 0.0042 / max(uAspect, 0.5), blurAmt * 0.0042);
      vec3 c = texture2D(tDiffuse, clamped).rgb * 0.36;
      c += texture2D(tDiffuse, clamp(clamped + vec2(r.x, r.y), 0.002, 0.998)).rgb * 0.16;
      c += texture2D(tDiffuse, clamp(clamped + vec2(-r.x, r.y), 0.002, 0.998)).rgb * 0.16;
      c += texture2D(tDiffuse, clamp(clamped + vec2(r.x, -r.y), 0.002, 0.998)).rgb * 0.16;
      c += texture2D(tDiffuse, clamp(clamped + vec2(-r.x, -r.y), 0.002, 0.998)).rgb * 0.16;
      return c;
    }

    // Convert scenes RGB -> authentic Sony NightShot / Outlast desaturated sage-emerald phosphor
    float sceneLuma(vec3 rgb) {
      return dot(rgb, vec3(0.32, 0.56, 0.12));
    }

    // Samples the 3D-rendered main monster's grinning face with authentic VHS horizontal scanline tear & subtle RGB split
    vec4 sampleMonsterFaceGlitch(vec2 screenUv, float seed) {
      float bandIdx = floor(screenUv.y * 64.0);
      float bandHash = hash12(vec2(bandIdx, floor(seed * 23.0) + floor(uTime * 28.0)));
      // Keep most scanlines aligned so the staring eyes & curved 30-tooth grin remain unmistakably recognizable, with occasional sharp horizontal tears!
      float sliceShift = (bandHash - 0.5) * (bandHash > 0.86 ? 0.065 : 0.012);
      float bandKeep = step(0.08, hash12(vec2(bandIdx * 1.7, floor(uTime * 25.0) + seed * 11.0)));

      vec2 faceOff = vec2((fract(seed * 7.3) - 0.5) * 0.12, (fract(seed * 3.9) - 0.5) * 0.07);
      vec2 fUv = 0.5 + ((screenUv - 0.5 + faceOff) * vec2(uAspect * 0.68, 0.84)) + vec2(sliceShift, 0.0);
      if (fUv.x < 0.02 || fUv.x > 0.98 || fUv.y < 0.02 || fUv.y > 0.98) {
        return vec4(0.0);
      }
      vec4 texC = texture2D(tMonsterFace, fUv);
      vec4 texR = texture2D(tMonsterFace, clamp(fUv + vec2(0.006, 0.0), 0.02, 0.98));
      vec3 rgb = vec3(texR.r, texC.g, texC.b);
      float alpha = max(texC.a, texR.a * 0.6) * bandKeep;
      return vec4(rgb, alpha);
    }

    void main() {
      // NAKED HUMAN EYE MODE (Opening Flashlight Cutscene, Thrown-Camcorder Darkness Run, Finale & Death Cutscene)
      if (uCamcorderOn < 0.5) {
        vec2 eyeUv = vUv;
        if (uFaceGlitchAmt > 0.01) {
          float tearX = (noise1(floor(vUv.y * 140.0) + uTime * 70.0) - 0.5) * 0.032 * uFaceGlitchAmt;
          eyeUv.x = clamp(eyeUv.x + tearX, 0.002, 0.998);
        }
        vec3 finalEye = max(sampleScene(eyeUv, uAfBlur * 0.65), vec3(0.0)) * vec3(0.88, 0.93, 1.04);

        // Sub-pixel triangular dithering so dark night gradients NEVER quantize into 8-bit circular rings!
        float d1 = hash12(gl_FragCoord.xy + fract(uTime * 17.3) * 100.0);
        float d2 = hash12(gl_FragCoord.yx + fract(uTime * 29.7) * 100.0 + 7.1);
        finalEye += vec3((d1 - d2) * (1.2 / 255.0));

        // Hallucinatory main-monster face interference in darkness after throwing dead camcorder!
        if (uFaceGlitchAmt > 0.01) {
          vec4 fg = sampleMonsterFaceGlitch(vUv, uFaceGlitchSeed);
          float fgFeatures = dot(fg.rgb, vec3(0.33, 0.34, 0.33));
          float scanStatic = (hash12(vec2(floor(vUv.y * 240.0), floor(uTime * 55.0))) - 0.5) * 0.06 * uFaceGlitchAmt;
          float silhouetteMix = clamp(fg.a * uFaceGlitchAmt * 0.78, 0.0, 0.82);
          vec3 eerieFace = fg.rgb * vec3(0.92, 0.96, 1.08) * (1.15 * uFaceGlitchAmt);
          finalEye = mix(finalEye, eerieFace, silhouetteMix) + vec3(scanStatic * 0.7, scanStatic * 0.8, scanStatic);
          finalEye += fg.rgb * clamp(fgFeatures * uFaceGlitchAmt * 0.55, 0.0, 0.65);
        }

        gl_FragColor = vec4(max(finalEye, vec3(0.0)), 1.0);
        return;
      }

      // 1. ASPECT-CORRECTED SUBTLE CAMCORDER LENS (Zero horizontal side stretching!)
      vec2 centered = (vUv - 0.5) * vec2(uAspect, 1.0);
      float r2 = dot(centered, centered);
      vec2 lensUv = 0.5 + (centered * (1.0 + 0.052 * r2)) / vec2(uAspect, 1.0);

      // Soft rounded CRT/viewfinder bezel mask at extreme outer edge
      vec2 edgeD = abs(lensUv - 0.5) * 2.0;
      float bezel = smoothstep(1.015, 0.985, max(edgeD.x, edgeD.y));

      // 2. ANALOG VHS TIMEBASE JITTER, INTERLACED COMB & BOTTOM HEAD-SWITCHING NOISE
      float scanLineIdx = floor(lensUv.y * 270.0);
      float fieldParity = mod(scanLineIdx, 2.0); // 0 or 1 interlaced field

      // Micro horizontal scanline timebase wobble
      float tbcJitter = (noise1(scanLineIdx * 0.35 + uTime * 38.0) - 0.5) * 0.0014;
      // Interlaced combing on odd lines when hand whips fast or stumbles
      float interlaceComb = (fieldParity - 0.5) * (0.0009 + uHandSpeed * 0.0022 + uTrauma * 0.006);

      // Rolling VHS tracking tear bar (stronger when low battery, trauma, or horror apparition!)
      float lowBatt = clamp((0.28 - uBattery) / 0.28, 0.0, 1.0);
      float tearPos = fract(uTime * 0.19 + sin(uTime * 0.7) * 0.12);
      float tearMask = smoothstep(0.045, 0.0, abs(lensUv.y - tearPos)) * (0.18 + lowBatt * 0.75 + uTrauma * 0.9);
      float horrorSkew = uHorrorGlitch * (noise1(scanLineIdx * 1.3 + uTime * 90.0) - 0.5) * 0.085;
      float tearShift = tearMask * (noise1(scanLineIdx * 0.9 + uTime * 55.0) - 0.5) * 0.045 + horrorSkew;

      vec2 tapeUv = vec2(
        lensUv.x + tbcJitter + interlaceComb + tearShift,
        lensUv.y
      );

      // 3. LUMA + ANALOG PEAKING RINGING ("VHS RIGHT-EDGE HALO")
      float dx = 1.0 / 640.0;
      vec3 colCenter = sampleScene(tapeUv, uAfBlur);
      vec3 colLeft1  = sampleScene(tapeUv - vec2(dx, 0.0), uAfBlur);
      vec3 colLeft2  = sampleScene(tapeUv - vec2(dx * 2.2, 0.0), uAfBlur);
      vec3 colRight1 = sampleScene(tapeUv + vec2(dx * 1.5, 0.0), uAfBlur);

      float y0 = sceneLuma(colCenter);
      float yL1 = sceneLuma(colLeft1);
      float yL2 = sceneLuma(colLeft2);

      // Subtle VHS analog peaking overshoot to the right of sharp vertical edges
      float ringing = (y0 - yL1) * 0.42 - (yL1 - yL2) * 0.18;
      float ySignal = max(0.0, y0 + ringing);

      // 4. REAL CAMCORDER IR LED HOTSPOT & FALLOFF + DIRTY LENS GLINT
      // Single onboard IR emitter is bright near center and drops off smoothly toward corners
      vec2 irOff = (lensUv - vec2(0.50, 0.47)) * vec2(uAspect * 0.78, 1.0);
      float irDist2 = dot(irOff, irOff);
      float irHotspot = exp(-irDist2 * 1.45);
      float irLift = 0.018 * irHotspot; // Faint foggy IR scatter in center

      // Compress highlights like real CCD camcorder sensor & map to authentic NightShot palette:
      // Deep shadows -> murky dark grey-olive; Midtones -> muted sage-phosphor; Hot IR -> pale silvery-white!
      float driven = (ySignal + irLift) * (0.55 + 0.95 * irHotspot);
      float sensorLuma = driven / (0.34 + driven); // Soft analog knee compression

      vec3 shadowTint = vec3(0.014, 0.024, 0.018);
      vec3 midTint    = vec3(0.28, 0.56, 0.36);
      vec3 hiTint     = vec3(0.84, 0.97, 0.86);

      vec3 nightCol = mix(shadowTint, midTint, smoothstep(0.0, 0.58, sensorLuma));
      nightCol = mix(nightCol, hiTint, smoothstep(0.46, 0.96, sensorLuma));

      // Subtle analog chroma fringes (purple/green CCD chromatic aberration on bright IR edges)
      float caDiff = sceneLuma(colLeft2) - sceneLuma(colRight1);
      nightCol.r += caDiff * 0.08;
      nightCol.b -= caDiff * 0.09;

      // Dirty protective camcorder lens dust / smudge catching bright center light
      float smudge = hash12(floor(lensUv * vec2(85.0 * uAspect, 85.0)));
      float dustGlint = smoothstep(0.986, 0.999, smudge) * (0.04 + 0.10 * sensorLuma);
      nightCol += vec3(0.55, 0.72, 0.58) * dustGlint;

      // Blend between emerald IR NightShot (uNightVision = 1.0) and dark unamplified CCD video (uNightVision = 0.0 when 1-bar IR cuts out!)
      vec3 darkCcdCol = pow(max(colCenter, vec3(0.0)), vec3(0.98)) * 0.72 + vec3(0.005, 0.006, 0.009);
      nightCol = mix(darkCcdCol, nightCol, clamp(uNightVision, 0.0, 1.0));

      // Rare, faint subliminal main-monster face VHS ghost on 1-bar battery — STRICTLY ONLY WHEN NIGHT VISION IS ON!
      if (uFaceGlitchAmt > 0.005 && uNightVision > 0.65) {
        vec4 fg = sampleMonsterFaceGlitch(tapeUv, uFaceGlitchSeed);
        float fgLuma = dot(fg.rgb, vec3(0.32, 0.56, 0.12));
        // Subtle dark head shadow + faint ghostly green phosphor eyes & teeth (rare & barely visible!)
        vec3 ghostPhosphor = mix(vec3(0.006, 0.014, 0.009), vec3(0.58, 0.88, 0.64), clamp(fgLuma * 1.35, 0.0, 1.0));
        float ghostAlpha = clamp(fg.a * uFaceGlitchAmt * uNightVision * (0.55 + 0.75 * fgLuma), 0.0, 0.22);
        nightCol = mix(nightCol, ghostPhosphor, ghostAlpha);
      }

      // 5. COMPOSITE PIXEL-BITMAP VCR OSD INSIDE THE ANALOG TAPE SIGNAL!
      // Note: THREE.CanvasTexture has flipY=true by default, so lensUv.y maps upright (top=1, bottom=0)!
      vec2 osdUv = vec2(lensUv.x + tbcJitter * 0.65 + tearShift * 0.8, lensUv.y);
      vec4 osd0 = texture2D(tOsd, clamp(osdUv, 0.0, 1.0));
      vec4 osdBleed1 = texture2D(tOsd, clamp(osdUv - vec2(0.0032, 0.0), 0.0, 1.0));
      vec4 osdBleed2 = texture2D(tOsd, clamp(osdUv - vec2(0.0068, 0.0), 0.0, 1.0));

      // Smear OSD color horizontally (especially red REC dot!) + slight luma ringing on right of text
      vec3 osdChromaSmear = osd0.rgb * 0.62 + osdBleed1.rgb * 0.26 + osdBleed2.rgb * 0.12;
      float osdAlpha = max(osd0.a, osdBleed1.a * 0.38);
      float osdRightShadow = clamp((osdBleed1.a - osd0.a) * 0.55, 0.0, 0.5);
      nightCol *= (1.0 - osdRightShadow);
      nightCol = mix(nightCol, osdChromaSmear, clamp(osdAlpha * 0.93, 0.0, 1.0));

      // 6. MAGNETIC TAPE OXIDE DROPOUT STREAKS
      float dropoutSeed = hash12(vec2(scanLineIdx, floor(uTime * 24.0)));
      float dropoutThresh = 0.9965 - lowBatt * 0.010 - uTrauma * 0.015;
      if (dropoutSeed > dropoutThresh) {
        float streakX = fract(dropoutSeed * 91.7);
        float streakLen = 0.04 + 0.14 * fract(dropoutSeed * 17.3);
        float inStreak = step(streakX, lensUv.x) * smoothstep(streakX + streakLen, streakX, lensUv.x);
        nightCol = mix(nightCol, vec3(0.82, 0.88, 0.82), inStreak * 0.78);
      }

      // 7. CRT / LCD SCANLINES & ANALOG LUMA TAPE GRAIN
      float scanWave = 0.91 + 0.09 * sin(lensUv.y * 540.0 * 3.14159);
      nightCol *= scanWave;

      float grain = hash12(floor(lensUv * vec2(420.0 * uAspect, 270.0)) + fract(uTime * 29.97) * 97.0) - 0.5;
      float grainAmp = mix(0.085, 0.032, sensorLuma) + lowBatt * 0.08 + tearMask * 0.16;
      nightCol += vec3(grain * 0.75, grain * 0.95, grain * 0.78) * grainAmp;

      // Brief eerie negative-luma VHS voltage spike during stalker apparition vanish!
      if (uHorrorGlitch > 0.55 && hash12(vec2(floor(uTime * 35.0), 3.1)) > 0.45) {
        nightCol = mix(nightCol, vec3(0.85, 0.96, 0.86) - nightCol * 0.85, (uHorrorGlitch - 0.55) * 1.4);
      }

      // Optical corner vignette & bezel cutoff
      float vig = 1.0 - smoothstep(0.28, 1.18, r2 * 1.12);
      nightCol *= mix(0.22, 1.0, vig) * bezel;

      gl_FragColor = vec4(max(nightCol, vec3(0.0)), 1.0);
    }
  `,

  /**
   * Subtle blink/flinch renderer when grazing obstacles or waking up
   */
  drawEyelidBlink: function (ctx, w, h, blinkClose, tension) {
    ctx.clearRect(0, 0, w, h);
    if (blinkClose <= 0.003) return;

    if (blinkClose >= 0.992) {
      ctx.fillStyle = "#010201";
      ctx.fillRect(0, 0, w, h);
      return;
    }

    const meetY = h * 0.52;
    const archH = h * (0.20 * (1.0 - blinkClose) + 0.02 * tension);
    const upperCenterY = -h * 0.06 + (meetY + h * 0.08) * blinkClose;
    const lowerCenterY = h * 1.06 - (h * 1.06 - meetY + h * 0.05) * blinkClose;

    ctx.fillStyle = "#010201";
    ctx.beginPath();
    ctx.moveTo(-20, -20);
    ctx.lineTo(w + 20, -20);
    ctx.lineTo(w + 20, upperCenterY + archH);
    ctx.quadraticCurveTo(w * 0.5, upperCenterY - archH, -20, upperCenterY + archH);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(-20, h + 20);
    ctx.lineTo(w + 20, h + 20);
    ctx.lineTo(w + 20, lowerCenterY - archH * 0.65);
    ctx.quadraticCurveTo(w * 0.5, lowerCenterY + archH * 0.65, -20, lowerCenterY - archH * 0.65);
    ctx.closePath();
    ctx.fill();
  }
};
