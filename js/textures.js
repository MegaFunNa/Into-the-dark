window.HorrorTextures = (function () {
  function makeCanvas(w, h) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  }

  function toRepeatTex(canvas, rx, ry) {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx, ry);
    t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  }

  function toClampTex(canvas) {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  }

  function tileNoise(x, y, periodX, periodY, seed) {
    const ix = ((Math.floor(x) % periodX) + periodX) % periodX;
    const iy = ((Math.floor(y) % periodY) + periodY) % periodY;
    const fx = x - Math.floor(x);
    const fy = y - Math.floor(y);
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);

    function h(gx, gy) {
      const wx = gx % periodX;
      const wy = gy % periodY;
      const n = Math.sin(wx * 127.1 + wy * 311.7 + seed * 74.7) * 43758.5453;
      return n - Math.floor(n);
    }

    const a = h(ix, iy);
    const b = h(ix + 1, iy);
    const c = h(ix, iy + 1);
    const d = h(ix + 1, iy + 1);
    return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy;
  }

  // Helper: Draw realistic 7-leaflet palmate serrated hemp leaf at (cx, cy)
  function drawPalmateHempLeaf(ctx, cx, cy, radius, baseAngle, brightness) {
    const leaflets = [
      { a: -1.18, len: 0.52, w: 0.11 },
      { a: -0.78, len: 0.78, w: 0.14 },
      { a: -0.38, len: 0.94, w: 0.16 },
      { a:  0.00, len: 1.05, w: 0.17 },
      { a:  0.38, len: 0.94, w: 0.16 },
      { a:  0.78, len: 0.78, w: 0.14 },
      { a:  1.18, len: 0.52, w: 0.11 }
    ];

    for (const lf of leaflets) {
      const ang = baseAngle + lf.a;
      const L = radius * lf.len;
      const W = radius * lf.w;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ang);

      const grad = ctx.createLinearGradient(0, 0, 0, -L);
      grad.addColorStop(0.0, `rgb(${Math.floor(22 * brightness)}, ${Math.floor(34 * brightness)}, ${Math.floor(20 * brightness)})`);
      grad.addColorStop(0.6, `rgb(${Math.floor(42 * brightness)}, ${Math.floor(62 * brightness)}, ${Math.floor(34 * brightness)})`);
      grad.addColorStop(1.0, `rgb(${Math.floor(58 * brightness)}, ${Math.floor(78 * brightness)}, ${Math.floor(44 * brightness)})`);
      ctx.fillStyle = grad;

      // Serrated lanceolate leaflet silhouette
      ctx.beginPath();
      ctx.moveTo(0, 0);
      const teeth = 6;
      for (let t = 1; t <= teeth; t++) {
        const u = t / (teeth + 1);
        const wCur = Math.sin(u * Math.PI) * W;
        ctx.lineTo(-wCur * 1.12, -u * L);
        ctx.lineTo(-wCur * 0.78, -(u + 0.04) * L);
      }
      ctx.lineTo(0, -L);
      for (let t = teeth; t >= 1; t--) {
        const u = t / (teeth + 1);
        const wCur = Math.sin(u * Math.PI) * W;
        ctx.lineTo(wCur * 0.78, -(u + 0.04) * L);
        ctx.lineTo(wCur * 1.12, -u * L);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "rgba(8, 12, 7, 0.85)";
      ctx.lineWidth = 1.6;
      ctx.stroke();

      // Central leaflet vein
      ctx.strokeStyle = `rgba(${Math.floor(78 * brightness)}, ${Math.floor(98 * brightness)}, ${Math.floor(58 * brightness)}, 0.65)`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -L * 0.92);
      ctx.stroke();

      ctx.restore();
    }
  }

  function buildAll() {
    // 1. DAMP EARTH, MOSS & FURROW SOIL
    const sz = 256;
    const gCol = makeCanvas(sz, sz);
    const gBump = makeCanvas(sz, sz);
    const ctxC = gCol.getContext("2d");
    const ctxB = gBump.getContext("2d");
    const imgC = ctxC.createImageData(sz, sz);
    const imgB = ctxB.createImageData(sz, sz);

    for (let y = 0; y < sz; y++) {
      for (let x = 0; x < sz; x++) {
        const idx = (y * sz + x) * 4;
        const n1 = tileNoise((x / sz) * 6, (y / sz) * 6, 6, 6, 1);
        const n2 = tileNoise((x / sz) * 20, (y / sz) * 20, 20, 20, 2);
        const n3 = tileNoise((x / sz) * 64, (y / sz) * 64, 64, 64, 3);
        const fbm = n1 * 0.50 + n2 * 0.32 + n3 * 0.18;
        const puddle = fbm < 0.30 ? Math.min(1, (0.30 - fbm) * 8.5) : 0;

        imgC.data[idx] = Math.min(255, (34 + fbm * 38) * (1 - puddle * 0.45));
        imgC.data[idx + 1] = Math.min(255, (34 + fbm * 42) * (1 - puddle * 0.42));
        imgC.data[idx + 2] = Math.min(255, (25 + fbm * 26) * (1 - puddle * 0.38));
        imgC.data[idx + 3] = 255;

        const bv = Math.floor((n2 * 0.5 + n3 * 0.5) * (1 - puddle * 0.85) * 255);
        imgB.data[idx] = imgB.data[idx + 1] = imgB.data[idx + 2] = bv;
        imgB.data[idx + 3] = 255;
      }
    }
    ctxC.putImageData(imgC, 0, 0);
    ctxB.putImageData(imgB, 0, 0);

    // 2. FINE WILD GRASS & SWAMP CATTAILS (512x512 RGBA Alpha-Cutout)
    const grassCard = makeCanvas(512, 512);
    const gCtx = grassCard.getContext("2d");
    for (let i = 0; i < 115; i++) {
      const baseX = 24 + (i / 114) * 464 + (Math.random() - 0.5) * 14;
      const bladeH = 120 + Math.random() * 345;
      const lean = (Math.random() - 0.5) * 110 + (baseX - 256) * 0.22;
      const tipX = baseX + lean;
      const tipY = 512 - bladeH;
      const cpX = baseX + lean * 0.36;
      const cpY = 512 - bladeH * 0.58;
      const halfW = 1.8 + Math.random() * 2.4;

      const grad = gCtx.createLinearGradient(baseX, 512, tipX, tipY);
      const shade = 0.56 + Math.random() * 0.48;
      grad.addColorStop(0.0, `rgb(${Math.floor(10 * shade)}, ${Math.floor(13 * shade)}, ${Math.floor(9 * shade)})`);
      grad.addColorStop(0.35, `rgb(${Math.floor(24 * shade)}, ${Math.floor(33 * shade)}, ${Math.floor(19 * shade)})`);
      grad.addColorStop(0.85, `rgb(${Math.floor(44 * shade)}, ${Math.floor(55 * shade)}, ${Math.floor(30 * shade)})`);
      grad.addColorStop(1.0, `rgb(${Math.floor(62 * shade)}, ${Math.floor(72 * shade)}, ${Math.floor(42 * shade)})`);

      gCtx.fillStyle = grad;
      gCtx.beginPath();
      gCtx.moveTo(baseX - halfW, 512);
      gCtx.quadraticCurveTo(cpX - halfW * 0.5, cpY, tipX, tipY);
      gCtx.quadraticCurveTo(cpX + halfW * 0.5, cpY, baseX + halfW, 512);
      gCtx.closePath();
      gCtx.fill();
    }

    // 3. TALL LUSH WILD HEMP BUSH (`Поле высокой дикой конопли рядами`, 512x512 RGBA Alpha-Cutout!)
    const hempCard = makeCanvas(512, 512);
    const hCtx = hempCard.getContext("2d");
    for (const sx of [168, 344]) {
      const tx = sx + (sx - 256) * 0.08;
      const stG = hCtx.createLinearGradient(sx, 512, tx, 26);
      stG.addColorStop(0, "#10150d");
      stG.addColorStop(0.4, "#293620");
      stG.addColorStop(1, "#445735");
      hCtx.strokeStyle = stG;
      hCtx.lineWidth = 7.5;
      hCtx.beginPath();
      hCtx.moveTo(sx, 512);
      hCtx.quadraticCurveTo((sx + tx) * 0.5, 260, tx, 28);
      hCtx.stroke();

      // Apical hemp flower cola at top
      for (let c = 0; c < 11; c++) {
        const cy = 22 + c * 7;
        const cr = 6 + Math.sin((c / 11) * Math.PI) * 9;
        hCtx.fillStyle = c % 2 === 0 ? "#2d3d23" : "#3f5432";
        hCtx.beginPath();
        hCtx.ellipse(tx + ((c % 3) - 1) * 3, cy, cr, 5, 0, 0, Math.PI * 2);
        hCtx.fill();
      }

      // Alternating crisp 7-fingered serrated hemp fan leaves on petioles along each stalk!
      for (let n = 0; n < 8; n++) {
        const t = (n + 0.6) / 8.6;
        const nodeY = 486 - t * 395;
        const nodeX = sx + (tx - sx) * t;
        const side = n % 2 === 0 ? -1 : 1;
        const petX = nodeX + side * (36 + Math.sin(t * Math.PI) * 24);
        const petY = nodeY - 10;

        hCtx.strokeStyle = "#2b3822";
        hCtx.lineWidth = 2.6;
        hCtx.beginPath();
        hCtx.moveTo(nodeX, nodeY);
        hCtx.lineTo(petX, petY);
        hCtx.stroke();

        const leafSize = 44 + Math.sin(t * Math.PI * 0.9) * 28;
        const tilt = side * 0.55;
        const bright = 0.36 + t * 0.44;
        drawPalmateHempLeaf(hCtx, petX, petY, leafSize, tilt, bright);
      }
    }

    // 4. REALISTIC ROW-PLANTED TALL CORN STALK (`Ряды высокой кукурузы`, 384x512 RGBA Alpha-Cutout!)
    const cornCard = makeCanvas(384, 512);
    const coCtx = cornCard.getContext("2d");
    for (const sx of [115, 192, 269]) {
      const topX = sx + (sx - 192) * 0.12;
      const stGrad = coCtx.createLinearGradient(sx, 512, topX, 18);
      stGrad.addColorStop(0.0, "#12150d");
      stGrad.addColorStop(0.35, "#383b22");
      stGrad.addColorStop(1.0, "#5e5c36");
      coCtx.strokeStyle = stGrad;
      coCtx.lineWidth = 8.0;
      coCtx.beginPath();
      coCtx.moveTo(sx, 512);
      coCtx.lineTo(topX, 26);
      coCtx.stroke();

      // Corn cob (початок) mid-stalk + feathery tassel at top
      coCtx.fillStyle = "#6e683d";
      coCtx.beginPath();
      coCtx.ellipse((sx + topX) * 0.5 + 8, 255, 8, 24, 0.28, 0, Math.PI * 2);
      coCtx.fill();

      for (let t = -3; t <= 3; t++) {
        coCtx.strokeStyle = "#787246";
        coCtx.lineWidth = 2.0;
        coCtx.beginPath();
        coCtx.moveTo(topX, 32);
        coCtx.quadraticCurveTo(topX + t * 8, 12, topX + t * 14, 6 + Math.abs(t) * 4);
        coCtx.stroke();
      }

      // Long graceful arching sword-shaped corn leaves
      for (let l = 0; l < 10; l++) {
        const lt = (l + 1) / 11;
        const ly = 492 - lt * 435;
        const lx = sx + (topX - sx) * lt;
        const dir = l % 2 === 0 ? -1 : 1;
        const span = (68 + Math.sin(lt * Math.PI) * 52) * dir;
        const shade = 0.45 + lt * 0.65;
        coCtx.fillStyle = `rgb(${Math.floor(58 * shade)}, ${Math.floor(62 * shade)}, ${Math.floor(34 * shade)})`;
        coCtx.beginPath();
        coCtx.moveTo(lx, ly - 7);
        coCtx.quadraticCurveTo(lx + span * 0.52, ly - 42, lx + span, ly + 36);
        coCtx.quadraticCurveTo(lx + span * 0.48, ly - 20, lx, ly + 7);
        coCtx.closePath();
        coCtx.fill();
      }
    }

    // 5. SWAMP CATTAILS / REEDS (`Болотный камыш`, 256x512 RGBA Alpha-Cutout)
    const reedCard = makeCanvas(256, 512);
    const reCtx = reedCard.getContext("2d");
    for (let r = 0; r < 22; r++) {
      const bx = 28 + (r / 21) * 200;
      const tx = bx + (Math.random() - 0.5) * 45;
      const h = 280 + Math.random() * 210;
      reCtx.strokeStyle = "#364028";
      reCtx.lineWidth = 3.2;
      reCtx.beginPath();
      reCtx.moveTo(bx, 512);
      reCtx.quadraticCurveTo((bx + tx) * 0.5, 512 - h * 0.5, tx, 512 - h);
      reCtx.stroke();
      // Dark velvety cattail cylinder head (`рогоз`) on tall stems!
      if (r % 4 === 1 && h > 360) {
        reCtx.fillStyle = "#221812";
        reCtx.beginPath();
        reCtx.ellipse(tx, 512 - h + 48, 6.5, 28, (tx - bx) * 0.002, 0, Math.PI * 2);
        reCtx.fill();
      }
    }

    // 6. FOREST FERN & CONIFER SPRUCE BOUGH
    const fernCard = makeCanvas(256, 256);
    const fCtx = fernCard.getContext("2d");
    fCtx.strokeStyle = "#222e1a";
    fCtx.lineWidth = 3.5;
    fCtx.beginPath();
    fCtx.moveTo(128, 254);
    fCtx.quadraticCurveTo(132, 130, 128, 16);
    fCtx.stroke();
    for (let p = 0; p < 22; p++) {
      const t = p / 21;
      const y = 242 - t * 218;
      const span = Math.sin(Math.pow(t, 0.72) * Math.PI) * 96 + (1 - t) * 14;
      const shade = 0.52 + t * 0.45;
      fCtx.fillStyle = `rgb(${Math.floor(38 * shade)}, ${Math.floor(54 * shade)}, ${Math.floor(28 * shade)})`;
      for (const dir of [-1, 1]) {
        fCtx.beginPath();
        fCtx.moveTo(128, y + 4);
        fCtx.quadraticCurveTo(128 + dir * span * 0.55, y - 7, 128 + dir * span, y - 2 - t * 6);
        fCtx.quadraticCurveTo(128 + dir * span * 0.55, y + 7, 128, y - 3);
        fCtx.closePath();
        fCtx.fill();
      }
    }

    const boughCard = makeCanvas(256, 256);
    const boCtx = boughCard.getContext("2d");
    boCtx.strokeStyle = "#261c15";
    boCtx.lineWidth = 5;
    boCtx.beginPath();
    boCtx.moveTo(128, 8);
    boCtx.lineTo(128, 232);
    boCtx.stroke();
    for (let s = 0; s < 16; s++) {
      const t = s / 15;
      const sy = 22 + t * 205;
      const armLen = (0.35 + Math.sin(t * Math.PI * 0.88) * 0.75) * 108;
      for (const side of [-1, 1]) {
        const ex = 128 + side * armLen;
        const ey = sy + 18;
        boCtx.strokeStyle = "#221912";
        boCtx.lineWidth = 2.4;
        boCtx.beginPath();
        boCtx.moveTo(128, sy);
        boCtx.lineTo(ex, ey);
        boCtx.stroke();
        for (let n = 0; n < 24; n++) {
          const nt = n / 23;
          const nx = 128 + (ex - 128) * nt;
          const ny = sy + (ey - sy) * nt;
          const nAng = (side > 0 ? 0.35 : Math.PI - 0.35) + (Math.random() - 0.5) * 1.1;
          const nLen = 10 + (1 - nt * 0.4) * 13;
          boCtx.strokeStyle = Math.random() < 0.5 ? "#1c2b1d" : "#293b26";
          boCtx.lineWidth = 1.7;
          boCtx.beginPath();
          boCtx.moveTo(nx, ny);
          boCtx.lineTo(nx + Math.cos(nAng) * nLen, ny + Math.sin(nAng) * nLen);
          boCtx.stroke();
        }
      }
    }

    // 7. PINE BARK & BIRCH BARK
    const pineCol = makeCanvas(256, 256);
    const pineBump = makeCanvas(256, 256);
    const pCtx = pineCol.getContext("2d");
    const pbCtx = pineBump.getContext("2d");
    const pImg = pCtx.createImageData(256, 256);
    const pbImg = pbCtx.createImageData(256, 256);
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        const idx = (y * 256 + x) * 4;
        const warp = tileNoise((x / 256) * 8, (y / 256) * 4, 8, 4, 7) * 2.2;
        const ridge = Math.abs(Math.sin(((x / 256) * 15 + warp) * Math.PI));
        const fine = tileNoise((x / 256) * 36, (y / 256) * 18, 36, 18, 9);
        const v = ridge * 0.68 + fine * 0.32;
        pImg.data[idx] = 34 + v * 60;
        pImg.data[idx + 1] = 28 + v * 48;
        pImg.data[idx + 2] = 22 + v * 36;
        pImg.data[idx + 3] = 255;
        const bv = Math.floor(v * 255);
        pbImg.data[idx] = pbImg.data[idx + 1] = pbImg.data[idx + 2] = bv;
        pbImg.data[idx + 3] = 255;
      }
    }
    pCtx.putImageData(pImg, 0, 0);
    pbCtx.putImageData(pbImg, 0, 0);

    const birchCol = makeCanvas(256, 256);
    const bCtx = birchCol.getContext("2d");
    bCtx.fillStyle = "#c5c0b5";
    bCtx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 200; i++) {
      const bx = Math.random() * 256;
      const by = Math.random() * 256;
      const bw = 10 + Math.random() * 46;
      const bh = 1.5 + Math.random() * 4.5;
      bCtx.fillStyle = Math.random() < 0.68 ? "rgba(20, 19, 17, 0.88)" : "rgba(130, 124, 110, 0.45)";
      bCtx.fillRect(bx, by, bw, bh);
      if (bx + bw > 256) bCtx.fillRect(bx - 256, by, bw, bh);
    }
    const baseGrad = bCtx.createLinearGradient(0, 185, 0, 256);
    baseGrad.addColorStop(0, "rgba(24, 22, 18, 0)");
    baseGrad.addColorStop(1, "rgba(18, 16, 14, 0.95)");
    bCtx.fillStyle = baseGrad;
    bCtx.fillRect(0, 185, 256, 71);

    // 8. CLEAN LOG CABIN FACADE & OLD WEATHERED CHURCH PLASTER/BRICK WITH ARCHED WINDOWS!
    const cabinWall = makeCanvas(256, 256);
    const cwCtx = cabinWall.getContext("2d");
    for (let l = 0; l < 9; l++) {
      const ly = l * (256 / 9);
      const lh = 256 / 9;
      const lg = cwCtx.createLinearGradient(0, ly, 0, ly + lh);
      lg.addColorStop(0.0, "#17110c");
      lg.addColorStop(0.22, "#4a392a");
      lg.addColorStop(0.50, "#5e4a37");
      lg.addColorStop(0.80, "#413224");
      lg.addColorStop(1.0, "#140f0a");
      cwCtx.fillStyle = lg;
      cwCtx.fillRect(0, ly, 256, lh + 1);
    }
    for (const wx of [42, 158]) {
      const wy = 78, ww = 56, wh = 82;
      cwCtx.fillStyle = "#8a8274";
      cwCtx.fillRect(wx - 5, wy - 6, ww + 10, wh + 12);
      cwCtx.fillStyle = "#060807";
      cwCtx.fillRect(wx, wy, ww, wh);
      cwCtx.fillStyle = "#6e675b";
      cwCtx.fillRect(wx + ww * 0.5 - 2, wy, 4, wh);
      cwCtx.fillRect(wx, wy + wh * 0.42, ww, 4);
    }

    // Peeling Whitewashed Brick Church Facade with Tall Arched Windows & Iron Bars!
    const churchWall = makeCanvas(256, 256);
    const chCtx = churchWall.getContext("2d");
    chCtx.fillStyle = "#9e9c92";
    chCtx.fillRect(0, 0, 256, 256);
    // Crumbled brick patches peeking through peeling plaster
    for (let p = 0; p < 38; p++) {
      const px = Math.random() * 220;
      const py = Math.random() * 220;
      chCtx.fillStyle = Math.random() < 0.5 ? "rgba(76, 48, 38, 0.55)" : "rgba(58, 60, 54, 0.45)";
      chCtx.fillRect(px, py, 14 + Math.random() * 28, 8 + Math.random() * 18);
    }
    // Damp moss stains at bottom
    const mossG = chCtx.createLinearGradient(0, 180, 0, 256);
    mossG.addColorStop(0, "rgba(25, 32, 22, 0)");
    mossG.addColorStop(1, "rgba(20, 28, 18, 0.85)");
    chCtx.fillStyle = mossG;
    chCtx.fillRect(0, 180, 256, 76);
    // 3 Tall Gothic/Orthodox Arched Windows with wrought-iron grilles
    for (const ax of [46, 128, 210]) {
      const ay = 108, aw = 34, ah = 92;
      chCtx.fillStyle = "#bebcb0";
      chCtx.beginPath();
      chCtx.arc(ax, ay, aw * 0.62, Math.PI, 0);
      chCtx.lineTo(ax + aw * 0.62, ay + ah);
      chCtx.lineTo(ax - aw * 0.62, ay + ah);
      chCtx.closePath();
      chCtx.fill();

      chCtx.fillStyle = "#070908";
      chCtx.beginPath();
      chCtx.arc(ax, ay, aw * 0.48, Math.PI, 0);
      chCtx.lineTo(ax + aw * 0.48, ay + ah - 4);
      chCtx.lineTo(ax - aw * 0.48, ay + ah - 4);
      chCtx.closePath();
      chCtx.fill();

      // Iron bars inside arch
      chCtx.strokeStyle = "#3a3d39";
      chCtx.lineWidth = 2;
      chCtx.beginPath();
      chCtx.moveTo(ax, ay - aw * 0.46);
      chCtx.lineTo(ax, ay + ah - 4);
      chCtx.moveTo(ax - aw * 0.46, ay + 24);
      chCtx.lineTo(ax + aw * 0.46, ay + 24);
      chCtx.moveTo(ax - aw * 0.46, ay + 56);
      chCtx.lineTo(ax + aw * 0.46, ay + 56);
      chCtx.stroke();
    }

    // 9. BARN PLANKS, ROOF & ROAD & RUST
    const barnPlanks = makeCanvas(256, 256);
    const bpCtx = barnPlanks.getContext("2d");
    for (let p = 0; p < 12; p++) {
      const px = p * (256 / 12);
      const pw = 256 / 12;
      const shade = 0.78 + (p % 3) * 0.12;
      bpCtx.fillStyle = `rgb(${Math.floor(72 * shade)}, ${Math.floor(46 * shade)}, ${Math.floor(36 * shade)})`;
      bpCtx.fillRect(px, 0, pw - 2, 256);
      bpCtx.fillStyle = "#140e0b";
      bpCtx.fillRect(px + pw - 2, 0, 2, 256);
    }

    const roofTex = makeCanvas(256, 256);
    const rfCtx = roofTex.getContext("2d");
    for (let s = 0; s < 16; s++) {
      const sx = s * 16;
      rfCtx.fillStyle = s % 2 === 0 ? "#3c3f3d" : "#252726";
      rfCtx.fillRect(sx, 0, 16, 256);
      if (s % 3 === 0) {
        rfCtx.fillStyle = "rgba(85, 48, 32, 0.38)";
        rfCtx.fillRect(sx, (s * 37) % 180, 15, 65);
      }
    }

    const roadCol = makeCanvas(256, 256);
    const rdCtx = roadCol.getContext("2d");
    rdCtx.fillStyle = "#2a2c2b";
    rdCtx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1600; i++) {
      const v = 30 + Math.floor(Math.random() * 32);
      rdCtx.fillStyle = `rgb(${v},${v},${v})`;
      rdCtx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }
    rdCtx.fillStyle = "rgba(182, 180, 162, 0.68)";
    rdCtx.fillRect(124, 18, 8, 96);
    rdCtx.fillRect(124, 148, 8, 88);

    const rustCol = makeCanvas(256, 256);
    const rCtx = rustCol.getContext("2d");
    const rImg = rCtx.createImageData(256, 256);
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        const idx = (y * 256 + x) * 4;
        const n = tileNoise((x / 256) * 10, (y / 256) * 10, 10, 10, 21);
        const fine = tileNoise((x / 256) * 36, (y / 256) * 36, 36, 36, 22);
        const rustMask = n * 0.7 + fine * 0.3 > 0.50 ? 1 : 0;
        rImg.data[idx] = rustMask ? 96 + fine * 36 : 54 + fine * 26;
        rImg.data[idx + 1] = rustMask ? 48 + fine * 20 : 60 + fine * 24;
        rImg.data[idx + 2] = rustMask ? 34 + fine * 14 : 62 + fine * 24;
        rImg.data[idx + 3] = 255;
      }
    }
    rCtx.putImageData(rImg, 0, 0);

    const glowCanvas = makeCanvas(128, 128);
    const glCtx = glowCanvas.getContext("2d");
    const glGrad = glCtx.createRadialGradient(64, 64, 2, 64, 64, 62);
    glGrad.addColorStop(0.0, "rgba(220, 255, 228, 0.95)");
    glGrad.addColorStop(0.25, "rgba(165, 235, 185, 0.42)");
    glGrad.addColorStop(0.65, "rgba(110, 185, 130, 0.10)");
    glGrad.addColorStop(1.0, "rgba(0, 0, 0, 0.0)");
    glCtx.fillStyle = glGrad;
    glCtx.fillRect(0, 0, 128, 128);

    return {
      groundMap: toRepeatTex(gCol, 8, 8),
      groundBump: toRepeatTex(gBump, 8, 8),
      grassMap: toClampTex(grassCard),
      hempMap: toClampTex(hempCard),
      cornMap: toClampTex(cornCard),
      reedMap: toClampTex(reedCard),
      fernMap: toClampTex(fernCard),
      boughMap: toClampTex(boughCard),
      pineMap: toRepeatTex(pineCol, 2, 4),
      pineBump: toRepeatTex(pineBump, 2, 4),
      birchMap: toRepeatTex(birchCol, 1, 2),
      cabinWallMap: toClampTex(cabinWall),
      churchWallMap: toClampTex(churchWall),
      barnPlankMap: toRepeatTex(barnPlanks, 2, 1),
      roofMap: toRepeatTex(roofTex, 3, 2),
      roadMap: toRepeatTex(roadCol, 1, 3),
      rustMap: toRepeatTex(rustCol, 2, 2),
      glowMap: toClampTex(glowCanvas)
    };
  }

  return { buildAll };
})();
