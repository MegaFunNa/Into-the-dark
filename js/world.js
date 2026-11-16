window.HorrorWorld = (function () {
  const TILE_SIZE = 32.0;
  const TILES_X_RADIUS = 2;
  const TILES_Z_AHEAD = 4;
  const TILES_Z_BEHIND = 1;
  const ROW_SPACING = 1.88; // Crisp agricultural row spacing (wide readable open aisles between rows!)

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hash2i(ix, iz, seed) {
    let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function valueNoise2D(x, z, seed) {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fz = z - iz;
    const ux = fx * fx * (3 - 2 * fx);
    const uz = fz * fz * (3 - 2 * fz);
    const a = hash2i(ix, iz, seed);
    const b = hash2i(ix + 1, iz, seed);
    const c = hash2i(ix, iz + 1, seed);
    const d = hash2i(ix + 1, iz + 1, seed);
    return (a + (b - a) * ux) * (1 - uz) + (c + (d - c) * ux) * uz;
  }

  class WorldManager {
    constructor(scene, textures, opts = {}) {
      this.scene = scene;
      this.tex = textures;
      this.mobilePerf = Boolean(opts && opts.mobile);
      this.tilesXRadius = this.mobilePerf ? 1 : TILES_X_RADIUS;
      this.tilesZAhead = this.mobilePerf ? 2 : TILES_Z_AHEAD;
      this.tilesZBehind = TILES_Z_BEHIND;
      this.terrainSegs = this.mobilePerf ? 12 : 20;
      this.tiles = new Map();
      this.pendingQueue = [];
      this.terrainPool = [];
      this.biomeSequence = [];
      this.runSeed = Math.floor(Math.random() * 100000);
      this.time = 0;

      this._buildSharedAssets();
      this._initTerrainPool(this.mobilePerf ? 18 : 42);
      this._rebuildBiomeSequence();
    }

    // Build a long non-repeating shuffled deck of all 9 biomes where fields are spaced far apart!
    _rebuildBiomeSequence() {
      const rand = mulberry32(this.runSeed + 555);
      // 0:Taiga, 1:HempRows, 2:RailwayBoxcars, 3:DeadSwamp, 4:Sawmill, 5:CornRowsBarn, 6:HeliCrashHighway, 7:ScorchedWoods, 8:TownHallVillage
      // Start: Taiga -> Railway -> HempRows -> TownHallVillage -> HeliCrashHighway -> DeadSwamp -> Sawmill -> CornRowsBarn -> ScorchedWoods
      this.biomeSequence = [0, 2, 1, 8, 6, 3, 4, 5, 7];
      // Append 40 more non-repeating shuffled chapters (fields 1 & 5 separated by at least 4 non-field zones!)
      const nonFields = [0, 2, 3, 4, 6, 7, 8];
      const fields = [1, 5];
      let fIdx = 0;
      for (let pack = 0; pack < 8; pack++) {
        const copy = nonFields.slice();
        for (let i = copy.length - 1; i > 0; i--) {
          const j = Math.floor(rand() * (i + 1));
          const tmp = copy[i]; copy[i] = copy[j]; copy[j] = tmp;
        }
        if (copy[0] === this.biomeSequence[this.biomeSequence.length - 1]) {
          const t = copy[0]; copy[0] = copy[1]; copy[1] = t;
        }
        // Insert 1 field once every 5 non-field zones so fields feel rare & special!
        this.biomeSequence.push(copy[0], copy[1], copy[2], fields[fIdx % 2], copy[3], copy[4], copy[5]);
        fIdx++;
      }
    }

    roadCenterX(wz) {
      const s = (this.runSeed % 997) * 0.01;
      return Math.sin(wz * 0.013 + s) * 28.0 + Math.cos(wz * 0.006 - s * 1.6) * 18.0;
    }

    isNearRoad(wx, wz, margin = 4.4) {
      return Math.abs(wx - this.roadCenterX(wz)) < margin;
    }

    /**
     * 9 Large Non-Repeating Biomes + Biome 9 = Wide Open Finale Meadow (`wz < -2960 .. -3152`)
     */
    zoneAt(wx, wz) {
      if (wz < -2960.0 && wz > -3152.0) return 9;
      if (wz > -22.0 && Math.abs(wx) < 24.0) return 0;
      const chapZ = Math.max(0, Math.floor((-wz + 10.0) / 64.0));
      const latBand = Math.floor((wx + 48.0) / 96.0);
      const seqIdx = Math.abs(chapZ + latBand * 3) % this.biomeSequence.length;
      return this.biomeSequence[seqIdx];
    }

    terrainHeight(wx, wz) {
      const startBlend = Math.min(1.0, (wx * wx + wz * wz) / 350.0);
      const zone = this.zoneAt(wx, wz);
      // Smooth open meadow in Finale Field (zone 9), flatter soil in fields (1 & 5) and swamp (3)
      const ampScale = zone === 9 ? 0.16 : (zone === 1 || zone === 5) ? 0.32 : zone === 3 ? 0.25 : 1.0;
      const h1 = (valueNoise2D(wx * 0.020, wz * 0.020, this.runSeed + 11) - 0.5) * 2.4 * ampScale;
      const h2 = (valueNoise2D(wx * 0.060, wz * 0.060, this.runSeed + 23) - 0.5) * 0.55 * ampScale;

      // Subtle agricultural soil furrow ridges along rows in Hemp (1) & Corn (5) fields!
      let furrow = 0;
      if ((zone === 1 || zone === 5) && !this.isNearRoad(wx, wz, 5.0)) {
        furrow = Math.cos((wx / ROW_SPACING) * Math.PI * 2) * 0.055;
      }

      let rawH = (h1 + h2 + furrow) * startBlend;

      if (zone !== 9) {
        const roadDist = Math.abs(wx - this.roadCenterX(wz));
        if (roadDist < 9.0) {
          const roadH = (valueNoise2D(0, wz * 0.018, this.runSeed + 11) - 0.5) * 1.1 * startBlend;
          const t = Math.max(0, Math.min(1, (roadDist - 3.8) / 5.2));
          const smoothT = t * t * (3 - 2 * t);
          rawH = roadH * (1 - smoothT) + rawH * smoothT;
        }
      }
      return rawH;
    }

    // Returns exact physical crop stalk contact ONLY inside row-planted Hemp (zone 1) & Corn (zone 5) fields!
    // Returns contact = 0 everywhere outside fields, on roads, in barn interiors, and in open dirt aisles between rows!
    getCropRustleAt(px, pz) {
      if (this.isNearRoad(px, pz, 4.1)) {
        return { contact: 0, kind: null, stalkCellZ: 0, rowK: 0, rowSide: 0 };
      }
      const zone = this.zoneAt(px, pz);
      if (zone !== 1 && zone !== 5) {
        return { contact: 0, kind: null, stalkCellZ: 0, rowK: 0, rowSide: 0 };
      }

      // Check if inside cleared Barn interior in Cornfield (zone 5)
      const cx = Math.floor(px / TILE_SIZE);
      const cz = Math.floor(pz / TILE_SIZE);
      const curTile = this.tiles.get(`${cx},${cz}`);
      if (curTile) {
        for (const ob of curTile.obstacles) {
          if (ob.type === "box" && ob.hz > 4.5 && Math.abs(px - ob.x) < 4.2 && Math.abs(pz - ob.z) < 5.2) {
            return { contact: 0, kind: null, stalkCellZ: 0, rowK: 0, rowSide: 0 };
          }
        }
      }

      // Row centers are at rowX = rowK * ROW_SPACING; stalks are spaced every 1.25m along Z!
      const rowK = Math.round(px / ROW_SPACING);
      const rowX = rowK * ROW_SPACING;
      const distToRow = Math.abs(px - rowX);
      const touchRadius = zone === 1 ? 0.62 : 0.58; // Leafy stalk canopy radius around each row

      if (distToRow >= touchRadius) {
        // Player is running down the open dirt aisle between two rows without touching plants!
        return { contact: 0, kind: null, stalkCellZ: Math.floor(-pz / 1.25), rowK, rowSide: px >= rowX ? 1 : -1 };
      }

      const contact = Math.pow(1.0 - distToRow / touchRadius, 0.55);
      const stalkCellZ = Math.floor(-pz / 1.25);
      const rowSide = px >= rowX ? 1 : -1;
      return { contact, kind: zone === 1 ? "hemp" : "corn", stalkCellZ, rowK, rowSide };
    }

    // Exact barycentric height of the rendered PlaneGeometry ground mesh at (wx, wz) —
    // guarantees grass, ferns, reeds & crops sit 100.0% flush on the actual ground triangles (zero floating/sinking)!
    terrainSurfaceHeight(wx, wz) {
      const segs = this.terrainSegs || 20;
      const cell = TILE_SIZE / segs;
      const cx = Math.floor(wx / TILE_SIZE);
      const cz = Math.floor(wz / TILE_SIZE);
      const wx0 = cx * TILE_SIZE;
      const wz0 = cz * TILE_SIZE;

      const gx = Math.max(0, Math.min(segs - 1e-5, (wx - wx0) / cell));
      const gz = Math.max(0, Math.min(segs - 1e-5, (wz - wz0) / cell));
      const ix = Math.floor(gx);
      const iz = Math.floor(gz);
      const fx = gx - ix;
      const fz = gz - iz;

      const x0 = wx0 + ix * cell, x1 = x0 + cell;
      const z0 = wz0 + iz * cell, z1 = z0 + cell;

      const ha = this.terrainHeight(x0, z0);
      const hb = this.terrainHeight(x0, z1);
      const hc = this.terrainHeight(x1, z1);
      const hd = this.terrainHeight(x1, z0);

      // Matches THREE.PlaneGeometry quad diagonal (b—d): (a,b,d) for fx+fz <= 1, (b,c,d) for fx+fz > 1
      if (fx + fz <= 1.0) {
        return ha + fx * (hd - ha) + fz * (hb - ha);
      }
      return hc + (1.0 - fx) * (hb - hc) + (1.0 - fz) * (hd - hc);
    }

    _initTerrainPool(count) {
      const segs = this.terrainSegs || 20;
      for (let i = 0; i < count; i++) {
        const geo = new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE, segs, segs);
        geo.rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(geo, this.matGround);
        mesh.receiveShadow = !this.mobilePerf;
        this.terrainPool.push(mesh);
      }
    }

    _acquireTerrainMesh(centerX, centerZ) {
      let mesh = this.terrainPool.pop();
      if (!mesh) {
        const segs = this.terrainSegs || 20;
        const geo = new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE, segs, segs);
        geo.rotateX(-Math.PI / 2);
        mesh = new THREE.Mesh(geo, this.matGround);
        mesh.receiveShadow = !this.mobilePerf;
      }
      const gp = mesh.geometry.attributes.position;
      for (let i = 0; i < gp.count; i++) {
        const vx = centerX + gp.getX(i);
        const vz = centerZ + gp.getZ(i);
        gp.setY(i, this.terrainHeight(vx, vz));
      }
      gp.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
      return mesh;
    }

    _mergeGeos(geos) {
      const pos = [], norm = [], uv = [], idx = [];
      let vOff = 0;
      for (const g of geos) {
        const gp = g.attributes.position;
        const gn = g.attributes.normal;
        const gu = g.attributes.uv;
        for (let i = 0; i < gp.count; i++) {
          pos.push(gp.getX(i), gp.getY(i), gp.getZ(i));
          norm.push(gn ? gn.getX(i) : 0, gn ? gn.getY(i) : 1, gn ? gn.getZ(i) : 0);
          uv.push(gu ? gu.getX(i) : 0, gu ? gu.getY(i) : 0);
        }
        const gi = g.index;
        if (gi) {
          for (let i = 0; i < gi.count; i++) idx.push(vOff + gi.getX(i));
        } else {
          for (let i = 0; i < gp.count; i++) idx.push(vOff + i);
        }
        vOff += gp.count;
      }
      const out = new THREE.BufferGeometry();
      out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      out.setAttribute("normal", new THREE.Float32BufferAttribute(norm, 3));
      out.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      out.setIndex(idx);
      return out;
    }

    _box(w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
      const g = new THREE.BoxGeometry(w, h, d);
      if (rx) g.rotateX(rx);
      if (ry) g.rotateY(ry);
      if (rz) g.rotateZ(rz);
      g.translate(x, y, z);
      return g;
    }

    _cyl(rt, rb, h, segs, x, y, z, rx = 0, ry = 0, rz = 0) {
      const g = new THREE.CylinderGeometry(rt, rb, h, segs);
      if (rx) g.rotateX(rx);
      if (ry) g.rotateY(ry);
      if (rz) g.rotateZ(rz);
      g.translate(x, y, z);
      return g;
    }

    // Builds a cohesive, high-detail Soviet Mi-8MTV Transport Helicopter in upright symmetric local coordinates (+Z = nose),
    // split cleanly by material (paint hull, faded sky-blue belly/stripes, dark cockpit glass, charred metal/rotors/tires)
    // so tilting the assembled THREE.Group on the crash site keeps EVERY window, engine, wheel, and rotor blade 100% aligned!
    _buildDetailedHelicopterGeos() {
      const hullParts = [];
      const bellyParts = [];
      const glassParts = [];
      const darkParts = [];

      // Helper: build lofted cross-section shell along Z
      const loftZ = (rings, segs = 18, flatBottom = 0.72) => {
        const pos = [], uvs = [], idx = [];
        for (let r = 0; r < rings.length; r++) {
          const R = rings[r];
          for (let s = 0; s <= segs; s++) {
            const u = s / segs;
            const a = u * Math.PI * 2;
            let px = (R.cx || 0) + Math.cos(a) * R.rx;
            let py = Math.sin(a) * R.ry;
            if (py < -R.ry * flatBottom) py = -R.ry * (flatBottom + 0.03);
            pos.push(px, R.cy + py, R.z);
            uvs.push(u * 3.0, r * 0.42);
          }
        }
        const row = segs + 1;
        for (let r = 0; r < rings.length - 1; r++) {
          for (let s = 0; s < segs; s++) {
            const a = r * row + s, b = a + 1, c = a + row, d = c + 1;
            idx.push(a, b, c, b, d, c);
          }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
        g.setIndex(idx);
        g.computeVertexNormals();
        return g;
      };

      // 1. Sculpted Mi-8 Fuselage + Rounded Glazed Nose + Rear Clamshell Doors + High Tailboom
      const fuseRings = [
        { z:  4.44, rx: 0.12, ry: 0.12, cy: 1.12 }, // Radome tip
        { z:  4.24, rx: 0.58, ry: 0.50, cy: 1.16 }, // Rounded lower nose
        { z:  3.75, rx: 0.96, ry: 0.82, cy: 1.28 }, // Glazed chin & lower nose
        { z:  3.05, rx: 1.18, ry: 1.08, cy: 1.46 }, // Upper cockpit canopy crown
        { z:  2.20, rx: 1.26, ry: 1.18, cy: 1.52 }, // Forward troop cabin
        { z:  0.20, rx: 1.27, ry: 1.18, cy: 1.52 }, // Mid cargo fuselage
        { z: -1.55, rx: 1.22, ry: 1.14, cy: 1.54 }, // Rear cargo frame
        { z: -2.85, rx: 0.76, ry: 0.78, cy: 1.78 }, // Clamshell cargo doors taper
        { z: -3.55, rx: 0.42, ry: 0.44, cy: 2.06 }, // Sturdy tailboom root
        { z: -6.10, rx: 0.31, ry: 0.33, cy: 2.22 }, // Mid tailboom
        { z: -8.35, rx: 0.22, ry: 0.24, cy: 2.36 }, // Tailboom tip
        { z: -8.55, rx: 0.07, ry: 0.08, cy: 2.37 }
      ];
      hullParts.push(loftZ(fuseRings, 24, 0.72));

      // Helper: exact fuselage surface point & conformal curved shell patch (`th=0` top +Y, `th=+PI/2` +X, `th=PI` bottom -Y)
      // Guarantees ZERO polygon clipping on curved cockpit glass panes & sky-blue belly!
      const interpFuse = (z) => {
        if (z >= fuseRings[0].z) return fuseRings[0];
        if (z <= fuseRings[fuseRings.length - 1].z) return fuseRings[fuseRings.length - 1];
        for (let i = 0; i < fuseRings.length - 1; i++) {
          const A = fuseRings[i], B = fuseRings[i + 1];
          if (z <= A.z && z >= B.z) {
            const u = (A.z - z) / (A.z - B.z);
            return {
              rx: A.rx + (B.rx - A.rx) * u,
              ry: A.ry + (B.ry - A.ry) * u,
              cy: A.cy + (B.cy - A.cy) * u
            };
          }
        }
        return fuseRings[4];
      };
      const buildConformalPatch = (z0, z1, th0, th1, outOff = 0.016, nz = 5, nth = 5) => {
        const pos = [], uvs = [], idx = [];
        for (let iz = 0; iz <= nz; iz++) {
          const uz = iz / nz;
          const z = z0 + (z1 - z0) * uz;
          const F = interpFuse(z);
          for (let it = 0; it <= nth; it++) {
            const ut = it / nth;
            const th = th0 + (th1 - th0) * ut;
            const sx = Math.sin(th), cyRaw = Math.cos(th);
            let py = cyRaw * (F.ry + outOff);
            if (py < -(F.ry + outOff) * 0.72) py = -(F.ry + outOff) * 0.75;
            const px = sx * (F.rx + outOff);
            pos.push(px, F.cy + py, z);
            uvs.push(ut, uz);
          }
        }
        const row = nth + 1;
        for (let iz = 0; iz < nz; iz++) {
          for (let it = 0; it < nth; it++) {
            const a = iz * row + it, b = a + 1, c = a + row, d = c + 1;
            idx.push(a, b, c, b, d, c);
          }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
        g.setIndex(idx);
        g.computeVertexNormals();
        return g;
      };

      // Conformal Soviet sky-blue underbelly shell (hugs curved lower belly cleanly — NO boxy slab!) + tailboom bands
      bellyParts.push(
        buildConformalPatch(3.85, -2.55, 2.22, Math.PI * 2 - 2.22, 0.009, 10, 10),
        this._cyl(0.35, 0.34, 0.24, 16, 0, 2.20, -5.25, Math.PI * 0.5, 0, 0),
        this._cyl(0.34, 0.33, 0.16, 16, 0, 2.22, -5.65, Math.PI * 0.5, 0, 0)
      );

      // 2. Sculpted Twin Klimov TV3-117 Turbine Engine Nacelle Deck + PZU Dust Domes + Side Exhausts
      hullParts.push(
        loftZ([
          { z:  2.52, rx: 0.74, ry: 0.26, cy: 2.74 },
          { z:  1.95, rx: 0.84, ry: 0.36, cy: 2.82 },
          { z:  0.45, rx: 0.82, ry: 0.38, cy: 2.84 },
          { z: -1.05, rx: 0.56, ry: 0.28, cy: 2.72 },
          { z: -1.65, rx: 0.22, ry: 0.14, cy: 2.52 }
        ], 14, 0.85),
        this._cyl(0.30, 0.33, 0.95, 12, -0.37, 2.82, 2.18, Math.PI * 0.5, 0, 0),
        this._cyl(0.30, 0.33, 0.95, 12,  0.37, 2.82, 2.18, Math.PI * 0.5, 0, 0),
        this._cyl(0.22, 0.26, 0.85, 10,  0.00, 3.06, -0.35, Math.PI * 0.5, 0, 0),
        this._cyl(0.03, 0.14, 0.26, 10, -0.37, 2.82, 2.66, Math.PI * 0.5, 0, 0),
        this._cyl(0.03, 0.14, 0.26, 10,  0.37, 2.82, 2.66, Math.PI * 0.5, 0, 0),
        this._box(0.15, 0.14, 4.75, 0, 2.52, -5.85, -0.062, 0, 0)
      );
      darkParts.push(
        this._cyl(0.26, 0.26, 0.14, 12, -0.37, 2.82, 2.60, Math.PI * 0.5, 0, 0),
        this._cyl(0.26, 0.26, 0.14, 12,  0.37, 2.82, 2.60, Math.PI * 0.5, 0, 0),
        this._cyl(0.21, 0.19, 0.52, 10, -0.82, 2.76, 0.65, 0, 0.22,  Math.PI * 0.42),
        this._cyl(0.21, 0.19, 0.52, 10,  0.82, 2.76, 0.65, 0, -0.22, -Math.PI * 0.42)
      );

      // 3. Conformal Multi-Pane Mi-8 Greenhouse Cockpit Glazing (ZERO jagged clipping!) + Framed Round Portholes!
      // 5 curved upper pilot windshield panes separated by olive-drab metal frames (`0.07 rad` gaps)
      for (const [t0, t1] of [[-1.12, -0.70], [-0.62, -0.21], [-0.14, 0.14], [0.21, 0.62], [0.70, 1.12]]) {
        glassParts.push(buildConformalPatch(3.86, 2.92, t0, t1, 0.016, 5, 4));
      }
      // 4 curved lower chin navigator glazing panels (`носовое остекление штурмана Ми-8`)
      for (const [t0, t1] of [[-2.45, -1.85], [-1.76, -1.30], [1.30, 1.76], [1.85, 2.45]]) {
        glassParts.push(buildConformalPatch(4.20, 3.62, t0, t1, 0.016, 4, 4));
      }
      // Conformal side pilot sliding windows (`z = 2.85..2.32`)
      glassParts.push(
        buildConformalPatch(2.84, 2.34, -1.48, -1.04, 0.016, 4, 4),
        buildConformalPatch(2.84, 2.34,  1.04,  1.48, 0.016, 4, 4)
      );

      // 5 cleanly framed round cabin portholes on each side (sitting cleanly proud of `rx = 1.27` -> 100% crisp circles!)
      for (const zP of [1.82, 1.05, 0.28, -0.48, -1.24]) {
        hullParts.push(this._cyl(0.22, 0.22, 0.04, 14, -1.275, 1.62, zP, 0, 0, Math.PI * 0.5));
        glassParts.push(this._cyl(0.175, 0.175, 0.05, 14, -1.285, 1.62, zP, 0, 0, Math.PI * 0.5));
        if (zP < 0.45 || zP > 1.70) {
          hullParts.push(this._cyl(0.22, 0.22, 0.04, 14, 1.275, 1.62, zP, 0, 0, Math.PI * 0.5));
          glassParts.push(this._cyl(0.175, 0.175, 0.05, 14, 1.285, 1.62, zP, 0, 0, Math.PI * 0.5));
        }
      }
      // Open port-side sliding cargo doorway (`+X` side only!) + slid-back exterior cargo door
      darkParts.push(this._box(0.06, 1.18, 0.94, 1.255, 1.42, 1.06));
      hullParts.push(
        this._box(0.06, 1.22, 0.96, 1.32, 1.42, 0.02),
        this._box(0.05, 0.05, 2.08, 1.30, 2.05, 0.54)
      );

      // 4. Swept Tail Fin + Tail Rotor Pylon + Horizontal Stabilizers + 3-Blade Tail Rotor + Tail Skid
      hullParts.push(
        this._box(0.16, 1.98, 1.08, 0, 3.18, -8.08, -0.38, 0, 0),
        this._box(2.35, 0.08, 0.48, 0, 2.30, -7.30),
        this._cyl(0.12, 0.15, 0.40, 10, 0.25, 3.92, -8.46, 0, 0, Math.PI * 0.5),
        this._box(0.06, 0.62, 0.09, 0, 1.90, -7.85, 0.48, 0, 0)
      );
      for (let tb = 0; tb < 3; tb++) {
        const ta = (tb / 3) * Math.PI * 2 + 0.35;
        const rMid = 0.68;
        darkParts.push(
          this._box(0.04, 1.34, 0.14, 0.44, 3.92 + Math.cos(ta) * rMid, -8.46 + Math.sin(ta) * rMid, ta, 0, 0)
        );
      }

      // 5. Sponsons, Cylindrical External Fuel Tanks (PTB) & Tricycle Wheeled Landing Gear
      for (const sx of [-1, 1]) {
        // Cylindrical external fuel tank (`ПТБ`) + nose/tail caps + mounting straps
        hullParts.push(
          this._cyl(0.36, 0.36, 2.48, 14, sx * 1.48, 0.88, 0.28, Math.PI * 0.5, 0, 0),
          this._cyl(0.10, 0.36, 0.34, 12, sx * 1.48, 0.88, 1.68, Math.PI * 0.5, 0, 0),
          this._cyl(0.36, 0.10, 0.34, 12, sx * 1.48, 0.88, -1.12, Math.PI * 0.5, 0, 0),
          this._box(0.45, 0.12, 1.65, sx * 1.25, 0.92, 0.28)
        );
        // Triangulated main landing gear struts + main wheels
        darkParts.push(
          this._cyl(0.055, 0.065, 1.15, 8, sx * 1.48, 0.78, -0.05, 0, 0, sx * 0.42),
          this._cyl(0.048, 0.055, 1.05, 8, sx * 1.45, 0.48,  0.32, 0.48, 0, sx * 0.48),
          this._cyl(0.44, 0.44, 0.30, 14, sx * 1.76, 0.42, -0.08, 0, 0, Math.PI * 0.5)
        );
        bellyParts.push(
          this._cyl(0.20, 0.20, 0.33, 10, sx * 1.76, 0.42, -0.08, 0, 0, Math.PI * 0.5)
        );
      }
      // Twin-wheel nose landing gear under cockpit
      darkParts.push(
        this._cyl(0.055, 0.065, 0.72, 8, 0, 0.62, 3.42, -0.18, 0, 0),
        this._cyl(0.28, 0.28, 0.14, 12, -0.14, 0.28, 3.48, 0, 0, Math.PI * 0.5),
        this._cyl(0.28, 0.28, 0.14, 12,  0.14, 0.28, 3.48, 0, 0, Math.PI * 0.5)
      );

      // 6. Main Rotor Mast, Swashplate, 5-Arm Star Hub & 5 Tapered Drooping/Snapped Airfoil Rotor Blades!
      const hubY = 3.48, hubZ = 0.55;
      darkParts.push(
        this._cyl(0.22, 0.30, 0.62, 12, 0, 3.16, hubZ),
        this._cyl(0.32, 0.32, 0.10, 12, 0, 3.30, hubZ),
        this._cyl(0.26, 0.22, 0.22, 10, 0, hubY, hubZ)
      );
      for (let b = 0; b < 5; b++) {
        const ba = (b / 5) * Math.PI * 2 + 0.38;
        const snapped = (b === 1);
        const grounded = (b === 3);
        const totalSpan = snapped ? 2.15 : 5.65;
        const segCount = snapped ? 3 : 5;
        const segLen = totalSpan / segCount;

        // Build segmented drooping blade cleanly along +X, then rotate around Y by `ba`!
        let curR = 0.30;
        let curY = hubY;
        for (let s = 0; s < segCount; s++) {
          const frac = (s + 0.5) / 5.0;
          const droopAngle = snapped ? (-0.06 - frac * 0.08) : grounded ? (-0.14 - frac * 0.34) : (-0.07 - frac * 0.20);
          const chord = 0.34 * (1.0 - frac * 0.18);
          const nextR = curR + Math.cos(droopAngle) * segLen;
          const nextY = curY + Math.sin(droopAngle) * segLen;
          const midR = 0.5 * (curR + nextR);
          const midY = 0.5 * (curY + nextY);

          const bladeSeg = new THREE.BoxGeometry(segLen * 1.03, 0.042, chord);
          bladeSeg.rotateX(0.10); // Subtle collective pitch
          bladeSeg.rotateZ(droopAngle);
          bladeSeg.translate(midR, midY, 0);
          bladeSeg.rotateY(ba);
          bladeSeg.translate(0, 0, hubZ);
          darkParts.push(bladeSeg);

          curR = nextR;
          curY = nextY;
        }
      }

      this.heliGeos = {
        hull: this._mergeGeos(hullParts),
        belly: this._mergeGeos(bellyParts),
        glass: this._mergeGeos(glassParts),
        dark: this._mergeGeos(darkParts)
      };
    }

    createCrashedHelicopter(withFire = false) {
      const g = new THREE.Group();
      g.userData.isHeli = true;
      g.add(
        new THREE.Mesh(this.heliGeos.hull, this.matHeliPaint),
        new THREE.Mesh(this.heliGeos.belly, this.matHeliBelly),
        new THREE.Mesh(this.heliGeos.glass, this.matVehicleGlass),
        new THREE.Mesh(this.heliGeos.dark, this.matHeliRotorDark)
      );

      if (withFire) {
        const fireRoot = new THREE.Group();
        const matCore = new THREE.MeshBasicMaterial({
          color: 0xfff0a8, transparent: true, opacity: 0.96, fog: false,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
        });
        const matFlameInner = new THREE.MeshBasicMaterial({
          color: 0xff8a1e, transparent: true, opacity: 0.88, fog: false,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
        });
        const matFlameOuter = new THREE.MeshBasicMaterial({
          color: 0xe63900, transparent: true, opacity: 0.72, fog: false,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
        });
        const matEmberGround = new THREE.MeshBasicMaterial({
          color: 0xff5208, transparent: true, opacity: 0.56, fog: false,
          blending: THREE.AdditiveBlending, depthWrite: false
        });
        const matSmokeLit = new THREE.MeshBasicMaterial({
          color: 0x3b1b0f, transparent: true, opacity: 0.40, depthWrite: false
        });
        const matSmokeDark = new THREE.MeshBasicMaterial({
          color: 0x0b0807, transparent: true, opacity: 0.48, depthWrite: false
        });

        // Scorched molten ember glow around fuselage & ruptured engine cowling
        const emberDisc = new THREE.Mesh(new THREE.CircleGeometry(3.4, 18), matEmberGround);
        emberDisc.rotation.x = -Math.PI * 0.5;
        emberDisc.position.set(0.15, 0.22, 0.55);
        fireRoot.add(emberDisc);

        const flames = [];
        const flameSpots = [
          // Main roaring engine/rotor-mast fire (high & visible from 80m+ across the open field!)
          { x:  0.05, y: 2.35, z:  0.45, r: 0.92, h: 2.85, phase: 0.0 },
          { x: -0.42, y: 1.95, z:  1.15, r: 0.76, h: 2.30, phase: 1.3 },
          { x:  0.58, y: 1.72, z: -0.25, r: 0.72, h: 2.15, phase: 2.4 },
          // Side cabin door & spilled fuel ground fires
          { x: -1.18, y: 0.52, z:  0.85, r: 0.68, h: 1.75, phase: 3.7 },
          { x:  1.25, y: 0.44, z:  1.55, r: 0.58, h: 1.48, phase: 4.9 },
          { x: -0.35, y: 1.35, z: -2.35, r: 0.52, h: 1.55, phase: 5.8 }
        ];

        for (const fs of flameSpots) {
          const fg = new THREE.Group();
          fg.position.set(fs.x, fs.y, fs.z);
          const outerCone = new THREE.Mesh(new THREE.ConeGeometry(fs.r, fs.h, 7, 1, true), matFlameOuter);
          outerCone.position.y = fs.h * 0.45;
          const innerCone = new THREE.Mesh(new THREE.ConeGeometry(fs.r * 0.68, fs.h * 0.78, 7, 1, true), matFlameInner);
          innerCone.position.y = fs.h * 0.36;
          innerCone.rotation.y = 0.45;
          const coreSphere = new THREE.Mesh(new THREE.SphereGeometry(fs.r * 0.46, 8, 6), matCore);
          coreSphere.position.y = fs.r * 0.32;
          fg.add(outerCone, innerCone, coreSphere);
          fireRoot.add(fg);
          flames.push({ group: fg, outerCone, innerCone, coreSphere, baseY: fs.y, phase: fs.phase });
        }

        // Tall rising smoke column (`3m .. 13.5m` high) so the burning wreck silhouettes against the night sky from afar
        const smokePuffs = [];
        for (let i = 0; i < 8; i++) {
          const smMat = i < 3 ? matSmokeLit : matSmokeDark;
          const puff = new THREE.Mesh(new THREE.DodecahedronGeometry(1.05, 1), smMat);
          fireRoot.add(puff);
          smokePuffs.push({ mesh: puff, idx: i });
        }

        // Localized flickering orange wreckage PointLight (lights only the wreck & immediate ~14m scorched ground, leaving the surrounding field pitch-dark!)
        const fireLight = new THREE.PointLight(0xff681a, 2.25, 20.5, 2.0);
        fireLight.position.set(0.0, 3.1, 1.0);
        fireRoot.add(fireLight);

        g.add(fireRoot);
        g.userData.fireRig = { fireRoot, flames, smokePuffs, fireLight, emberDisc };
      }

      return g;
    }

    updateHelicopterFire(heli, time) {
      if (!heli || !heli.userData || !heli.userData.fireRig) return;
      const rig = heli.userData.fireRig;
      const flicker = 0.84 + 0.16 * Math.sin(time * 23.0) * Math.cos(time * 14.7) + 0.09 * Math.sin(time * 41.0);
      rig.fireLight.intensity = 2.25 * flicker;
      rig.emberDisc.scale.setScalar(0.95 + 0.08 * Math.sin(time * 17.0));

      for (const fl of rig.flames) {
        const s1 = Math.sin(time * 16.5 + fl.phase);
        const s2 = Math.cos(time * 27.0 + fl.phase * 1.7);
        fl.group.scale.set(0.88 + 0.18 * s1, 0.82 + 0.32 * Math.abs(s2), 0.88 - 0.14 * s1);
        fl.group.rotation.z = s1 * 0.14;
        fl.group.rotation.x = s2 * 0.10;
        fl.innerCone.rotation.y += 0.05;
      }

      for (const sp of rig.smokePuffs) {
        const u = (time * 0.24 + sp.idx / rig.smokePuffs.length) % 1.0;
        sp.mesh.position.set(
          0.15 + Math.sin(time * 0.9 + sp.idx * 1.4) * (0.45 + u * 1.8) + u * 1.6,
          2.6 + u * 11.2,
          0.55 - u * 1.2
        );
        sp.mesh.scale.setScalar(0.85 + u * 2.45);
        sp.mesh.rotation.y = time * 0.35 + sp.idx;
      }
    }

    // Builds TWO detailed, iconic 1990s Russian vehicles:
    // Variant 0: VAZ-2106 "Zhiguli" Classic Sedan (quad round headlights, chrome bumpers, sloped pillars, wheel arches)
    // Variant 1: UAZ-452 "Bukhanka" Off-Road Forest Van (rounded loaf body, roof rack, rear spare wheel, split windshield)
    _buildDetailedCarGeos() {
      const makeWheel = (partsDark, partsChrome, x, y, z, rTire, width, rRim) => {
        partsDark.push(this._cyl(rTire, rTire, width, 14, x, y, z, 0, 0, Math.PI * 0.5));
        partsChrome.push(
          this._cyl(rRim, rRim, width + 0.02, 12, x, y, z, 0, 0, Math.PI * 0.5),
          this._cyl(rRim * 0.48, rRim * 0.48, width + 0.045, 10, x, y, z, 0, 0, Math.PI * 0.5)
        );
      };

      // Helper: build symmetric 8-point octagonal/rectangular car cross-section loft along Z!
      // Each station: { z, wBot, yBot, wBelt, yBelt, wTop, yTop }
      const buildAutoBodyLoft = (stations) => {
        const pos = [], uvs = [], idx = [];
        const ptsPerRing = 9; // Closed loop of 8 perimeter vertices
        for (let i = 0; i < stations.length; i++) {
          const S = stations[i];
          const ringPts = [
            [-S.wBot * 0.86, S.yBot],
            [-S.wBot,        S.yBot + 0.10],
            [-S.wBelt,       S.yBelt],
            [-S.wTop,        S.yTop],
            [ S.wTop,        S.yTop],
            [ S.wBelt,       S.yBelt],
            [ S.wBot,        S.yBot + 0.10],
            [ S.wBot * 0.86, S.yBot],
            [-S.wBot * 0.86, S.yBot]
          ];
          for (let p = 0; p < ptsPerRing; p++) {
            pos.push(ringPts[p][0], ringPts[p][1], S.z);
            uvs.push(p / 4.0, i * 0.35);
          }
        }
        for (let i = 0; i < stations.length - 1; i++) {
          for (let p = 0; p < ptsPerRing - 1; p++) {
            const a = i * ptsPerRing + p;
            const b = a + 1;
            const c = a + ptsPerRing;
            const d = c + 1;
            idx.push(a, b, c, b, d, c);
          }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
        g.setIndex(idx);
        g.computeVertexNormals();
        return g;
      };

      // =======================================================================
      // VARIANT 0: VAZ-2106 "ZHIGULI" CLASSIC 1990s SOVIET SEDAN
      // =======================================================================
      {
        const body = [], glass = [], dark = [], chrome = [], lights = [];

        // 3-Box sculpted sedan shell with realistic tumblehome (`wTop = 0.66 < wBelt = 0.83`)!
        body.push(buildAutoBodyLoft([
          { z:  2.08, wBot: 0.72, yBot: 0.36, wBelt: 0.76, yBelt: 0.72, wTop: 0.70, yTop: 0.78 }, // Nose grille edge
          { z:  1.96, wBot: 0.78, yBot: 0.32, wBelt: 0.83, yBelt: 0.80, wTop: 0.76, yTop: 0.84 }, // Front fenders
          { z:  0.86, wBot: 0.80, yBot: 0.30, wBelt: 0.85, yBelt: 0.85, wTop: 0.79, yTop: 0.88 }, // Base of windshield (cowl)
          { z:  0.42, wBot: 0.80, yBot: 0.30, wBelt: 0.85, yBelt: 0.86, wTop: 0.67, yTop: 1.41 }, // Top of A-pillar / front roof
          { z: -0.68, wBot: 0.80, yBot: 0.30, wBelt: 0.85, yBelt: 0.87, wTop: 0.66, yTop: 1.40 }, // Top of C-pillar / rear roof
          { z: -1.14, wBot: 0.79, yBot: 0.32, wBelt: 0.84, yBelt: 0.87, wTop: 0.77, yTop: 0.89 }, // Base of rear glass / trunk
          { z: -2.02, wBot: 0.76, yBot: 0.35, wBelt: 0.81, yBelt: 0.83, wTop: 0.74, yTop: 0.85 }, // Rear tail panel
          { z: -2.09, wBot: 0.70, yBot: 0.40, wBelt: 0.74, yBelt: 0.76, wTop: 0.68, yTop: 0.78 }
        ]));

        // Front & rear end-caps, hood power bulge, wheel-arch flares, B-pillars
        body.push(
          this._box(1.46, 0.40, 0.08, 0, 0.56,  2.05),
          this._box(1.46, 0.42, 0.08, 0, 0.60, -2.05),
          this._box(1.06, 0.04, 1.02, 0, 0.865, 1.40, 0.03, 0, 0)
        );
        for (const sx of [-1, 1]) {
          // Tucked wheel arch lips & B-pillar post
          body.push(
            this._cyl(0.35, 0.35, 0.07, 12, sx * 0.78, 0.34,  1.28, 0, 0, Math.PI * 0.5),
            this._cyl(0.35, 0.35, 0.07, 12, sx * 0.78, 0.34, -1.24, 0, 0, Math.PI * 0.5),
            this._box(0.05, 0.50, 0.09, sx * 0.75, 1.13, -0.12, 0, 0, sx * 0.31)
          );
          // Dark wheel well recesses
          dark.push(
            this._cyl(0.34, 0.34, 0.24, 12, sx * 0.72, 0.34,  1.28, 0, 0, Math.PI * 0.5),
            this._cyl(0.34, 0.34, 0.24, 12, sx * 0.72, 0.34, -1.24, 0, 0, Math.PI * 0.5)
          );
          makeWheel(dark, chrome, sx * 0.76, 0.32,  1.28, 0.32, 0.20, 0.19);
          makeWheel(dark, chrome, sx * 0.76, 0.32, -1.24, 0.32, 0.20, 0.19);

          // Side door windows (angled INWARD matching roof tumblehome!) + side mirror + chrome door handles
          glass.push(
            this._box(0.03, 0.44, 0.66, sx * 0.755, 1.13,  0.25, 0, 0, sx * 0.31),
            this._box(0.03, 0.44, 0.64, sx * 0.755, 1.13, -0.49, 0, 0, sx * 0.31)
          );
          dark.push(this._box(0.09, 0.07, 0.13, sx * 0.88, 0.92, 0.66));
          chrome.push(
            this._box(0.04, 0.03, 0.14, sx * 0.86, 0.80,  0.08),
            this._box(0.04, 0.03, 0.14, sx * 0.86, 0.80, -0.62),
            this._box(0.025, 0.025, 3.88, sx * 0.855, 0.68, -0.02) // Classic VAZ-2106 side chrome molding!
          );
        }

        // Sloped Front Windshield & Sloped Rear Window (`matVehicleGlass`)
        glass.push(
          this._box(1.30, 0.64, 0.05, 0, 1.14,  0.65, -0.68, 0, 0),
          this._box(1.28, 0.62, 0.05, 0, 1.14, -0.92,  0.70, 0, 0)
        );

        // Front black radiator grille + Exhaust tailpipe + Chassis undercarriage
        dark.push(
          this._box(1.38, 0.22, 0.06, 0, 0.66, 2.07),
          this._box(1.42, 0.14, 3.65, 0, 0.28, 0),
          this._cyl(0.035, 0.035, 0.42, 8, -0.46, 0.24, -2.12, Math.PI * 0.5, 0, 0)
        );

        // Chrome Front & Rear Bumpers + Vertical Bumperettes (`клыки`) + Grille Center Badge
        chrome.push(
          this._box(1.68, 0.09, 0.11, 0, 0.42,  2.14),
          this._box(0.06, 0.18, 0.13, -0.52, 0.44,  2.16),
          this._box(0.06, 0.18, 0.13,  0.52, 0.44,  2.16),
          this._box(1.66, 0.09, 0.11, 0, 0.44, -2.13),
          this._box(0.06, 0.18, 0.13, -0.52, 0.46, -2.15),
          this._box(0.06, 0.18, 0.13,  0.52, 0.46, -2.15),
          this._box(0.09, 0.13, 0.03, 0, 0.66, 2.105)
        );

        // Iconic QUAD ROUND VAZ-2106 HEADLIGHTS (`4 круглые фары`) + Rectangular Rear Taillights!
        for (const sx of [-1, 1]) {
          for (const innerOff of [0.43, 0.62]) {
            chrome.push(this._cyl(0.095, 0.095, 0.05, 12, sx * innerOff, 0.66, 2.09, Math.PI * 0.5, 0, 0));
            lights.push(this._cyl(0.080, 0.080, 0.06, 12, sx * innerOff, 0.66, 2.095, Math.PI * 0.5, 0, 0));
          }
          // Rear multi-chamber taillights
          lights.push(this._box(0.36, 0.13, 0.05, sx * 0.54, 0.67, -2.08));
        }

        this.carZhiguliGeos = {
          body: this._mergeGeos(body),
          glass: this._mergeGeos(glass),
          dark: this._mergeGeos(dark),
          chrome: this._mergeGeos(chrome),
          lights: this._mergeGeos(lights)
        };
      }

      // =======================================================================
      // VARIANT 1: UAZ-452 "BUKHANKA" ICONIC SOVIET OFF-ROAD FOREST VAN
      // =======================================================================
      {
        const body = [], glass = [], dark = [], chrome = [], lights = [];

        // Rounded loaf-shaped cab-over-engine body (`Буханка`!)
        body.push(buildAutoBodyLoft([
          { z:  2.16, wBot: 0.76, yBot: 0.50, wBelt: 0.84, yBelt: 1.12, wTop: 0.72, yTop: 1.24 }, // Rounded lower nose
          { z:  2.02, wBot: 0.84, yBot: 0.46, wBelt: 0.93, yBelt: 1.22, wTop: 0.84, yTop: 1.88 }, // Sloped windshield face
          { z:  1.72, wBot: 0.86, yBot: 0.44, wBelt: 0.95, yBelt: 1.24, wTop: 0.86, yTop: 2.02 }, // Front cab roof crown
          { z:  0.00, wBot: 0.86, yBot: 0.44, wBelt: 0.95, yBelt: 1.24, wTop: 0.86, yTop: 2.03 }, // Mid van body
          { z: -1.88, wBot: 0.86, yBot: 0.44, wBelt: 0.95, yBelt: 1.24, wTop: 0.85, yTop: 2.01 }, // Rear van roof
          { z: -2.14, wBot: 0.80, yBot: 0.48, wBelt: 0.88, yBelt: 1.20, wTop: 0.78, yTop: 1.92 }  // Rounded rear doors
        ]));

        // Front & rear end caps + rain-gutter roof trim + stamped horizontal side ribs
        body.push(
          this._box(1.56, 0.72, 0.10, 0, 0.86,  2.12),
          this._box(1.58, 1.35, 0.10, 0, 1.18, -2.11),
          this._box(1.78, 0.04, 3.82, 0, 1.90, -0.08)
        );
        for (const sx of [-1, 1]) {
          body.push(
            this._box(0.03, 0.05, 3.96, sx * 0.95, 1.16, -0.05),
            this._box(0.03, 0.04, 3.85, sx * 0.94, 0.78, -0.05)
          );
          dark.push(
            this._cyl(0.41, 0.41, 0.30, 12, sx * 0.78, 0.42,  1.24, 0, 0, Math.PI * 0.5),
            this._cyl(0.41, 0.41, 0.30, 12, sx * 0.78, 0.42, -1.22, 0, 0, Math.PI * 0.5)
          );
          makeWheel(dark, chrome, sx * 0.84, 0.38,  1.24, 0.38, 0.24, 0.21);
          makeWheel(dark, chrome, sx * 0.84, 0.38, -1.22, 0.38, 0.24, 0.21);

          // Split front windshield pane + side cab door window + 2 rear passenger windows + rear door window!
          glass.push(
            this._box(0.68, 0.50, 0.05, sx * 0.40, 1.56,  2.10, -0.20, 0, 0),
            this._box(0.03, 0.46, 0.64, sx * 0.905, 1.54,  1.34, 0, 0, sx * 0.12),
            this._box(0.03, 0.42, 0.70, sx * 0.905, 1.54,  0.30, 0, 0, sx * 0.12),
            this._box(0.03, 0.42, 0.70, sx * 0.905, 1.54, -0.78, 0, 0, sx * 0.12),
            this._box(0.50, 0.42, 0.05, sx * 0.38, 1.54, -2.14)
          );
          // Tall UAZ side mirrors on stalks
          dark.push(this._box(0.08, 0.22, 0.12, sx * 1.02, 1.48, 1.72));
          chrome.push(this._box(0.03, 0.03, 0.15, sx * 0.96, 1.08, 1.10));

          // Iconic large round UAZ front headlights + rear round taillights
          chrome.push(this._cyl(0.125, 0.125, 0.05, 12, sx * 0.60, 0.96, 2.16, Math.PI * 0.5, 0, 0));
          lights.push(
            this._cyl(0.105, 0.105, 0.06, 12, sx * 0.60, 0.96, 2.165, Math.PI * 0.5, 0, 0),
            this._cyl(0.075, 0.075, 0.05, 10, sx * 0.68, 0.82, -2.15, Math.PI * 0.5, 0, 0)
          );
        }

        // UAZ front radiator grille + heavy off-road steel bumpers + high-clearance portal axles + rear spare wheel!
        dark.push(
          this._box(0.66, 0.30, 0.05, 0, 0.96,  2.16),
          this._box(1.82, 0.13, 0.15, 0, 0.48,  2.24),
          this._box(1.80, 0.13, 0.14, 0, 0.50, -2.20),
          this._box(1.48, 0.18, 3.60, 0, 0.42,  0.00),
          this._cyl(0.08, 0.08, 1.60, 8, 0, 0.38,  1.24, 0, 0, Math.PI * 0.5),
          this._cyl(0.08, 0.08, 1.60, 8, 0, 0.38, -1.22, 0, 0, Math.PI * 0.5),
          // Rear-door-mounted spare tire!
          this._cyl(0.36, 0.36, 0.22, 14, 0.32, 1.04, -2.25, Math.PI * 0.5, 0, 0)
        );
        chrome.push(
          this._cyl(0.19, 0.19, 0.24, 10, 0.32, 1.04, -2.25, Math.PI * 0.5, 0, 0),
          // Tubular steel roof expedition rack (`экспедиционный багажник на крыше`)!
          this._box(1.56, 0.04, 2.85, 0, 2.11, -0.15),
          this._box(0.04, 0.10, 2.85, -0.76, 2.07, -0.15),
          this._box(0.04, 0.10, 2.85,  0.76, 2.07, -0.15)
        );

        this.carBukhankaGeos = {
          body: this._mergeGeos(body),
          glass: this._mergeGeos(glass),
          dark: this._mergeGeos(dark),
          chrome: this._mergeGeos(chrome),
          lights: this._mergeGeos(lights)
        };
      }
    }

    createAbandonedCar(variant = 0, paintIdx = 0) {
      const geos = variant === 1 ? this.carBukhankaGeos : this.carZhiguliGeos;
      const paintMat = this.matCarPaints[Math.abs(paintIdx) % this.matCarPaints.length];
      const g = new THREE.Group();
      g.add(
        new THREE.Mesh(geos.body, paintMat),
        new THREE.Mesh(geos.glass, this.matVehicleGlass),
        new THREE.Mesh(geos.dark, this.matHeliRotorDark),
        new THREE.Mesh(geos.chrome, this.matSteelRail),
        new THREE.Mesh(geos.lights, this.matReflector)
      );
      return g;
    }

    _worldMat(opts) {
      if (!this.mobilePerf) {
        return new THREE.MeshStandardMaterial(opts);
      }
      const lOpts = {};
      if (opts.color !== undefined) lOpts.color = opts.color;
      if (opts.map !== undefined) lOpts.map = opts.map;
      if (opts.emissive !== undefined) lOpts.emissive = opts.emissive;
      if (opts.alphaTest !== undefined) lOpts.alphaTest = opts.alphaTest;
      if (opts.side !== undefined) lOpts.side = opts.side;
      if (opts.polygonOffset !== undefined) lOpts.polygonOffset = opts.polygonOffset;
      if (opts.polygonOffsetFactor !== undefined) lOpts.polygonOffsetFactor = opts.polygonOffsetFactor;
      if (opts.polygonOffsetUnits !== undefined) lOpts.polygonOffsetUnits = opts.polygonOffsetUnits;
      if (opts.transparent !== undefined) lOpts.transparent = opts.transparent;
      if (opts.opacity !== undefined) lOpts.opacity = opts.opacity;
      lOpts.fog = opts.fog !== undefined ? opts.fog : true;
      return new THREE.MeshLambertMaterial(lOpts);
    }

    _buildSharedAssets() {
      // === MATERIALS (Zero dynamic PointLights -> ZERO shader recompilation freezes! Mobile uses fast MeshLambertMaterial!) ===
      this.matGround = this._worldMat({
        color: 0x6c7066,
        map: this.tex.groundMap,
        bumpMap: this.tex.groundBump,
        bumpScale: 0.04,
        roughness: 0.96,
        metalness: 0.02
      });

      this.matSwampWater = this._worldMat({
        color: 0x161f1a,
        roughness: 0.10,
        metalness: 0.65,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1
      });

      this.matRoad = this._worldMat({
        map: this.tex.roadMap,
        roughness: 0.78,
        metalness: 0.06,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1
      });

      this.matGrass = this._worldMat({
        map: this.tex.grassMap,
        alphaTest: 0.36,
        roughness: 0.88,
        side: THREE.DoubleSide
      });

      this.matHemp = this._worldMat({
        map: this.tex.hempMap,
        alphaTest: 0.34,
        roughness: 0.82,
        side: THREE.DoubleSide
      });

      this.matCorn = this._worldMat({
        map: this.tex.cornMap,
        alphaTest: 0.34,
        roughness: 0.84,
        side: THREE.DoubleSide
      });

      this.matReed = this._worldMat({
        map: this.tex.reedMap,
        alphaTest: 0.35,
        roughness: 0.86,
        side: THREE.DoubleSide
      });

      this.matFern = this._worldMat({
        color: 0x7e8874,
        map: this.tex.fernMap,
        alphaTest: 0.38,
        roughness: 0.88,
        side: THREE.DoubleSide
      });

      this.matBough = this._worldMat({
        map: this.tex.boughMap,
        alphaTest: 0.35,
        roughness: 0.88,
        side: THREE.DoubleSide
      });

      this.matPine = this._worldMat({
        map: this.tex.pineMap,
        bumpMap: this.tex.pineBump,
        bumpScale: 0.12,
        roughness: 0.90
      });

      this.matCharred = this._worldMat({
        color: 0x1d1f1d,
        bumpMap: this.tex.pineBump,
        bumpScale: 0.16,
        roughness: 0.95
      });

      this.matBirch = this._worldMat({
        map: this.tex.birchMap,
        roughness: 0.80
      });

      this.matCabinFacade = this._worldMat({
        map: this.tex.cabinWallMap,
        roughness: 0.86
      });

      this.matTownHallFacade = this._worldMat({
        color: 0xd4d8ce,
        map: this.tex.townhallWallMap,
        bumpMap: this.tex.groundBump,
        bumpScale: 0.06,
        roughness: 0.80
      });

      this.matTownHallRoof = this._worldMat({
        color: 0xb8b286,
        map: this.tex.rustMap,
        roughness: 0.30,
        metalness: 0.45
      });

      this.matClockFace = new THREE.MeshBasicMaterial({ map: this.tex.clockFaceMap, side: THREE.DoubleSide, color: 0xb0b4aa });

      this.matHeliPaint = this._worldMat({
        color: 0x627256,
        map: this.tex.rustMap,
        roughness: 0.56,
        metalness: 0.24
      });

      this.matHeliBelly = this._worldMat({
        color: 0x8ea0a6,
        map: this.tex.rustMap,
        roughness: 0.52,
        metalness: 0.22
      });

      this.matVehicleGlass = this._worldMat({
        color: 0x131d21,
        roughness: 0.14,
        metalness: 0.78
      });

      this.matCarPaints = [
        this._worldMat({ color: 0x68302c, map: this.tex.rustMap, roughness: 0.48, metalness: 0.34 }), // Faded Soviet cherry
        this._worldMat({ color: 0x3b5566, map: this.tex.rustMap, roughness: 0.48, metalness: 0.34 }), // Weathered slate-blue
        this._worldMat({ color: 0x525f44, map: this.tex.rustMap, roughness: 0.58, metalness: 0.26 }), // UAZ military khaki
        this._worldMat({ color: 0x8d8b7e, map: this.tex.rustMap, roughness: 0.52, metalness: 0.30 })  // Aged beige-white
      ];

      this.matHeliRotorDark = this._worldMat({
        color: 0x222824,
        roughness: 0.62,
        metalness: 0.28
      });

      this.matNightmareFlesh = this._worldMat({
        color: 0x26382b,
        emissive: 0x060d08,
        roughness: 0.52
      });

      this.matBarnWood = this._worldMat({
        map: this.tex.barnPlankMap,
        roughness: 0.86
      });

      this.matRoof = this._worldMat({
        map: this.tex.roofMap,
        roughness: 0.72,
        metalness: 0.25
      });

      this.matRust = this._worldMat({
        map: this.tex.rustMap,
        roughness: 0.58,
        metalness: 0.48
      });

      this.matSteelRail = this._worldMat({
        color: 0x9aa49e,
        roughness: 0.28,
        metalness: 0.82
      });

      this.matStone = this._worldMat({
        color: 0x787c76,
        bumpMap: this.tex.groundBump,
        bumpScale: 0.08,
        roughness: 0.86
      });

      this.matHay = this._worldMat({
        color: 0x7a6d44,
        bumpMap: this.tex.pineBump,
        bumpScale: 0.12,
        roughness: 0.92
      });

      this.matDark = new THREE.MeshBasicMaterial({ color: 0x030504 });
      // True abyssal matte pitch-black skin (MeshLambertMaterial avoids PBR F0=4% grey plastic glare under flashlight!)
      this.matStalkerBody = new THREE.MeshLambertMaterial({
        color: 0x010102,
        fog: true
      });
      this.matMonsterMaw = new THREE.MeshBasicMaterial({ color: 0x000000, fog: true });
      this.matMonsterTeeth = new THREE.MeshBasicMaterial({ color: 0xe2dccb, fog: true });
      this.matReflector = this._worldMat({
        color: 0xdce4d8,
        emissive: 0x262e26,
        roughness: 0.2
      });
      this.matEyeGlow = new THREE.MeshBasicMaterial({ color: 0xecf4ee });
      // Grim, dark matte horror materials (NO noisy bump-map stripes -> authentic sinister silhouettes in NightShot!)
      this.matHumanCoats = [
        new THREE.MeshLambertMaterial({ color: 0x070a0d, fog: true }), // Drenched abyssal navy-black coat
        new THREE.MeshLambertMaterial({ color: 0x0a0d09, fog: true }), // Mud-soaked dark olive rags
        new THREE.MeshLambertMaterial({ color: 0x0d0908, fog: true }), // Dried-blood dark brown leather
        new THREE.MeshLambertMaterial({ color: 0x08080a, fog: true })  // Soot-stained charcoal coat
      ];
      this.matTrousers = new THREE.MeshLambertMaterial({ color: 0x040507, fog: true });
      this.matPaleFlesh = new THREE.MeshLambertMaterial({ color: 0x141816, fog: true });
      this.matInfectedSkin = new THREE.MeshLambertMaterial({ color: 0x1d2320, emissive: 0x030404, fog: true });
      this.matWatcherSkull = new THREE.MeshLambertMaterial({ color: 0x0d1010, emissive: 0x020303, fog: true });
      this.matEffigyWood = new THREE.MeshLambertMaterial({ color: 0x100d0a, fog: true });
      this.matEffigyRags = new THREE.MeshLambertMaterial({ color: 0x181511, fog: true });
      this.matEffigyBone = new THREE.MeshLambertMaterial({ color: 0x36332c, fog: true });
      // Realistic Soviet olive-drab military crate + high-visibility burning chemical signal flare materials
      this.matMilitaryWood = new THREE.MeshLambertMaterial({ color: 0x263420, fog: true });
      this.matMilitaryMetal = new THREE.MeshLambertMaterial({ color: 0x101510, fog: true });
      this.matCrateStencil = new THREE.MeshBasicMaterial({ color: 0xd6eadc, fog: true });
      this.matFlareBody = new THREE.MeshLambertMaterial({ color: 0x8a1e16, fog: true });
      this.matFlareCore = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
      this.matFlareHalo = new THREE.MeshBasicMaterial({
        map: this.tex.glowMap,
        color: 0xffe8d2,
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
        fog: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
      });
      this.matFlareSmoke = new THREE.MeshBasicMaterial({
        map: this.tex.glowMap,
        color: 0xc8e0d0,
        transparent: true,
        opacity: 0.30,
        depthWrite: false,
        fog: true,
        side: THREE.DoubleSide
      });
      this.matGlowPool = new THREE.MeshBasicMaterial({
        map: this.tex.glowMap,
        transparent: true,
        depthWrite: false,
        fog: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
      });

      // === PRE-BAKED SHARED GEOMETRIES ===
      const g1 = new THREE.PlaneGeometry(0.82, 0.56); g1.translate(0, 0.27, 0); g1.rotateY(0.25);
      const g2 = new THREE.PlaneGeometry(0.82, 0.56); g2.translate(0, 0.27, 0); g2.rotateY(0.25 + Math.PI * 0.5);
      this.geoGrassTuft = this._mergeGeos([g1, g2]);

      // 3-plane bushy 2.35m Wild Hemp Plant (`Куст высокой конопли` — crisp star-leaves + open aisle between rows!)
      const hParts = [];
      for (let a = 0; a < 3; a++) {
        const hp = new THREE.PlaneGeometry(1.18, 2.35);
        hp.translate(0, 1.15, 0);
        hp.rotateY((a / 3) * Math.PI);
        hParts.push(hp);
      }
      this.geoHempBush = this._mergeGeos(hParts);

      // 2-plane 2.72m Tall Row Corn Clump
      const c1 = new THREE.PlaneGeometry(1.45, 2.72); c1.translate(0, 1.34, 0); c1.rotateY(0.18);
      const c2 = new THREE.PlaneGeometry(1.45, 2.72); c2.translate(0, 1.34, 0); c2.rotateY(0.18 + Math.PI * 0.5);
      this.geoCornClump = this._mergeGeos([c1, c2]);

      // Swamp Cattails / Reeds (Tall wild grass — scary above eye-level ~1.88m, leaving lanky_watcher's ~2.68m head clearly visible!)
      const r1 = new THREE.PlaneGeometry(1.15, 1.88); r1.translate(0, 0.92, 0);
      const r2 = new THREE.PlaneGeometry(1.15, 1.88); r2.translate(0, 0.92, 0); r2.rotateY(Math.PI * 0.5);
      this.geoReedClump = this._mergeGeos([r1, r2]);

      const fParts = [];
      for (let i = 0; i < 5; i++) {
        const p = new THREE.PlaneGeometry(0.68, 0.58);
        p.translate(0, 0.29, 0); p.rotateX(0.95); p.rotateY((i / 5) * Math.PI * 2 + i * 0.2);
        fParts.push(p);
      }
      this.geoFernRosette = this._mergeGeos(fParts);

      // Trees (Living & Dead Swamp/Burnt Skeletal Trees)
      this.geoPineTrunk = this._buildTrunkGeo(11.6, 0.44, 0, 101);
      this.geoPineBoughs = this._buildConiferBoughsGeo(101);
      this.geoBirchTree = this._buildTrunkGeo(10.2, 0.32, 6, 202);
      this.geoDeadTree = this._buildTrunkGeo(8.8, 0.40, 7, 303);

      // Abandoned municipal hall with a square clock tower, no religious architecture.
      this.geoTownHallStone = this._mergeGeos([
        this._box(6.4, 0.55, 8.6, 0, 0.275, 0),
        this._box(2.8, 0.36, 1.4, 0, 0.18, 4.85),
        this._box(5.8, 4.6, 7.5, 0, 2.85, -0.2),
        this._box(0.45, 4.7, 0.45, -2.92, 2.85, 3.45),
        this._box(0.45, 4.7, 0.45,  2.92, 2.85, 3.45),
        this._box(0.45, 4.7, 0.45, -2.92, 2.85, -3.85),
        this._box(0.45, 4.7, 0.45,  2.92, 2.85, -3.85),
        this._box(3.4, 8.6, 3.2, 0, 4.85, 2.65),
        this._box(3.65, 0.24, 3.45, 0, 9.18, 2.65),
        this._box(3.85, 0.22, 3.65, 0, 9.62, 2.65)
      ]);
      this.geoTownHallRoof = this._mergeGeos([
        this._box(3.6, 0.14, 7.8, -1.55, 5.38, -0.2, 0, 0, 0.34),
        this._box(3.6, 0.14, 7.8, 1.55, 5.38, -0.2, 0, 0, -0.34),
        this._box(3.95, 0.18, 3.75, 0, 9.75, 2.65)
      ]);
      this.geoClockFace = new THREE.PlaneGeometry(2.35, 2.35);

      // HIGH-DETAIL COHESIVE SOVIET MI-8 CRASHED HELICOPTER + VAZ-2106 ZHIGULI & UAZ-452 BUKHANKA!
      this._buildDetailedHelicopterGeos();
      this._buildDetailedCarGeos();

      // RAILWAY FREIGHT BOXCAR (`Товарный ж/д вагон` with corrugated walls, bogie wheels & open sliding door!)
      this.geoTrainBoxcar = this._mergeGeos([
        this._box(2.95, 2.85, 11.4, 0, 2.22, 0),
        this._cyl(1.52, 1.52, 11.5, 10, 0, 3.45, 0, Math.PI * 0.5, 0, 0), // Curved boxcar roof
        // Steel undercarriage frame & 4 railway wheelsets
        this._box(2.4, 0.35, 12.1, 0, 0.68, 0),
        this._cyl(0.44, 0.44, 2.1, 10, 0, 0.44, -4.1, 0, 0, Math.PI * 0.5),
        this._cyl(0.44, 0.44, 2.1, 10, 0, 0.44, -2.9, 0, 0, Math.PI * 0.5),
        this._cyl(0.44, 0.44, 2.1, 10, 0, 0.44,  2.9, 0, 0, Math.PI * 0.5),
        this._cyl(0.44, 0.44, 2.1, 10, 0, 0.44,  4.1, 0, 0, Math.PI * 0.5),
        // Sliding cargo doors on sides
        this._box(3.12, 2.35, 2.15, 0, 2.15, 1.35)
      ]);

      // OLD WATER TOWER (`Водонапорная башня` — wide 3.6m clear span under 3.9m deck so player can sprint right underneath!)
      this.geoWaterTower = this._mergeGeos([
        this._cyl(0.14, 0.19, 7.0, 7, -1.72, 3.4, -1.72,  0.075, 0, -0.075),
        this._cyl(0.14, 0.19, 7.0, 7,  1.72, 3.4, -1.72,  0.075, 0,  0.075),
        this._cyl(0.14, 0.19, 7.0, 7, -1.72, 3.4,  1.72, -0.075, 0, -0.075),
        this._cyl(0.14, 0.19, 7.0, 7,  1.72, 3.4,  1.72, -0.075, 0,  0.075),
        this._box(3.2, 0.16, 3.2, 0, 3.92, 0),
        this._cyl(1.95, 1.95, 3.5, 14, 0, 8.4, 0), // Huge cylindrical tank
        this._cyl(0.05, 2.15, 1.35, 14, 0, 10.8, 0) // Conical roof
      ]);

      this.geoSawmillCrane = this._mergeGeos([
        // Wide A-frame legs (7.2m clear span so player can sprint right underneath!)
        this._cyl(0.14, 0.18, 6.8, 7, -3.8, 3.3, -0.9,  0.25, 0, 0),
        this._cyl(0.14, 0.18, 6.8, 7, -3.8, 3.3,  0.9, -0.25, 0, 0),
        this._cyl(0.14, 0.18, 6.8, 7,  3.8, 3.3, -0.9,  0.25, 0, 0),
        this._cyl(0.14, 0.18, 6.8, 7,  3.8, 3.3,  0.9, -0.25, 0, 0),
        // Overhead steel I-beam & dangling chain hook
        this._box(9.2, 0.42, 0.45, 0, 6.55, 0),
        this._box(0.85, 0.55, 0.75, 0.6, 6.25, 0),
        this._cyl(0.025, 0.025, 2.6, 5, 0.6, 4.7, 0),
        this._box(0.35, 0.35, 0.12, 0.6, 3.35, 0)
      ]);

      // POST-SOVIET CONCRETE BUS SHELTER (`Бетонная автобусная остановка`)
      this.geoBusStop = this._mergeGeos([
        this._box(4.6, 2.65, 0.22, 0, 1.32, -1.15),      // Back wall
        this._box(0.22, 2.65, 2.35, -2.2, 1.32, 0),      // Left wall
        this._box(0.22, 2.65, 1.35,  2.2, 1.32, -0.5),   // Half right wall
        this._box(5.2, 0.20, 3.10, 0, 2.72, 0.15, -0.08, 0, 0), // Cantilevered concrete roof slab
        this._box(4.1, 0.10, 0.45, 0, 0.52, -0.75)       // Wooden bench inside
      ]);
      this.geoSwampBoat = this._mergeGeos([
        this._box(1.35, 0.48, 3.4, 0, 0.22, 0, 0.12, 0, 0.18),
        this._cyl(0.68, 0.55, 1.1, 3, 0, 0.32, 2.1, Math.PI * 0.5, 0, 0.18),
        this._box(1.25, 0.06, 0.32, 0, 0.38, 0.4, 0.12, 0, 0.18)
      ]);

      // Existing Clean Cabin, Run-Through Barn, Windmill, Car, Cross, Hay, Logs, Fence, PowerPole, Battery
      this.geoCabinWalls = this._box(4.9, 2.65, 5.7, 0, 1.325, 0);
      this.geoCabinTrim = this._mergeGeos([
        this._cyl(0.20, 0.22, 2.72, 7, -2.48, 1.36, -2.88),
        this._cyl(0.20, 0.22, 2.72, 7,  2.48, 1.36, -2.88),
        this._cyl(0.20, 0.22, 2.72, 7, -2.48, 1.36,  2.88),
        this._cyl(0.20, 0.22, 2.72, 7,  2.48, 1.36,  2.88),
        this._box(3.4, 0.65, 5.55, 0, 2.99, 0),
        this._box(1.9, 0.55, 5.50, 0, 3.59, 0),
        this._box(1.5, 0.24, 0.72, 0, 0.12, 3.22)
      ]);
      this.geoCabinRoof = this._mergeGeos([
        this._box(3.35, 0.12, 6.45, -1.36, 3.42, 0, 0, 0,  0.54),
        this._box(3.35, 0.12, 6.45,  1.36, 3.42, 0, 0, 0, -0.54),
        this._box(0.58, 1.45, 0.58,  0.95, 4.15, -1.2)
      ]);

      // Triangular gable pediments sitting cleanly beneath the pitched roof slopes (zero corner poke-through!)
      const barnGableShape = new THREE.Shape();
      barnGableShape.moveTo(-3.76, 3.74);
      barnGableShape.lineTo( 3.76, 3.74);
      barnGableShape.lineTo( 0.00, 5.90);
      barnGableShape.closePath();
      const makeBarnGable = (zPos) => {
        const g = new THREE.ExtrudeGeometry(barnGableShape, { depth: 0.28, bevelEnabled: false });
        const uvAttr = g.attributes.uv;
        if (uvAttr) {
          for (let i = 0; i < uvAttr.count; i++) {
            uvAttr.setXY(i, uvAttr.getX(i) * 0.25, uvAttr.getY(i) * 0.25);
          }
        }
        g.translate(0, 0, zPos - 0.14);
        return g;
      };

      this.geoBarnWalls = this._mergeGeos([
        this._box(0.28, 3.8, 10.4, -3.65, 1.9, 0),
        this._box(0.28, 3.8, 10.4,  3.65, 1.9, 0),
        this._box(1.35, 3.8, 0.28, -2.95, 1.9,  5.06),
        this._box(1.35, 3.8, 0.28,  2.95, 1.9,  5.06),
        this._box(1.35, 3.8, 0.28, -2.95, 1.9, -5.06),
        this._box(1.35, 3.8, 0.28,  2.95, 1.9, -5.06),
        makeBarnGable( 5.06),
        makeBarnGable(-5.06),
        this._box(7.2, 0.22, 0.22, 0, 3.75, -2.2),
        this._box(7.2, 0.22, 0.22, 0, 3.75,  2.2),
        this._box(2.1, 3.5, 0.14, -3.15, 1.75, 5.95, 0, -0.95, 0),
        this._box(2.1, 3.5, 0.14,  3.15, 1.75, 5.95, 0,  0.95, 0)
      ]);
      this.geoBarnRoof = this._mergeGeos([
        this._box(4.82, 0.16, 11.10, -2.13, 4.82, 0, 0, 0,  0.52),
        this._box(4.82, 0.16, 11.10,  2.13, 4.82, 0, 0, 0, -0.52),
        this._box(0.32, 0.22, 11.14,  0.00, 6.02, 0)
      ]);

      this.geoWindmillTower = this._mergeGeos([
        this._cyl(0.08, 0.13, 11.2, 6, -1.15, 5.5, -1.15,  0.085, 0, -0.085),
        this._cyl(0.08, 0.13, 11.2, 6,  1.15, 5.5, -1.15,  0.085, 0,  0.085),
        this._cyl(0.08, 0.13, 11.2, 6, -1.15, 5.5,  1.15, -0.085, 0, -0.085),
        this._cyl(0.08, 0.13, 11.2, 6,  1.15, 5.5,  1.15, -0.085, 0,  0.085),
        this._box(2.1, 0.10, 2.1, 0, 3.5, 0),
        this._box(1.5, 0.10, 1.5, 0, 7.0, 0),
        this._box(0.95, 0.14, 0.95, 0, 10.6, 0),
        this._box(0.08, 0.85, 1.85, 0, 11.1, -1.1)
      ]);
      const bladeParts = [this._cyl(0.22, 0.22, 0.35, 8, 0, 0, 0, Math.PI * 0.5, 0, 0)];
      for (let b = 0; b < 8; b++) {
        const ang = (b / 8) * Math.PI * 2;
        bladeParts.push(this._box(0.32, 2.4, 0.04, Math.cos(ang) * 1.45, Math.sin(ang) * 1.45, 0, 0, 0.32, ang - Math.PI * 0.5));
      }
      this.geoWindmillRotor = this._mergeGeos(bladeParts);

      this.geoCarBody = this._mergeGeos([
        this._box(1.94, 0.68, 4.30, 0, 0.56, 0),
        this._box(1.66, 0.10, 2.05, 0, 1.54, -0.18),
        this._cyl(0.045, 0.055, 0.74, 6, -0.80, 1.22,  0.78, -0.38, 0, 0),
        this._cyl(0.045, 0.055, 0.74, 6,  0.80, 1.22,  0.78, -0.38, 0, 0),
        this._cyl(0.045, 0.055, 0.74, 6, -0.80, 1.22, -1.12,  0.36, 0, 0),
        this._cyl(0.045, 0.055, 0.74, 6,  0.80, 1.22, -1.12,  0.36, 0, 0),
        this._cyl(0.35, 0.35, 0.26, 10, -0.94, 0.35, -1.32, 0, 0, Math.PI * 0.5),
        this._cyl(0.35, 0.35, 0.26, 10,  0.94, 0.35, -1.32, 0, 0, Math.PI * 0.5),
        this._cyl(0.35, 0.35, 0.26, 10, -0.94, 0.35,  1.32, 0, 0, Math.PI * 0.5),
        this._cyl(0.35, 0.35, 0.26, 10,  0.94, 0.35,  1.32, 0, 0, Math.PI * 0.5)
      ]);
      this.geoCarReflectors = this._mergeGeos([
        this._box(0.36, 0.16, 0.06, -0.66, 0.68,  2.16),
        this._box(0.36, 0.16, 0.06,  0.66, 0.68,  2.16),
        this._box(0.36, 0.16, 0.06, -0.66, 0.68, -2.16),
        this._box(0.36, 0.16, 0.06,  0.66, 0.68, -2.16)
      ]);

      this.geoGravestone = this._mergeGeos([
        this._box(0.95, 0.32, 0.55, 0, 0.16, 0),
        this._box(0.72, 1.25, 0.25, 0, 0.94, 0),
        this._box(0.58, 0.14, 0.26, 0, 1.62, 0)
      ]);

      this.geoHayBale = this._cyl(0.88, 0.88, 1.55, 12, 0, 0.86, 0, 0, 0, Math.PI * 0.5);
      this.geoLogPile = this._mergeGeos([
        this._cyl(0.24, 0.24, 3.8, 8, -0.52, 0.24, 0, Math.PI * 0.5, 0, 0),
        this._cyl(0.24, 0.24, 3.8, 8,  0.00, 0.24, 0, Math.PI * 0.5, 0, 0),
        this._cyl(0.24, 0.24, 3.8, 8,  0.52, 0.24, 0, Math.PI * 0.5, 0, 0),
        this._cyl(0.23, 0.23, 3.7, 8, -0.26, 0.66, 0, Math.PI * 0.5, 0, 0),
        this._cyl(0.23, 0.23, 3.7, 8,  0.26, 0.66, 0, Math.PI * 0.5, 0, 0),
        this._cyl(0.22, 0.22, 3.6, 8,  0.00, 1.08, 0, Math.PI * 0.5, 0, 0),
        this._cyl(0.06, 0.07, 1.75, 6, -0.88, 0.85, -1.4),
        this._cyl(0.06, 0.07, 1.75, 6,  0.88, 0.85, -1.4),
        this._cyl(0.06, 0.07, 1.75, 6, -0.88, 0.85,  1.4),
        this._cyl(0.06, 0.07, 1.75, 6,  0.88, 0.85,  1.4)
      ]);
      this.geoOilDrums = this._mergeGeos([
        this._cyl(0.32, 0.32, 0.96, 10, -0.38, 0.48, 0),
        this._cyl(0.32, 0.32, 0.96, 10,  0.34, 0.48, 0.22),
        this._cyl(0.32, 0.32, 0.96, 10,  0.05, 0.32, -0.45, Math.PI * 0.46, 0.3, 0)
      ]);
      this.geoFence5m = this._mergeGeos([
        this._cyl(0.08, 0.09, 1.65, 6, -2.4, 0.82, 0),
        this._cyl(0.08, 0.09, 1.65, 6,  0.0, 0.82, 0),
        this._cyl(0.08, 0.09, 1.65, 6,  2.4, 0.82, 0),
        this._box(5.0, 0.11, 0.06, 0, 0.52, 0.05),
        this._box(5.0, 0.11, 0.06, 0, 1.05, 0.05),
        this._box(5.0, 0.11, 0.06, 0, 1.48, 0.05)
      ]);
      this.geoPowerPole = this._mergeGeos([
        this._cyl(0.13, 0.19, 8.2, 7, 0, 4.0, 0),
        this._box(2.3, 0.12, 0.12, 0, 7.35, 0)
      ]);
      // Rectangular Soviet Military Supply Crate + Burning Signal Flare (`небольшой прямоугольный военный ящик и на нём сигнальная шашка`!)
      this.geoMilitaryCrateWood = this._mergeGeos([
        this._box(0.84, 0.26, 0.48, 0, 0.135, 0),            // Main rectangular olive-drab crate body
        this._box(0.88, 0.05, 0.52, 0, 0.275, 0),            // Overhanging heavy wooden lid
        this._box(0.86, 0.035, 0.03, 0, 0.07,  0.245),       // Lower horizontal slat front
        this._box(0.86, 0.035, 0.03, 0, 0.20,  0.245),       // Upper horizontal slat front
        this._box(0.86, 0.035, 0.03, 0, 0.07, -0.245),       // Lower slat rear
        this._box(0.86, 0.035, 0.03, 0, 0.20, -0.245)        // Upper slat rear
      ]);
      this.geoMilitaryCrateMetal = this._mergeGeos([
        // 4 vertical iron corner reinforcement cleats
        this._box(0.05, 0.29, 0.05, -0.41, 0.145,  0.23),
        this._box(0.05, 0.29, 0.05,  0.41, 0.145,  0.23),
        this._box(0.05, 0.29, 0.05, -0.41, 0.145, -0.23),
        this._box(0.05, 0.29, 0.05,  0.41, 0.145, -0.23),
        // 2 front steel latches & rear hinges
        this._box(0.045, 0.09, 0.025, -0.22, 0.24,  0.26),
        this._box(0.045, 0.09, 0.025,  0.22, 0.24,  0.26),
        this._box(0.05,  0.07, 0.025, -0.22, 0.25, -0.26),
        this._box(0.05,  0.07, 0.025,  0.22, 0.25, -0.26),
        // Side carry handle bars
        this._box(0.03, 0.03, 0.22, -0.44, 0.17, 0),
        this._box(0.03, 0.03, 0.22,  0.44, 0.17, 0),
        // Spare camcorder NP-F550 battery pack resting on the lid beside the flare!
        this._box(0.16, 0.07, 0.11, -0.18, 0.335, -0.04, 0, 0.28, 0)
      ]);
      // Retro-reflective white/IR stencil bands & battery cross markings on crate so it gleams unmistakably in NightShot!
      this.geoMilitaryCrateStencil = this._mergeGeos([
        this._box(0.85, 0.045, 0.51, 0, 0.17, 0),
        this._box(0.22, 0.008, 0.055, -0.16, 0.305, 0.02),
        this._box(0.055, 0.008, 0.22, -0.16, 0.305, 0.02)
      ]);

      // Red cardboard signal flare tube (`сигнальная шашка`) lying diagonally on top of the military crate
      const flareTube = new THREE.CylinderGeometry(0.028, 0.028, 0.28, 8);
      flareTube.rotateZ(Math.PI * 0.5);
      flareTube.rotateY(-0.35);
      flareTube.translate(0.12, 0.326, 0.04);
      this.geoSignalFlareTube = flareTube;

      // Blinding white-hot magnesium chemical core at the burning end of the flare (`x = 0.25, y = 0.33, z = 0.088`)
      const flareTip = new THREE.SphereGeometry(0.048, 8, 7);
      flareTip.scale(1.3, 1.0, 1.1);
      flareTip.translate(0.25, 0.33, 0.088);
      this.geoSignalFlareTip = flareTip;

      // High-visibility 3D overexposed flare cross-star + vertical light beacon + bright 2.35m circular ground pool!
      const fh1 = new THREE.PlaneGeometry(1.35, 1.35); fh1.translate(0.25, 0.44, 0.09);
      const fh2 = new THREE.PlaneGeometry(1.35, 1.35); fh2.rotateY(Math.PI * 0.5); fh2.translate(0.25, 0.44, 0.09);
      const fhBeam1 = new THREE.PlaneGeometry(0.55, 2.35); fhBeam1.translate(0.25, 1.22, 0.09);
      const fhBeam2 = new THREE.PlaneGeometry(0.55, 2.35); fhBeam2.rotateY(Math.PI * 0.5); fhBeam2.translate(0.25, 1.22, 0.09);
      const fhLid = new THREE.PlaneGeometry(0.92, 0.66); fhLid.rotateX(-Math.PI * 0.5); fhLid.translate(0.12, 0.306, 0.04);
      this.geoSignalFlareHalo = this._mergeGeos([fh1, fh2, fhBeam1, fhBeam2, fhLid]);

      const flareGroundPool = new THREE.CircleGeometry(2.25, 20);
      flareGroundPool.rotateX(-Math.PI * 0.5);
      flareGroundPool.translate(0.16, 0.026, 0.06);
      this.geoSignalFlarePool = flareGroundPool;
      const smk1 = new THREE.PlaneGeometry(0.62, 0.62);
      const smk2 = new THREE.PlaneGeometry(0.62, 0.62); smk2.rotateY(Math.PI * 0.5);
      this.geoFlareSmokePuff = this._mergeGeos([smk1, smk2]);

      // === HIGH-DETAIL SCULPTED ORGANIC PITCH-BLACK MONSTER WITH TERRIFYING UNCANNY GRIN ===
      this._buildGrinningMonsterGeos();
      this._buildEnemySharedGeos();

      this.geoCrow = this._mergeGeos([
        this._box(0.08, 0.07, 0.28, 0, 0, 0),
        this._box(0.36, 0.02, 0.14, -0.18, 0.04, 0, 0, 0.15,  0.35),
        this._box(0.36, 0.02, 0.14,  0.18, 0.04, 0, 0, -0.15, -0.35)
      ]);

      this.geoBlairTotem = this._mergeGeos([
        this._cyl(0.01, 0.01, 1.6, 4, 0, 3.2, 0),
        this._cyl(0.025, 0.025, 0.95, 5, 0, 2.15, 0),
        this._cyl(0.02, 0.02, 0.78, 5, 0, 2.32, 0, 0, 0, Math.PI * 0.48),
        this._cyl(0.02, 0.02, 0.55, 5, -0.14, 1.80, 0, 0, 0,  0.38),
        this._cyl(0.02, 0.02, 0.55, 5,  0.14, 1.80, 0, 0, 0, -0.38)
      ]);
    }

    // Builds smooth organic curved limbs (multi-jointed tubes with smooth vertex normals — zero boxes!)
    _buildOrganicTube(pts, radii, segs = 10) {
      const pos = [], uvs = [], idx = [];
      const upRef = new THREE.Vector3(0, 0, 1);
      const altRef = new THREE.Vector3(1, 0, 0);

      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const tangent = new THREE.Vector3();
        if (i === 0) tangent.subVectors(pts[1], pts[0]);
        else if (i === pts.length - 1) tangent.subVectors(pts[i], pts[i - 1]);
        else tangent.subVectors(pts[i + 1], pts[i - 1]);
        tangent.normalize();

        const ref = Math.abs(tangent.dot(upRef)) > 0.92 ? altRef : upRef;
        const binorm = new THREE.Vector3().crossVectors(tangent, ref).normalize();
        const norm = new THREE.Vector3().crossVectors(binorm, tangent).normalize();

        const r = radii[i];
        for (let s = 0; s <= segs; s++) {
          const u = s / segs;
          const a = u * Math.PI * 2;
          const ca = Math.cos(a), sa = Math.sin(a);
          pos.push(
            p.x + (binorm.x * ca + norm.x * sa) * r,
            p.y + (binorm.y * ca + norm.y * sa) * r,
            p.z + (binorm.z * ca + norm.z * sa) * r
          );
          uvs.push(u, i / (pts.length - 1));
        }
      }
      const row = segs + 1;
      for (let i = 0; i < pts.length - 1; i++) {
        for (let s = 0; s < segs; s++) {
          const a = i * row + s, b = a + 1, c = a + row, d = c + 1;
          idx.push(a, b, c, b, d, c);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    }

    // Lofts smooth organic anatomical cross-sections (gaunt ribcage, waist, shoulders, skull)
    _buildLoftedRings(rings, segs = 18) {
      const pos = [], uvs = [], idx = [];
      for (let r = 0; r < rings.length; r++) {
        const R = rings[r];
        for (let s = 0; s <= segs; s++) {
          const u = s / segs;
          const a = u * Math.PI * 2;
          const ca = Math.cos(a);
          const sa = Math.sin(a);
          // Optional subtle anatomical rib/cheek sculpting
          let rx = R.rx;
          let rz = R.rz;
          if (R.rib) {
            const frontMask = Math.max(0, Math.abs(sa));
            rx *= 1.0 + R.rib * Math.cos(r * 2.6) * 0.08 * (1.0 - frontMask * 0.3);
          }
          if (R.spineBump && sa < -0.75) {
            rz += R.spineBump * (-sa - 0.75) * 1.4;
          }
          if (R.socketIndent && sa > 0.35) {
            // Concave hollow eye sockets & hollow gaunt cheeks!
            const eyeAngL = Math.abs(a - (Math.PI * 0.5 - 0.38));
            const eyeAngR = Math.abs(a - (Math.PI * 0.5 + 0.38));
            const minEye = Math.min(eyeAngL, eyeAngR);
            if (minEye < 0.32) {
              rz -= R.socketIndent * Math.cos((minEye / 0.32) * Math.PI * 0.5);
            }
          }
          pos.push((R.cx || 0) + ca * rx, R.y, (R.cz || 0) + sa * rz);
          uvs.push(u, r / (rings.length - 1));
        }
      }
      const row = segs + 1;
      for (let r = 0; r < rings.length - 1; r++) {
        for (let s = 0; s < segs; s++) {
          const a = r * row + s, b = a + 1, c = a + row, d = c + 1;
          idx.push(a, c, b, b, c, d);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    }

    // Sculpts a tall (~2.08m), gaunt, skeletal jet-black horror entity with seamless limbs, long talons,
    // sinister sunken pinprick eyes, and a wide ear-to-ear crescent toothy rictus grin!
    _buildGrinningMonsterGeos() {
      const bodyParts = [];

      // 1. Hunched S-curved starved torso (narrow hips -> deeply sunken waist -> ribcage -> hunched shoulders -> strained neck)
      bodyParts.push(
        this._buildLoftedRings([
          { y: 0.88, cx: 0.0, cz: -0.01, rx: 0.095, rz: 0.075 },
          { y: 0.95, cx: 0.0, cz: -0.02, rx: 0.150, rz: 0.105, spineBump: 0.03 }, // Bony pelvis
          { y: 1.08, cx: 0.0, cz: -0.03, rx: 0.096, rz: 0.074, spineBump: 0.04 }, // Deeply starved hollow waist
          { y: 1.21, cx: 0.0, cz: -0.01, rx: 0.152, rz: 0.110, rib: 1.5, spineBump: 0.05 },
          { y: 1.35, cx: 0.0, cz:  0.01, rx: 0.205, rz: 0.136, rib: 1.8, spineBump: 0.06 }, // Gaunt ribcage
          { y: 1.48, cx: 0.0, cz:  0.03, rx: 0.238, rz: 0.140, rib: 1.4, spineBump: 0.06 }, // Broad hunched upper back
          { y: 1.57, cx: 0.0, cz:  0.04, rx: 0.232, rz: 0.122, spineBump: 0.05 },           // Shoulders
          { y: 1.65, cx: 0.01, cz: 0.07, rx: 0.092, rz: 0.086, spineBump: 0.04 },           // Craned neck root
          { y: 1.76, cx: 0.02, cz: 0.10, rx: 0.066, rz: 0.068, spineBump: 0.03 },           // Long thin neck
          { y: 1.85, cx: 0.03, cz: 0.12, rx: 0.064, rz: 0.066 }
        ], 20)
      );

      // Protruding curved skeletal ribs & collarbones wrapping the starved chest
      for (const s of [-1, 1]) {
        bodyParts.push(
          this._buildOrganicTube(
            [
              new THREE.Vector3(s * 0.01, 1.55, 0.13),
              new THREE.Vector3(s * 0.13, 1.59, 0.11),
              new THREE.Vector3(s * 0.25, 1.57, 0.04)
            ],
            [0.020, 0.024, 0.030],
            7
          )
        );
        for (let r = 0; r < 5; r++) {
          const ry = 1.20 + r * 0.068;
          const rw = 0.145 + r * 0.019;
          const rd = 0.108 + r * 0.008;
          bodyParts.push(
            this._buildOrganicTube(
              [
                new THREE.Vector3(s * 0.02, ry - 0.012, rd + 0.012),
                new THREE.Vector3(s * rw * 0.72, ry + 0.006, rd * 0.80),
                new THREE.Vector3(s * rw * 1.03, ry + 0.022, 0.01)
              ],
              [0.014, 0.018, 0.015],
              6
            )
          );
        }
      }

      // 2. Seamless long gaunt bowed legs rooted deep inside pelvis (ZERO joint gaps!)
      for (const s of [-1, 1]) {
        bodyParts.push(
          this._buildOrganicTube(
            [
              new THREE.Vector3(s * 0.075, 1.03, -0.01), // Rooted inside pelvis!
              new THREE.Vector3(s * 0.138, 0.88,  0.00), // Hip joint
              new THREE.Vector3(s * 0.168, 0.66,  0.03), // Starved thigh
              new THREE.Vector3(s * 0.175, 0.47,  0.08), // Sharp bony knee
              new THREE.Vector3(s * 0.148, 0.23, -0.02), // Bowed shin
              new THREE.Vector3(s * 0.142, 0.045, 0.01), // Ankle
              new THREE.Vector3(s * 0.155, 0.014, 0.19)  // Elongated clawed foot
            ],
            [0.086, 0.076, 0.058, 0.054, 0.040, 0.035, 0.020],
            10
          )
        );
      }

      // 3. Seamless unnaturally long sinewy arms rooted inside chest + huge splayed 5-talon hands!
      for (const s of [-1, 1]) {
        const wrist = new THREE.Vector3(s * 0.35, 0.72, 0.15);
        bodyParts.push(
          this._buildOrganicTube(
            [
              new THREE.Vector3(s * 0.110, 1.53,  0.03), // Rooted deep inside upper chest!
              new THREE.Vector3(s * 0.245, 1.55,  0.03), // Seamless bony deltoid shoulder
              new THREE.Vector3(s * 0.335, 1.29, -0.01), // Starved upper arm
              new THREE.Vector3(s * 0.395, 1.04, -0.05), // Bowed protruding sharp elbow
              new THREE.Vector3(s * 0.375, 0.85,  0.06), // Sinewy forearm curving forward
              wrist                                      // Bony wrist/palm
            ],
            [0.072, 0.064, 0.039, 0.044, 0.033, 0.038],
            10
          )
        );
        // 5 long curved razor talons on each hand!
        for (let f = 0; f < 5; f++) {
          const u = (f - 2) / 2.0; // -1..+1
          const spreadX = s * (0.018 - u * 0.024);
          const spreadZ = u * 0.044;
          const clawLen = f === 0 ? 0.15 : (0.245 - Math.abs(u) * 0.045);
          bodyParts.push(
            this._buildOrganicTube(
              [
                new THREE.Vector3(wrist.x, wrist.y, wrist.z),
                new THREE.Vector3(wrist.x + spreadX * 0.8 + s * 0.022, wrist.y - clawLen * 0.50, wrist.z + spreadZ + 0.035),
                new THREE.Vector3(wrist.x + spreadX * 1.15 - s * 0.020, wrist.y - clawLen, wrist.z + spreadZ + 0.015)
              ],
              [0.016, 0.011, 0.0028],
              6
            )
          );
        }
      }

      // 4. Sculpted gaunt elongated skull/head built in HEAD-LOCAL coordinates around neck pivot (0, 0, 0)
      // so `monster.head.rotation` can twist/roll unnaturally (`неестественно крутит головой`) while body stays dead still!
      const shiftHeadPivot = (geo) => {
        geo.translate(0.0, 0.055, 0.005);
        return geo;
      };

      const skullGeo = this._buildLoftedRings([
        { y: -0.178, cz:  0.030, rx: 0.020, rz: 0.024 },                         // Sharp pointed chin tip
        { y: -0.152, cz:  0.024, rx: 0.064, rz: 0.074 },                         // Stretched lower jaw
        { y: -0.105, cz:  0.012, rx: 0.098, rz: 0.088 },                         // Grinning jaw (recessed for open maw)
        { y: -0.048, cz:  0.008, rx: 0.114, rz: 0.092 },                         // Wide grinning mouth / cheeks
        { y:  0.006, cz:  0.010, rx: 0.122, rz: 0.098 },                         // Broad gaunt cheekbones
        { y:  0.052, cz:  0.004, rx: 0.110, rz: 0.104, socketIndent: 0.028 },    // Deep concave eye sockets
        { y:  0.088, cz:  0.016, rx: 0.116, rz: 0.118 },                         // Heavy brow ridge
        { y:  0.134, cz:  0.002, rx: 0.112, rz: 0.116 },                         // Elongated cranium
        { y:  0.175, cz: -0.010, rx: 0.082, rz: 0.092 },
        { y:  0.202, cz: -0.015, rx: 0.024, rz: 0.028 }
      ], 22);

      // Sinister V-angled brow ridges overhanging the sunken eyes for pure malevolence!
      const browL = this._buildOrganicTube(
        [new THREE.Vector3(-0.008, 0.050, 0.116), new THREE.Vector3(-0.048, 0.064, 0.114), new THREE.Vector3(-0.088, 0.074, 0.094)],
        [0.012, 0.014, 0.010], 6
      );
      const browR = this._buildOrganicTube(
        [new THREE.Vector3( 0.008, 0.050, 0.116), new THREE.Vector3( 0.048, 0.064, 0.114), new THREE.Vector3( 0.088, 0.074, 0.094)],
        [0.012, 0.014, 0.010], 6
      );

      // Wide front-projected ear-to-ear crescent horror smile (`u` from -1..+1 spans full width of cheekbones!)
      // Always sits cleanly IN FRONT OF skullGeo (`cz + rz <= 0.108` at center, `<= 0.068` at cheek corners)!
      const smileXAt = (u) => u * 0.106;
      const smileZAt = (u) => 0.118 - 0.042 * u * u;
      const smileYAt = (u) => -0.096 + 0.118 * Math.pow(Math.abs(u), 1.62);
      const smileGapAt = (u) => 0.056 * Math.max(0.04, 1.0 - Math.pow(Math.abs(u), 1.78));

      const upperLipPts = [], lowerLipPts = [], lipRadii = [];
      const lipSteps = 18;
      for (let i = 0; i <= lipSteps; i++) {
        const u = -1.0 + (2.0 * i) / lipSteps;
        const sx = smileXAt(u);
        const sy = smileYAt(u);
        const sz = smileZAt(u) + 0.0015;
        const gap = smileGapAt(u);
        upperLipPts.push(new THREE.Vector3(sx, sy + gap * 0.58, sz));
        lowerLipPts.push(new THREE.Vector3(sx, sy - gap * 0.58, sz));
        lipRadii.push(0.0042 * (1.0 - 0.40 * Math.abs(u)));
      }
      const headSkinGeo = shiftHeadPivot(this._mergeGeos([
        skullGeo,
        browL,
        browR,
        this._buildOrganicTube(upperLipPts, lipRadii, 7),
        this._buildOrganicTube(lowerLipPts, lipRadii, 7)
      ]));

      // 5. Abyssal pitch-black mouth interior + deep black eye sockets + tiny staring pinprick black pupils!
      const mawParts = [];
      const mawPos = [], mawUv = [], mawIdx = [];
      const mawSteps = 20;
      for (let i = 0; i <= mawSteps; i++) {
        const u = -1.0 + (2.0 * i) / mawSteps;
        const sx = smileXAt(u);
        const sy = smileYAt(u);
        const sz = smileZAt(u);
        const gap = smileGapAt(u) * 0.56;
        mawPos.push(sx, sy + gap, sz);
        mawPos.push(sx, sy - gap, sz);
        mawUv.push((u + 1) * 0.5, 1, (u + 1) * 0.5, 0);
      }
      for (let i = 0; i < mawSteps; i++) {
        const k = i * 2;
        mawIdx.push(k, k + 1, k + 2, k + 2, k + 1, k + 3);
      }
      const mawRibbon = new THREE.BufferGeometry();
      mawRibbon.setAttribute("position", new THREE.Float32BufferAttribute(mawPos, 3));
      mawRibbon.setAttribute("normal", new THREE.Float32BufferAttribute(new Array((mawSteps + 1) * 6).fill(0.57), 3));
      mawRibbon.setAttribute("uv", new THREE.Float32BufferAttribute(mawUv, 2));
      mawRibbon.setIndex(mawIdx);
      mawParts.push(mawRibbon);

      const scleraParts = [];
      for (const s of [-1, 1]) {
        // Wide abyssal black orbital socket hollow
        const sock = new THREE.SphereGeometry(0.028, 10, 8);
        sock.scale(1.12, 0.85, 0.42);
        sock.translate(s * 0.048, 0.046, 0.091);
        mawParts.push(sock);

        // Smaller, sharper, intensely eerie pale sclera recessed deep inside dark socket
        const eye = new THREE.SphereGeometry(0.0135, 12, 10);
        eye.scale(1.18, 0.80, 0.52);
        eye.translate(s * 0.047, 0.045, 0.101);
        scleraParts.push(eye);

        // Tiny pinprick black pupil staring straight ahead!
        const pupil = new THREE.SphereGeometry(0.0054, 10, 8);
        pupil.scale(1.0, 1.0, 0.55);
        pupil.translate(s * 0.047, 0.045, 0.1082);
        mawParts.push(pupil);
      }

      // 6. 30 Sharp Elongated Ivory Teeth (15 upper + 15 lower) proudly in front of the abyssal black maw!
      const teethParts = [];
      const numTeethPerRow = 15;
      for (let t = 0; t < numTeethPerRow; t++) {
        const u = -0.92 + (1.84 * t) / (numTeethPerRow - 1);
        const sx = smileXAt(u);
        const sy = smileYAt(u);
        const sz = smileZAt(u) + 0.0055;
        const gap = smileGapAt(u);
        const toothW = 0.0098 * (1.0 - 0.32 * Math.abs(u));
        const upperH = gap * 0.46;
        const lowerH = gap * 0.44;
        const jitterH = ((t * 5) % 3 - 1) * 0.0018;
        const yawFace = Math.atan2(u * 0.075, 0.118);

        // Sharp tapered upper tooth
        const ut = new THREE.CylinderGeometry(toothW * 0.56, toothW * 0.18, upperH + jitterH, 6);
        ut.scale(1.0, 1.0, 0.55);
        ut.rotateZ(-u * 0.34);
        ut.rotateY(yawFace);
        ut.translate(sx, sy + gap * 0.50 - (upperH + jitterH) * 0.5, sz);
        teethParts.push(ut);

        // Sharp tapered lower tooth
        const lt = new THREE.CylinderGeometry(toothW * 0.18, toothW * 0.52, lowerH, 6);
        lt.scale(1.0, 1.0, 0.55);
        lt.rotateZ(-u * 0.34);
        lt.rotateY(yawFace);
        lt.translate(sx, sy - gap * 0.50 + lowerH * 0.5, sz);
        teethParts.push(lt);
      }

      this.geoStalkerFigure = this._mergeGeos(bodyParts);
      this.geoStalkerHeadSkin = headSkinGeo;
      this.geoStalkerMaw = shiftHeadPivot(this._mergeGeos(mawParts));
      this.geoStalkerEyes = shiftHeadPivot(this._mergeGeos(scleraParts));
      this.geoStalkerTeeth = shiftHeadPivot(this._mergeGeos(teethParts));

      // Dedicated high-visibility glowing jagged grin & eyes (`fog: false`) for the pitch-dark 5,000m Finale!
      const finaleSmileParts = [];
      const fUpperArc = [], fLowerArc = [], fArcRadii = [];
      const fSteps = 14;
      for (let i = 0; i <= fSteps; i++) {
        const u = -1.12 + (2.24 * i) / fSteps;
        const clampedU = Math.max(-1.0, Math.min(1.0, u));
        const sx = smileXAt(clampedU) * 1.28;
        const sy = smileYAt(clampedU) + (Math.abs(u) > 0.88 ? 0.012 * (Math.abs(u) - 0.88) : 0);
        const sz = smileZAt(clampedU) + 0.012;
        const gap = Math.max(0.012, smileGapAt(clampedU) * 1.42);
        fUpperArc.push(new THREE.Vector3(sx, sy + gap * 0.46, sz));
        fLowerArc.push(new THREE.Vector3(sx, sy - gap * 0.46, sz));
        fArcRadii.push(0.0115 * (1.12 - 0.42 * Math.min(1.0, Math.abs(u))));
      }
      finaleSmileParts.push(
        this._buildOrganicTube(fUpperArc, fArcRadii, 6),
        this._buildOrganicTube(fLowerArc, fArcRadii, 6)
      );
      for (let t = 0; t < 13; t++) {
        const u = -0.94 + (1.88 * t) / 12;
        const sx = smileXAt(u) * 1.24;
        const sy = smileYAt(u);
        const sz = smileZAt(u) + 0.0125;
        const gap = smileGapAt(u) * 1.42;
        const tw = 0.021 * (1.0 - 0.25 * Math.abs(u));
        const uh = gap * 0.50;
        const lh = gap * 0.48;
        const yawFace = Math.atan2(u * 0.08, 0.118);

        const ut = new THREE.ConeGeometry(tw * 0.62, uh, 5);
        ut.rotateX(Math.PI);
        ut.rotateZ(-u * 0.34);
        ut.rotateY(yawFace);
        ut.translate(sx, sy + gap * 0.48 - uh * 0.5, sz);
        finaleSmileParts.push(ut);

        const lt = new THREE.ConeGeometry(tw * 0.58, lh, 5);
        lt.rotateZ(-u * 0.34);
        lt.rotateY(yawFace);
        lt.translate(sx, sy - gap * 0.48 + lh * 0.5, sz);
        finaleSmileParts.push(lt);
      }
      const finaleEyesParts = [];
      for (const s of [-1, 1]) {
        const fe = new THREE.SphereGeometry(0.0195, 10, 8);
        fe.scale(1.24, 0.86, 0.60);
        fe.translate(s * 0.052, 0.049, 0.106);
        finaleEyesParts.push(fe);
      }
      this.geoFinaleGlowSmile = shiftHeadPivot(this._mergeGeos(finaleSmileParts));
      this.geoFinaleGlowEyes = shiftHeadPivot(this._mergeGeos(finaleEyesParts));
      this.matFinaleSmileGlow = new THREE.MeshBasicMaterial({ color: 0xe6effc, fog: false });
      this.matFinaleEyesGlow = new THREE.MeshBasicMaterial({ color: 0xf4f9ff, fog: false });
      this.matFinaleHeadSkin = new THREE.MeshStandardMaterial({
        color: 0x0b0f16,
        emissive: 0x090d14,
        emissiveIntensity: 0.75,
        roughness: 0.78,
        metalness: 0.08
      });
    }

    // Creates an instance of our sculpted pitch-black monster with articulated `head` Group!
    createBlackMonster() {
      const g = new THREE.Group();
      const body = new THREE.Mesh(this.geoStalkerFigure, this.matStalkerBody);

      const head = new THREE.Group();
      head.position.set(0.035, 1.885, 0.130);
      head.rotation.order = "YXZ";
      head.rotation.set(0.12, 0.0, -0.20);

      const headSkin = new THREE.Mesh(this.geoStalkerHeadSkin, this.matStalkerBody);
      const maw = new THREE.Mesh(this.geoStalkerMaw, this.matMonsterMaw);
      const eyes = new THREE.Mesh(this.geoStalkerEyes, this.matEyeGlow);
      const teeth = new THREE.Mesh(this.geoStalkerTeeth, this.matMonsterTeeth);
      head.add(headSkin, maw, eyes, teeth);

      g.add(body, head);

      return { group: g, head, body, eyes, teeth };
    }

    // Articulated towering pitch-black Main Monster (`главный монстр`) for the 5,000m Finale:
    // Stands motionless with glowing eyes & 30-tooth grin in Beat B, then sprints furiously with pumping limbs in Beat C!
    createFinaleBlackMonster() {
      const group = new THREE.Group();
      const inner = new THREE.Group();
      inner.scale.set(1.12, 1.16, 1.12);

      const legL = new THREE.Mesh(this.geoHuskLegL, this.matStalkerBody);
      legL.position.set(-0.12, 0.92, 0);
      const legR = new THREE.Mesh(this.geoHuskLegR, this.matStalkerBody);
      legR.position.set( 0.12, 0.92, 0);

      const torso = new THREE.Group();
      torso.position.set(0, 0.92, 0);
      const torsoMesh = new THREE.Mesh(this.geoHuskTorso, this.matStalkerBody);
      torsoMesh.scale.set(1.06, 1.12, 1.06);
      torso.add(torsoMesh);

      const armL = new THREE.Group();
      armL.position.set(-0.25, 0.56, 0.03);
      armL.add(new THREE.Mesh(this.geoStriderArmL, this.matStalkerBody));

      const armR = new THREE.Group();
      armR.position.set( 0.25, 0.56, 0.03);
      armR.add(new THREE.Mesh(this.geoStriderArmR, this.matStalkerBody));

      const head = new THREE.Group();
      head.position.set(0.015, 0.72, 0.08);
      head.rotation.order = "YXZ";
      head.rotation.set(0.10, 0.0, -0.22);
      head.add(
        new THREE.Mesh(this.geoStalkerHeadSkin, this.matFinaleHeadSkin),
        new THREE.Mesh(this.geoStalkerMaw, this.matMonsterMaw),
        new THREE.Mesh(this.geoFinaleGlowEyes, this.matFinaleEyesGlow),
        new THREE.Mesh(this.geoFinaleGlowSmile, this.matFinaleSmileGlow)
      );

      torso.add(armL, armR, head);
      inner.add(legL, legR, torso);
      group.add(inner);
      return { group, torso, head, armL, armR, legL, legR };
    }

    // Detailed 3D Apartment Bedroom (`просыпаемся у себя в квартире в постели`) for the 5,000m Finale:
    // - Player wakes up in bed (`x = 0, z = +0.62 .. +0.76`) under a rumpled blanket, headboard flush against back wall (`z = +1.28`)
    // - To the LEFT (`x = -2.48, z = -0.68`): closed wooden bedroom door with handle & casing on the left wall
    // - FLUSH AGAINST THE HEADBOARD WALL (`z = +1.28`) to the LEFT of the bed: bedside nightstand + warm lamp (`x = -1.06, z = +1.04`) AND night window (`x = -1.90, z = +1.25`)!
    createApartmentBedroom() {
      const root = new THREE.Group();
      root.position.set(0, 125.0, 0);
      root.visible = false;

      const matWall = new THREE.MeshLambertMaterial({ color: 0x524b44 });
      const matCeiling = new THREE.MeshLambertMaterial({ color: 0x625e58 });
      const matFloor = new THREE.MeshLambertMaterial({ color: 0x3b2a1e, map: this.tex.barnPlankMap });
      const matBaseboard = new THREE.MeshLambertMaterial({ color: 0x20150e });
      const matDarkWood = new THREE.MeshLambertMaterial({ color: 0x422a19, map: this.tex.barnPlankMap });
      const matDoorWood = new THREE.MeshLambertMaterial({ color: 0x563722, map: this.tex.barnPlankMap });
      const matDoorPanel = new THREE.MeshLambertMaterial({ color: 0x3d2515 });
      const matBrass = new THREE.MeshLambertMaterial({ color: 0xbda36b });
      const matSheet = new THREE.MeshLambertMaterial({ color: 0x9ea5ad });
      const matBlanket = new THREE.MeshLambertMaterial({ color: 0x3b4d5e });
      const matBlanketFold = new THREE.MeshLambertMaterial({ color: 0x2f3e4d });
      const matWinFrame = new THREE.MeshLambertMaterial({ color: 0x9fa6ad });
      const matCurtain = new THREE.MeshLambertMaterial({ color: 0x676d78 });
      const matNightSky = new THREE.MeshBasicMaterial({ color: 0x050a14 });
      const matCityDot = new THREE.MeshBasicMaterial({ color: 0xffd38a });
      const matShadeGlow = new THREE.MeshBasicMaterial({ color: 0xffd79a });
      const matBulbCore = new THREE.MeshBasicMaterial({ color: 0xfff3d1 });
      const matRug = new THREE.MeshLambertMaterial({ color: 0x4a2422 });

      // 1. Sealed Room Shell (`5.0m x 3.9m x 2.75m`) — Back headboard wall right at `z = +1.28`, Left door wall at `x = -2.50`
      const roomW = 5.0, roomD = 3.9, roomH = 2.75;
      const zBack = 1.28;
      const zFront = zBack - roomD; // -2.62
      const czRoom = (zBack + zFront) * 0.5; // -0.67
      const halfW = roomW * 0.5; // 2.50

      root.add(
        new THREE.Mesh(this._box(roomW, 0.12, roomD, 0, -0.06, czRoom), matFloor),
        new THREE.Mesh(this._box(roomW, 0.12, roomD, 0, roomH + 0.06, czRoom), matCeiling),
        new THREE.Mesh(this._box(0.12, roomH, roomD, -halfW - 0.06, roomH * 0.5, czRoom), matWall), // Left door wall (x = -2.50)
        new THREE.Mesh(this._box(0.12, roomH, roomD,  halfW + 0.06, roomH * 0.5, czRoom), matWall), // Right wall (x = +2.50)
        new THREE.Mesh(this._box(roomW, roomH, 0.12, 0, roomH * 0.5, zFront - 0.06), matWall),      // Front wall (z = -2.62)
        new THREE.Mesh(this._box(roomW, roomH, 0.12, 0, roomH * 0.5, zBack + 0.06), matWall),       // Back headboard wall (z = +1.28)
        new THREE.Mesh(this._box(0.04, 0.09, roomD, -halfW + 0.02, 0.045, czRoom), matBaseboard),
        new THREE.Mesh(this._box(roomW, 0.09, 0.04, 0, 0.045, zFront + 0.02), matBaseboard),
        new THREE.Mesh(this._box(roomW, 0.09, 0.04, 0, 0.045, zBack - 0.02), matBaseboard),
        new THREE.Mesh(this._box(1.30, 0.015, 1.85, -1.48, 0.008, -0.45), matRug)
      );

      // 2. The Bed (`постель`): Headboard FLUSH against back wall (`z = +1.23`), Pillow (`z = +0.86`), Rumpled Blanket (`z = +0.34 .. -0.98`)
      root.add(
        new THREE.Mesh(this._box(1.48, 0.34, 2.22, 0, 0.17,  0.10), matDarkWood),    // Bed frame (spans z = -1.01 .. +1.21)
        new THREE.Mesh(this._box(1.52, 1.12, 0.09, 0, 0.56,  1.23), matDarkWood),    // Wooden headboard flush against z = +1.28 wall!
        new THREE.Mesh(this._box(1.38, 0.20, 2.12, 0, 0.44,  0.10), matSheet),       // Mattress & sheet
        new THREE.Mesh(this._box(0.76, 0.15, 0.42, 0, 0.58,  0.86), matSheet),       // Pillow under our head
        new THREE.Mesh(this._box(1.42, 0.16, 1.38, 0, 0.56, -0.30), matBlanket),     // Main duvet over body/legs
        new THREE.Mesh(this._box(1.44, 0.11, 0.24, 0, 0.63,  0.30), matBlanketFold), // Turned-back blanket collar near chest
        new THREE.Mesh(this._box(0.46, 0.12, 0.95, -0.22, 0.64, -0.18), matBlanketFold)
      );

      // 3. Closed Bedroom Door on the LEFT WALL (`x = -2.48, z = -1.16`)
      const doorZ = -1.16;
      root.add(
        new THREE.Mesh(this._box(0.05, 2.12, 1.02, -2.48, 1.06, doorZ), matDarkWood),      // Door casing (`наличник`)
        new THREE.Mesh(this._box(0.065, 2.04, 0.90, -2.46, 1.02, doorZ), matDoorWood),     // Wooden door leaf
        new THREE.Mesh(this._box(0.075, 0.74, 0.66, -2.455, 1.48, doorZ), matDoorPanel),   // Upper recessed panel
        new THREE.Mesh(this._box(0.075, 0.66, 0.66, -2.455, 0.56, doorZ), matDoorPanel),   // Lower recessed panel
        new THREE.Mesh(this._box(0.03, 0.16, 0.045, -2.42, 0.98, doorZ + 0.34), matBrass), // Handle backplate
        new THREE.Mesh(this._box(0.07, 0.025, 0.025, -2.39, 1.00, doorZ + 0.34), matBrass),// Handle stem
        new THREE.Mesh(this._box(0.025, 0.028, 0.13, -2.36, 1.00, doorZ + 0.29), matBrass) // Horizontal lever handle!
      );

      // 4. Bedside Nightstand + Glowing Lamp FLUSH AGAINST THE HEADBOARD WALL (`x = -1.06, z = +1.04`, back face at `z = +1.26`)!
      const nsX = -1.06, nsZ = 1.04;
      const shadeGeo = new THREE.CylinderGeometry(0.095, 0.165, 0.21, 16);
      const lampStemGeo = new THREE.CylinderGeometry(0.022, 0.032, 0.16, 10);
      const lampBaseGeo = new THREE.CylinderGeometry(0.075, 0.095, 0.06, 12);

      const lampBase = new THREE.Mesh(lampBaseGeo, matDarkWood);
      lampBase.position.set(nsX, 0.61, nsZ);
      const lampStem = new THREE.Mesh(lampStemGeo, matBrass);
      lampStem.position.set(nsX, 0.70, nsZ);
      const lampShade = new THREE.Mesh(shadeGeo, matShadeGlow);
      lampShade.position.set(nsX, 0.84, nsZ);
      const lampBulb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), matBulbCore);
      lampBulb.position.set(nsX, 0.79, nsZ);

      root.add(
        new THREE.Mesh(this._box(0.46, 0.58, 0.44, nsX, 0.29, nsZ), matDarkWood),          // Nightstand body flush against z=+1.28 wall!
        new THREE.Mesh(this._box(0.50, 0.035, 0.46, nsX, 0.58, nsZ), matDoorWood),         // Nightstand top slab
        new THREE.Mesh(this._box(0.36, 0.18, 0.03, nsX, 0.42, nsZ - 0.225), matDoorPanel), // Drawer front facing into room (-Z)
        new THREE.Mesh(this._box(0.035, 0.035, 0.04, nsX, 0.42, nsZ - 0.245), matBrass),   // Drawer knob
        new THREE.Mesh(this._box(0.17, 0.04, 0.13, nsX + 0.11, 0.615, nsZ - 0.09), matBlanket), // Bedside book
        lampBase, lampStem, lampShade, lampBulb
      );

      // 5. Apartment Night Window ON THAT SAME HEADBOARD WALL (`z = +1.25`) TO THE LEFT OF THE BED (`x = -1.90`)!
      const winX = -1.90, winY = 1.56, winW = 0.96, winH = 1.32, winWallZ = 1.25;
      root.add(
        new THREE.Mesh(this._box(winW, winH, 0.04, winX, winY, winWallZ + 0.035), matNightSky),                // Dark night outside glass
        new THREE.Mesh(this._box(0.07, winH + 0.10, 0.08, winX - winW * 0.5, winY, winWallZ), matWinFrame),    // Left jamb
        new THREE.Mesh(this._box(0.07, winH + 0.10, 0.08, winX + winW * 0.5, winY, winWallZ), matWinFrame),    // Right jamb
        new THREE.Mesh(this._box(winW + 0.10, 0.07, 0.08, winX, winY + winH * 0.5, winWallZ), matWinFrame),    // Top lintel
        new THREE.Mesh(this._box(0.055, winH, 0.07, winX + 0.05, winY, winWallZ), matWinFrame),                // Center vertical mullion
        new THREE.Mesh(this._box(winW * 0.50, 0.05, 0.07, winX + 0.26, winY + 0.28, winWallZ), matWinFrame),   // Fortochka crossbar!
        new THREE.Mesh(this._box(winW + 0.20, 0.05, 0.22, winX, winY - winH * 0.5 - 0.02, winWallZ - 0.07), matWinFrame), // Protruding windowsill (`подоконник`)
        new THREE.Mesh(this._box(0.74, 0.52, 0.09, winX, 0.44, winWallZ - 0.05), matWinFrame),                 // Radiator under window (`батарея`)
        new THREE.Mesh(this._box(0.20, 1.62, 0.09, winX - winW * 0.5 - 0.05, 1.48, winWallZ - 0.09), matCurtain), // Left curtain drape
        new THREE.Mesh(this._box(0.20, 1.62, 0.09, winX + winW * 0.5 + 0.05, 1.48, winWallZ - 0.09), matCurtain)  // Right curtain drape
      );
      // Distant warm apartment window lights visible outside the night glass on the headboard wall
      for (const [dx, dy] of [[-0.26, -0.22], [-0.18, -0.17], [0.20, -0.28], [0.29, -0.11], [-0.10, 0.12]]) {
        root.add(new THREE.Mesh(this._box(0.028, 0.035, 0.02, winX + dx, winY + dy, winWallZ + 0.02), matCityDot));
      }

      // 6. Wardrobe (`шкаф`) & wall picture across the room so peripheral views feel lived-in
      root.add(
        new THREE.Mesh(this._box(1.05, 2.15, 0.58, 1.78, 1.075, -2.02), matDarkWood),
        new THREE.Mesh(this._box(0.72, 0.52, 0.02, -0.35, 1.62, zFront + 0.02), matDoorPanel)
      );

      // Dedicated Bedroom Lighting: Warm cozy nightstand lamp + soft cool moonlight from the headboard-wall window!
      const lampLight = new THREE.PointLight(0xffad59, 1.78, 6.8, 1.55);
      lampLight.position.set(nsX + 0.06, 0.88, nsZ - 0.10);
      const winMoonLight = new THREE.PointLight(0x6992cc, 0.78, 5.4, 1.45);
      winMoonLight.position.set(winX, 1.58, winWallZ - 0.26);
      root.add(lampLight, winMoonLight);

      this.scene.add(root);
      return { group: root, lampLight, winMoonLight };
    }

    // High-Detail Anatomical Horror Sculpting for World Enemies:
    //   #1 «Ведомые» (Gaunt, starved, broken-necked hollow husks with gaping slack jaw, 4-fingered bony hands & pinprick IR eyes)
    //   #2 «Заражённые улыбкой» (Hyper-gaunt dark doppelgängers hiding a 24-tooth razor grin behind 10 long bony claws)
    //   #5 «Чучела-перевёртыши» (True 3D volumetric Slavic folk-horror idol: 4 twisted roots, open 3D wooden ribcage, timber crossbeam, stag-branch antlers & scythe talons — ZERO 2D look!)
    _buildEnemySharedGeos() {
      // 1. Bowed, gaunt multi-jointed leg (hip y=0 -> bony knee -> thin shin -> mud-caked boot y=-0.92)
      const buildGauntLeg = (sx) => this._mergeGeos([
        this._buildOrganicTube(
          [
            new THREE.Vector3(0, 0.0, 0),
            new THREE.Vector3(sx * 0.035, -0.44, 0.055), // Crooked forward-buckled knee
            new THREE.Vector3(sx * 0.015, -0.85, -0.025),
            new THREE.Vector3(sx * 0.020, -0.91,  0.075)
          ],
          [0.078, 0.056, 0.042, 0.046],
          9
        )
      ]);
      this.geoHuskLegL = buildGauntLeg(-1);
      this.geoHuskLegR = buildGauntLeg(1);

      // 2. Gaunt, starved, tattered dark coat torso with protruding ribs, spine & ragged split coat-tails (y=-0.16..+0.62)
      const torsoParts = [
        this._buildLoftedRings([
          { y: -0.18, cx: 0.0, cz: -0.02, rx: 0.205, rz: 0.135 },                         // Ragged lower coat skirt
          { y: -0.02, cx: 0.0, cz: -0.01, rx: 0.145, rz: 0.098, spineBump: 0.04 },        // Sunken starved waist
          { y:  0.18, cx: 0.0, cz:  0.01, rx: 0.175, rz: 0.118, rib: 1.6, spineBump: 0.05 },
          { y:  0.38, cx: 0.0, cz:  0.03, rx: 0.212, rz: 0.132, rib: 1.8, spineBump: 0.06 }, // Hunched ribcage
          { y:  0.52, cx: 0.0, cz:  0.04, rx: 0.225, rz: 0.118, spineBump: 0.05 },        // Bony shoulders
          { y:  0.61, cx: 0.0, cz:  0.06, rx: 0.074, rz: 0.074, spineBump: 0.03 }         // Strained gaunt neck root
        ], 18)
      ];
      // Asymmetric hanging tattered cloth strips, jutting clavicles & 4 dorsal spine spikes ripping out the back!
      for (const s of [-1, 1]) {
        torsoParts.push(
          this._buildOrganicTube(
            [new THREE.Vector3(s * 0.02, 0.50, 0.12), new THREE.Vector3(s * 0.13, 0.55, 0.09), new THREE.Vector3(s * 0.24, 0.52, 0.03)],
            [0.018, 0.022, 0.028], 6
          ),
          this._buildOrganicTube(
            [new THREE.Vector3(s * 0.14, -0.08, -0.04), new THREE.Vector3(s * 0.19, -0.36, -0.07), new THREE.Vector3(s * 0.16, -0.56, -0.09)],
            [0.048, 0.034, 0.010], 5
          )
        );
      }
      for (let sp = 0; sp < 4; sp++) {
        const sy = 0.14 + sp * 0.105;
        torsoParts.push(
          this._buildOrganicTube(
            [new THREE.Vector3(0, sy, -0.09), new THREE.Vector3(0, sy + 0.035, -0.165)],
            [0.022, 0.004], 5
          )
        );
      }
      this.geoHuskTorso = this._mergeGeos(torsoParts);

      // 3. Long multi-jointed hanging arm + 4 long crooked 18cm razor-claw fingers for #1 «Ведомый»
      const buildHuskHangingArm = (sx) => {
        const sleeve = this._buildOrganicTube(
          [
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(sx * 0.050, -0.29, -0.01),
            new THREE.Vector3(sx * 0.028, -0.58,  0.07)
          ],
          [0.062, 0.047, 0.035],
          8
        );
        const handParts = [
          this._buildOrganicTube(
            [new THREE.Vector3(sx * 0.028, -0.57, 0.07), new THREE.Vector3(sx * 0.022, -0.66, 0.09)],
            [0.034, 0.026], 6
          )
        ];
        for (let f = 0; f < 4; f++) {
          const offX = sx * 0.022 + (f - 1.5) * 0.017;
          const len = 0.155 + (f === 1 || f === 2 ? 0.035 : 0.0);
          handParts.push(
            this._buildOrganicTube(
              [
                new THREE.Vector3(offX, -0.65, 0.09),
                new THREE.Vector3(offX + sx * 0.008, -0.65 - len * 0.55, 0.115),
                new THREE.Vector3(offX - sx * 0.004, -0.65 - len, 0.088)
              ],
              [0.009, 0.006, 0.002], 5
            )
          );
        }
        return { sleeve, hand: this._mergeGeos(handParts) };
      };
      const hArmL = buildHuskHangingArm(-1);
      const hArmR = buildHuskHangingArm(1);
      this.geoHuskSleeveL = hArmL.sleeve;
      this.geoHuskHandL = hArmL.hand;
      this.geoHuskSleeveR = hArmR.sleeve;
      this.geoHuskHandR = hArmR.hand;

      // 4. Sculpted Gaunt Anatomical Horror Skull (deep concave `socketIndent: 0.044`, gaunt cheeks & overhanging brow!)
      this.geoGauntSkull = this._buildLoftedRings([
        { y: -0.02, cz: 0.01, rx: 0.048, rz: 0.052 },                             // Thin neck
        { y:  0.03, cz: 0.03, rx: 0.058, rz: 0.072 },                             // Dropped narrow jaw
        { y:  0.09, cz: 0.01, rx: 0.082, rz: 0.088 },                             // Sunken cheeks
        { y:  0.145, cz: 0.01, rx: 0.106, rz: 0.100 },                            // Sharp protruding cheekbones
        { y:  0.19, cz: 0.005, rx: 0.096, rz: 0.104, socketIndent: 0.044 },       // Deep hollow eye caverns!
        { y:  0.23, cz: 0.020, rx: 0.102, rz: 0.114 },                            // Heavy overhanging brow
        { y:  0.28, cz: 0.00, rx: 0.094, rz: 0.106 },                             // Cranium
        { y:  0.32, cz: -0.01, rx: 0.060, rz: 0.070 },
        { y:  0.34, cz: -0.015, rx: 0.018, rz: 0.022 }
      ], 20);

      // #1 «Ведомый»: HUGE pitch-black eye caverns + angry brows + weeping rot streaks + crooked ear-to-ear RAZOR GRIN («улыбка»!) + 24 ConeGeometry fangs!
      const sockL = new THREE.SphereGeometry(0.035, 9, 7); sockL.scale(1.22, 1.15, 0.68); sockL.translate(-0.041, 0.190, 0.086);
      const sockR = new THREE.SphereGeometry(0.033, 9, 7); sockR.scale(1.18, 1.08, 0.68); sockR.translate( 0.041, 0.188, 0.086);
      const tearL = this._box(0.014, 0.072, 0.015, -0.041, 0.148, 0.096);
      const tearR = this._box(0.014, 0.078, 0.015,  0.041, 0.144, 0.096);
      const tranceCav = [sockL, sockR, tearL, tearR];
      for (const s of [-1, 1]) {
        tranceCav.push(
          this._buildOrganicTube(
            [
              new THREE.Vector3(s * 0.012, 0.214, 0.108),
              new THREE.Vector3(s * 0.044, 0.226 - (s < 0 ? 0.008 : 0.0), 0.104),
              new THREE.Vector3(s * 0.076, 0.236 - (s < 0 ? 0.010 : 0.0), 0.092)
            ],
            [0.008, 0.0085, 0.005], 5
          ),
          this._buildOrganicTube(
            [new THREE.Vector3(s * 0.010, 0.158, 0.106), new THREE.Vector3(s * 0.015, 0.128, 0.110)],
            [0.007, 0.005], 5
          ),
          this._buildOrganicTube(
            [
              new THREE.Vector3(s * 0.088, 0.128, 0.070),
              new THREE.Vector3(s * 0.100, 0.172, 0.052),
              new THREE.Vector3(s * 0.096, 0.206, 0.036)
            ],
            [0.011, 0.008, 0.003], 5
          )
        );
      }
      const tranceTeethParts = [];
      for (let i = 0; i <= 16; i++) {
        const u = -1.04 + (2.08 * i) / 16;
        const cu = Math.max(-1, Math.min(1, u));
        const mx = cu * 0.100;
        const my = 0.058 + 0.086 * Math.pow(Math.abs(cu), 1.38) + cu * 0.016; // Slightly crooked deranged smile!
        const mz = 0.100 - 0.038 * cu * cu;
        const gap = 0.056 * Math.max(0.09, 1.0 - Math.pow(Math.abs(cu), 1.72));
        const blob = new THREE.SphereGeometry(Math.max(0.011, gap * 0.70), 8, 6);
        blob.scale(1.26, 1.12, 0.54);
        blob.translate(mx, my, mz);
        tranceCav.push(blob);
      }
      for (let t = 0; t < 12; t++) {
        const u = -0.92 + (1.84 * t) / 11;
        const tx = u * 0.096;
        const ty = 0.058 + 0.086 * Math.pow(Math.abs(u), 1.38) + u * 0.016;
        const tz = 0.123 - 0.038 * u * u;
        const gap = 0.056 * Math.max(0.09, 1.0 - Math.pow(Math.abs(u), 1.72));
        const tw = 0.0115 * (1.0 - 0.22 * Math.abs(u));
        const uh = gap * 0.52;
        const lh = gap * 0.50;
        const ut = new THREE.ConeGeometry(tw * 0.64, uh, 5);
        ut.rotateX(Math.PI);
        ut.rotateZ(-u * 0.30);
        ut.translate(tx, ty + gap * 0.46 - uh * 0.5, tz);
        const lt = new THREE.ConeGeometry(tw * 0.60, lh, 5);
        lt.rotateZ(-u * 0.30);
        lt.translate(tx, ty - gap * 0.46 + lh * 0.5, tz);
        tranceTeethParts.push(ut, lt);
      }
      this.geoTranceDarkCavities = this._mergeGeos(tranceCav);
      this.geoTranceJaggedTeeth = this._mergeGeos(tranceTeethParts);

      const pinEyeL = new THREE.SphereGeometry(0.0175, 8, 6); pinEyeL.scale(1.18, 0.86, 0.58); pinEyeL.translate(-0.041, 0.192, 0.107);
      const pinEyeR = new THREE.SphereGeometry(0.0110, 7, 6); pinEyeR.scale(1.24, 0.72, 0.58); pinEyeR.translate( 0.041, 0.188, 0.107);
      this.geoPinprickIrEyes = this._mergeGeos([pinEyeL, pinEyeR]);

      // Asymmetric glowing horror eyes + pinhole pupils for #2 «Заражённый улыбкой» (proud of deep sockets!)
      const bulgeEyeL = new THREE.SphereGeometry(0.020, 10, 8); bulgeEyeL.scale(1.22, 0.92, 0.58); bulgeEyeL.translate(-0.042, 0.194, 0.107);
      const bulgeEyeR = new THREE.SphereGeometry(0.0155, 10, 8); bulgeEyeR.scale(1.26, 0.66, 0.58); bulgeEyeR.translate( 0.041, 0.186, 0.107);
      this.geoManicBulgeEyes = this._mergeGeos([bulgeEyeL, bulgeEyeR]);
      const pupL = new THREE.SphereGeometry(0.0056, 7, 6); pupL.translate(-0.037, 0.194, 0.119);
      const pupR = new THREE.SphereGeometry(0.0050, 7, 6); pupR.translate( 0.043, 0.186, 0.118);
      this.geoManicPupils = this._mergeGeos([pupL, pupR]);

      // 5. #2 «Заражённый улыбкой»: 5-Clawed Bony Hands Covering Face + Nightmare Carved-Cheek Razor Grin!
      const buildClawedCoverArm = (sx) => {
        const sleeve = this._buildOrganicTube(
          [
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(sx * 0.04, -0.20, 0.16),
            new THREE.Vector3(-sx * 0.15,  0.15, 0.185)
          ],
          [0.060, 0.046, 0.036],
          8
        );
        const clawParts = [
          this._buildOrganicTube(
            [new THREE.Vector3(-sx * 0.15, 0.14, 0.185), new THREE.Vector3(-sx * 0.19, 0.23, 0.192)],
            [0.038, 0.036], 6
          )
        ];
        for (let f = 0; f < 5; f++) {
          const spreadX = -sx * 0.195 + (f - 2.0) * 0.015;
          const spreadY = 0.32 + (2 - Math.abs(f - 2)) * 0.018;
          clawParts.push(
            this._buildOrganicTube(
              [
                new THREE.Vector3(spreadX, 0.225, 0.192),
                new THREE.Vector3(spreadX, (0.225 + spreadY) * 0.5, 0.198),
                new THREE.Vector3(spreadX + sx * 0.005, spreadY, 0.186)
              ],
              [0.009, 0.006, 0.002], 5
            )
          );
        }
        return { sleeve, claws: this._mergeGeos(clawParts) };
      };
      const infArmL = buildClawedCoverArm(-1);
      const infArmR = buildClawedCoverArm(1);
      this.geoInfectedSleeveL = infArmL.sleeve;
      this.geoInfectedHandL = infArmL.claws;
      this.geoInfectedSleeveR = infArmR.sleeve;
      this.geoInfectedHandR = infArmR.claws;

      // Deep sunken black sockets + weeping shadow streaks + carved ear-to-ear smile scars + 26 razor ConeGeometry fangs!
      const infMawParts = [sockL.clone(), sockR.clone()];
      for (const s of [-1, 1]) {
        infMawParts.push(
          this._buildOrganicTube(
            [
              new THREE.Vector3(s * 0.012, 0.214, 0.108),
              new THREE.Vector3(s * 0.044, 0.224 - (s > 0 ? 0.008 : 0.0), 0.104),
              new THREE.Vector3(s * 0.075, 0.234 - (s > 0 ? 0.010 : 0.0), 0.092)
            ],
            [0.0085, 0.009, 0.005], 5
          ),
          this._box(0.012, 0.065, 0.012, s * 0.041, 0.155, 0.098),
          this._buildOrganicTube(
            [new THREE.Vector3(s * 0.010, 0.158, 0.106), new THREE.Vector3(s * 0.015, 0.128, 0.110)],
            [0.007, 0.005], 5
          ),
          this._buildOrganicTube(
            [
              new THREE.Vector3(s * 0.088, 0.132, 0.070),
              new THREE.Vector3(s * 0.100, 0.172, 0.052),
              new THREE.Vector3(s * 0.096, 0.206, 0.036)
            ],
            [0.011, 0.008, 0.003], 5
          )
        );
      }
      const infTeethParts = [];
      for (let i = 0; i <= 16; i++) {
        const u = -1.04 + (2.08 * i) / 16;
        const cu = Math.max(-1, Math.min(1, u));
        const mx = cu * 0.102;
        const my = 0.062 + 0.086 * Math.pow(Math.abs(cu), 1.42);
        const mz = 0.100 - 0.038 * cu * cu;
        const gap = 0.058 * Math.max(0.09, 1.0 - Math.pow(Math.abs(cu), 1.72));
        const blob = new THREE.SphereGeometry(Math.max(0.011, gap * 0.70), 8, 6);
        blob.scale(1.26, 1.12, 0.54);
        blob.translate(mx, my, mz);
        infMawParts.push(blob);
      }
      for (let t = 0; t < 13; t++) {
        const u = -0.92 + (1.84 * t) / 12;
        const tx = u * 0.098;
        const ty = 0.062 + 0.086 * Math.pow(Math.abs(u), 1.42);
        const tz = 0.123 - 0.038 * u * u;
        const gap = 0.058 * Math.max(0.09, 1.0 - Math.pow(Math.abs(u), 1.72));
        const tw = 0.011 * (1.0 - 0.24 * Math.abs(u));
        const uh = gap * 0.50;
        const lh = gap * 0.48;
        const ut = new THREE.ConeGeometry(tw * 0.62, uh, 5);
        ut.rotateX(Math.PI);
        ut.rotateZ(-u * 0.32);
        ut.translate(tx, ty + gap * 0.46 - uh * 0.5, tz);
        const lt = new THREE.ConeGeometry(tw * 0.58, lh, 5);
        lt.rotateZ(-u * 0.32);
        lt.translate(tx, ty - gap * 0.46 + lh * 0.5, tz);
        infTeethParts.push(ut, lt);
      }
      this.geoInfectedMaw = this._mergeGeos(infMawParts);
      this.geoInfectedTeeth = this._mergeGeos(infTeethParts);

      // 5B. #4 «Длинный Наблюдатель»: towering dark-skulled horror with hollow weeping sockets, thin slit-grin & piercing IR eyes!
      const watchCav = [
        sockL.clone(), sockR.clone(), tearL.clone(), tearR.clone(),
        this._box(0.098, 0.024, 0.026, 0, 0.068, 0.092)
      ];
      this.geoWatcherFace = this._mergeGeos(watchCav);
      const wEyeL = new THREE.SphereGeometry(0.0135, 8, 6); wEyeL.scale(1.2, 0.85, 0.6); wEyeL.translate(-0.041, 0.190, 0.106);
      const wEyeR = new THREE.SphereGeometry(0.0135, 8, 6); wEyeR.scale(1.2, 0.85, 0.6); wEyeR.translate( 0.041, 0.190, 0.106);
      this.geoWatcherEyes = this._mergeGeos([wEyeL, wEyeR]);
      const watchTeethParts = [];
      for (let k = -4; k <= 4; k++) {
        const wt = new THREE.ConeGeometry(0.0042, 0.022, 4);
        wt.rotateX(k % 2 === 0 ? Math.PI : 0);
        wt.translate(k * 0.010, 0.068 + (k % 2 === 0 ? 0.005 : -0.005), 0.106);
        watchTeethParts.push(wt);
      }
      this.geoWatcherTeeth = this._mergeGeos(watchTeethParts);

      // 6. #5 «Искажённый Шатун» (`contorted_strider`) — Towering 2.22m biological VHS nightmare that WALKS TOWARD YOU!
      //    Backwards-cocked long skeletal legs + sunken black chest cavity caged by 14 exposed bone ribs +
      //    7 jagged dorsal spine spikes + 1.28m dragging ape-like arms with five 26cm curved scythe-claws per hand +
      //    wrenched elongated skull with asymmetric glowing IR eyes & unhinged lower jaw lined with 18 needle fangs!
      const buildStriderLeg = (sx) => this._mergeGeos([
        this._buildOrganicTube(
          [
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(sx * 0.06, -0.52, 0.10),       // Bowed skeletal thigh
            new THREE.Vector3(sx * 0.03, -0.82, -0.08),      // Backwards-cocked shin
            new THREE.Vector3(sx * 0.04, -1.08, 0.06)        // Elongated tarsus
          ],
          [0.068, 0.048, 0.036, 0.026], 8
        ),
        this._box(0.09, 0.045, 0.24, sx * 0.04, -1.09, 0.12) // Clawed foot
      ]);
      this.geoStriderLegL = buildStriderLeg(-1);
      this.geoStriderLegR = buildStriderLeg(1);

      // Sunken emaciated torso + 7 razor dorsal spine spikes + 7 pairs of exposed curved bone ribs!
      const striderTorsoFlesh = [
        this._buildLoftedRings([
          { y: -0.06, cx: 0, cz: -0.02, rx: 0.14, rz: 0.10 },
          { y:  0.14, cx: 0, cz: -0.01, rx: 0.095, rz: 0.075 }, // Hollow starved waist
          { y:  0.38, cx: 0, cz:  0.03, rx: 0.19, rz: 0.12 },   // Hunched broad ribcage
          { y:  0.58, cx: 0, cz:  0.07, rx: 0.24, rz: 0.13 },   // Contorted shoulders
          { y:  0.68, cx: 0, cz:  0.12, rx: 0.075, rz: 0.075 }  // Forward-craned neck base
        ], 14)
      ];
      for (let sp = 0; sp < 7; sp++) {
        const sy = 0.10 + sp * 0.082;
        const sz = -0.08 + (sp / 6) * 0.06;
        const spike = new THREE.ConeGeometry(0.024, 0.13 + (sp % 2) * 0.03, 5);
        spike.rotateX(-1.18);
        spike.translate(0, sy, sz - 0.05);
        striderTorsoFlesh.push(spike);
      }
      for (const s of [-1, 1]) {
        for (let r = 0; r < 7; r++) {
          const ry = 0.18 + r * 0.058;
          const rw = 0.14 + (r < 5 ? r * 0.022 : (6 - r) * 0.025);
          striderTorsoFlesh.push(
            this._buildOrganicTube(
              [
                new THREE.Vector3(0, ry + 0.02, -0.04),
                new THREE.Vector3(s * rw, ry, 0.06),
                new THREE.Vector3(s * 0.035, ry - 0.02, 0.155)
              ],
              [0.016, 0.019, 0.012], 6
            )
          );
        }
      }
      this.geoStriderTorso = this._mergeGeos(striderTorsoFlesh);

      const chestVoid = new THREE.SphereGeometry(0.13, 10, 8);
      chestVoid.scale(1.15, 1.55, 0.72);
      chestVoid.translate(0, 0.38, 0.05);
      this.geoStriderChestVoid = chestVoid;

      // Hyper-extended 1.26m long arms hanging past the knees + five 26cm curved scythe-claws per hand!
      const buildStriderLongArm = (sx) => {
        const parts = [
          this._buildOrganicTube(
            [
              new THREE.Vector3(0, 0, 0),
              new THREE.Vector3(sx * 0.14, -0.44, -0.05),
              new THREE.Vector3(sx * 0.08, -0.94,  0.14)
            ],
            [0.054, 0.042, 0.028], 8
          ),
          this._box(0.065, 0.095, 0.042, sx * 0.08, -0.99, 0.15)
        ];
        for (let f = 0; f < 5; f++) {
          const fx = sx * 0.08 + (f - 2) * 0.017;
          parts.push(
            this._buildOrganicTube(
              [
                new THREE.Vector3(fx, -1.03, 0.155),
                new THREE.Vector3(fx + sx * 0.015, -1.16, 0.21),
                new THREE.Vector3(fx - sx * 0.010, -1.28 - (f % 2) * 0.035, 0.16)
              ],
              [0.012, 0.008, 0.002], 5
            )
          );
        }
        return this._mergeGeos(parts);
      };
      this.geoStriderArmL = buildStriderLongArm(-1);
      this.geoStriderArmR = buildStriderLongArm(1);

      // Elongated sunken horror skull + unhinged hanging lower jaw!
      this.geoStriderSkull = this._buildLoftedRings([
        { y: -0.14, cz: 0.02, rx: 0.048, rz: 0.052 },
        { y: -0.02, cz: 0.05, rx: 0.062, rz: 0.072 },
        { y:  0.08, cz: 0.03, rx: 0.082, rz: 0.092 },
        { y:  0.17, cz: 0.02, rx: 0.112, rz: 0.106 },
        { y:  0.23, cz: 0.01, rx: 0.102, rz: 0.108, socketIndent: 0.042 },
        { y:  0.30, cz: 0.01, rx: 0.098, rz: 0.112 },
        { y:  0.36, cz: -0.01, rx: 0.062, rz: 0.072 },
        { y:  0.39, cz: -0.02, rx: 0.020, rz: 0.024 }
      ], 18);

      const stPitL = new THREE.SphereGeometry(0.036, 8, 6); stPitL.scale(1.2, 1.15, 0.7); stPitL.translate(-0.044, 0.23, 0.092);
      const stPitR = new THREE.SphereGeometry(0.034, 8, 6); stPitR.scale(1.15, 1.10, 0.7); stPitR.translate( 0.044, 0.225, 0.092);
      const stMaw = new THREE.SphereGeometry(0.068, 10, 8); stMaw.scale(1.05, 1.85, 0.92); stMaw.translate(0, 0.062, 0.088);
      const stTearL = this._box(0.015, 0.11, 0.016, -0.044, 0.16, 0.102);
      const stTearR = this._box(0.015, 0.11, 0.016,  0.044, 0.16, 0.102);
      this.geoStriderDarkMaw = this._mergeGeos([stPitL, stPitR, stMaw, stTearL, stTearR]);

      const stTeeth = [];
      for (let i = -4; i <= 4; i++) {
        const u = i / 4;
        const tx = u * 0.048;
        const tz = 0.112 + (1 - u * u) * 0.030;
        const ut = new THREE.ConeGeometry(0.0065, 0.048, 4);
        ut.rotateX(Math.PI);
        ut.translate(tx, 0.142 - Math.abs(u) * 0.020, tz);
        const lt = new THREE.ConeGeometry(0.0065, 0.050, 4);
        lt.translate(tx, -0.022 + Math.abs(u) * 0.018, tz - 0.004);
        stTeeth.push(ut, lt);
      }
      this.geoStriderTeeth = this._mergeGeos(stTeeth);

      const stEyeL = new THREE.SphereGeometry(0.0145, 7, 6); stEyeL.translate(-0.044, 0.232, 0.106);
      const stEyeR = new THREE.SphereGeometry(0.0085, 6, 5); stEyeR.translate( 0.044, 0.224, 0.106);
      this.geoStriderEyes = this._mergeGeos([stEyeL, stEyeR]);
    }

    // Builds a high-visibility Soviet military supply crate (`1.26x` scale) with a blazing chemical signal flare & rising smoke beacon!
    createMilitarySupplyCrate() {
      const group = new THREE.Group();
      const crateBody = new THREE.Group();
      crateBody.scale.setScalar(1.26);
      crateBody.add(
        new THREE.Mesh(this.geoMilitaryCrateWood, this.matMilitaryWood),
        new THREE.Mesh(this.geoMilitaryCrateMetal, this.matMilitaryMetal),
        new THREE.Mesh(this.geoMilitaryCrateStencil, this.matCrateStencil),
        new THREE.Mesh(this.geoSignalFlareTube, this.matFlareBody),
        new THREE.Mesh(this.geoSignalFlareTip, this.matFlareCore)
      );

      const haloMesh = new THREE.Mesh(this.geoSignalFlareHalo, this.matFlareHalo);
      const poolMesh = new THREE.Mesh(this.geoSignalFlarePool, this.matFlareHalo);

      const smokePuffs = [];
      for (let i = 0; i < 6; i++) {
        const puff = new THREE.Mesh(this.geoFlareSmokePuff, this.matFlareSmoke);
        puff.position.set(0.31, 0.50 + i * 0.48, 0.11);
        group.add(puff);
        smokePuffs.push(puff);
      }

      group.add(crateBody, haloMesh, poolMesh);
      return { group, haloMesh, poolMesh, smokePuffs };
    }

    // #1 «Ведомый» (Gaunt, starved hollow husk with wrenched neck, bleeding eye sockets, screaming jagged jaw & pinprick IR eyes)
    createTranceWalker(coatIdx = 0) {
      const group = new THREE.Group();
      const coatMat = this.matHumanCoats[coatIdx % this.matHumanCoats.length];

      const legL = new THREE.Mesh(this.geoHuskLegL, this.matTrousers);
      legL.position.set(-0.115, 0.92, 0);
      const legR = new THREE.Mesh(this.geoHuskLegR, this.matTrousers);
      legR.position.set( 0.115, 0.92, 0);

      const torso = new THREE.Group();
      torso.position.set(0, 0.92, 0);
      torso.rotation.x = 0.18;
      torso.add(new THREE.Mesh(this.geoHuskTorso, coatMat));

      const armL = new THREE.Group();
      armL.position.set(-0.225, 0.50, 0.03);
      armL.add(new THREE.Mesh(this.geoHuskSleeveL, coatMat), new THREE.Mesh(this.geoHuskHandL, this.matPaleFlesh));

      const armR = new THREE.Group();
      armR.position.set( 0.225, 0.50, 0.03);
      armR.add(new THREE.Mesh(this.geoHuskSleeveR, coatMat), new THREE.Mesh(this.geoHuskHandR, this.matPaleFlesh));

      const head = new THREE.Group();
      head.position.set(0, 0.60, 0.06);
      head.rotation.order = "YXZ";
      head.add(
        new THREE.Mesh(this.geoGauntSkull, this.matPaleFlesh),
        new THREE.Mesh(this.geoTranceDarkCavities, this.matMonsterMaw),
        new THREE.Mesh(this.geoTranceJaggedTeeth, this.matMonsterTeeth),
        new THREE.Mesh(this.geoPinprickIrEyes, this.matEyeGlow)
      );

      torso.add(armL, armR, head);
      group.add(legL, legR, torso);
      return { group, torso, head, armL, armR, legL, legR };
    }

    // #2 «Заражённый улыбкой» (Gaunt doppelgänger with wide bulging manic eyes & 24-tooth ear-to-ear razor grin!)
    createSmilingInfected(coatIdx = 1) {
      const group = new THREE.Group();
      const coatMat = this.matHumanCoats[coatIdx % this.matHumanCoats.length];

      const legL = new THREE.Mesh(this.geoHuskLegL, this.matTrousers);
      legL.position.set(-0.115, 0.92, 0);
      const legR = new THREE.Mesh(this.geoHuskLegR, this.matTrousers);
      legR.position.set( 0.115, 0.92, 0);

      const torso = new THREE.Group();
      torso.position.set(0, 0.92, 0);
      torso.rotation.x = 0.24;
      torso.add(new THREE.Mesh(this.geoHuskTorso, coatMat));

      const head = new THREE.Group();
      head.position.set(0, 0.60, 0.06);
      head.rotation.order = "YXZ";
      head.rotation.x = 0.14;
      head.scale.setScalar(1.12);
      head.add(
        new THREE.Mesh(this.geoGauntSkull, this.matInfectedSkin),
        new THREE.Mesh(this.geoInfectedMaw, this.matMonsterMaw),
        new THREE.Mesh(this.geoInfectedTeeth, this.matMonsterTeeth),
        new THREE.Mesh(this.geoManicBulgeEyes, this.matEyeGlow),
        new THREE.Mesh(this.geoManicPupils, this.matMonsterMaw)
      );

      const armL = new THREE.Group();
      armL.position.set(-0.22, 0.50, 0.05);
      armL.rotation.order = "YXZ";
      armL.add(new THREE.Mesh(this.geoInfectedSleeveL, coatMat), new THREE.Mesh(this.geoInfectedHandL, this.matInfectedSkin));

      const armR = new THREE.Group();
      armR.position.set( 0.22, 0.50, 0.05);
      armR.rotation.order = "YXZ";
      armR.add(new THREE.Mesh(this.geoInfectedSleeveR, coatMat), new THREE.Mesh(this.geoInfectedHandR, this.matInfectedSkin));

      torso.add(head, armL, armR);
      group.add(legL, legR, torso);
      return { group, torso, head, armL, armR, legL, legR };
    }

    // #4 «Длинный Наблюдатель» (2.68m bone-thin towering figure, dead-still posture & 75° tilting head — always visible above tall swamp grass!)
    createLankyWatcher(coatIdx = 0) {
      const group = new THREE.Group();
      const coatMat = this.matHumanCoats[coatIdx % this.matHumanCoats.length];

      const body = new THREE.Group();
      body.scale.set(0.84, 1.45, 0.84);

      const legL = new THREE.Mesh(this.geoHuskLegL, this.matTrousers);
      legL.position.set(-0.11, 0.92, 0);
      const legR = new THREE.Mesh(this.geoHuskLegR, this.matTrousers);
      legR.position.set( 0.11, 0.92, 0);

      const torso = new THREE.Group();
      torso.position.set(0, 0.92, 0);
      torso.rotation.x = 0.05;
      torso.add(new THREE.Mesh(this.geoHuskTorso, coatMat));

      const armL = new THREE.Group();
      armL.position.set(-0.22, 0.50, 0.01);
      armL.add(new THREE.Mesh(this.geoHuskSleeveL, coatMat), new THREE.Mesh(this.geoHuskHandL, this.matWatcherSkull));
      const armR = new THREE.Group();
      armR.position.set( 0.22, 0.50, 0.01);
      armR.add(new THREE.Mesh(this.geoHuskSleeveR, coatMat), new THREE.Mesh(this.geoHuskHandR, this.matWatcherSkull));

      const head = new THREE.Group();
      head.position.set(0, 0.61, 0.04);
      head.rotation.order = "YXZ";
      head.scale.set(0.95, 1.22, 0.95);
      head.add(
        new THREE.Mesh(this.geoGauntSkull, this.matWatcherSkull),
        new THREE.Mesh(this.geoWatcherFace, this.matMonsterMaw),
        new THREE.Mesh(this.geoWatcherTeeth, this.matMonsterTeeth),
        new THREE.Mesh(this.geoWatcherEyes, this.matEyeGlow)
      );

      torso.add(armL, armR, head);
      body.add(legL, legR, torso);
      group.add(body);
      return { group, torso, head, armL, armR, legL, legR };
    }

    // #5 «Искажённый Шатун» (2.22m gaunt skeletal-flesh horror with 1.28m scythe-clawed arms & unhinged needle-jaw that WALKS TOWARD YOU!)
    createContortedStrider() {
      const group = new THREE.Group();

      const legL = new THREE.Mesh(this.geoStriderLegL, this.matTrousers);
      legL.position.set(-0.14, 1.10, 0);
      const legR = new THREE.Mesh(this.geoStriderLegR, this.matTrousers);
      legR.position.set( 0.14, 1.10, 0);

      const torso = new THREE.Group();
      torso.position.set(0, 1.08, 0);
      torso.rotation.x = 0.28; // Hunched predatory stoop
      torso.add(
        new THREE.Mesh(this.geoStriderTorso, this.matPaleFlesh),
        new THREE.Mesh(this.geoStriderChestVoid, this.matMonsterMaw)
      );

      const armL = new THREE.Group();
      armL.position.set(-0.24, 0.56, 0.06);
      armL.rotation.order = "YXZ";
      armL.add(new THREE.Mesh(this.geoStriderArmL, this.matPaleFlesh));

      const armR = new THREE.Group();
      armR.position.set( 0.24, 0.56, 0.06);
      armR.rotation.order = "YXZ";
      armR.add(new THREE.Mesh(this.geoStriderArmR, this.matPaleFlesh));

      const head = new THREE.Group();
      head.position.set(0, 0.68, 0.12);
      head.rotation.order = "YXZ";
      head.rotation.set(-0.10, 0.0, 0.52); // Violently snapped neck hanging sideways!
      head.add(
        new THREE.Mesh(this.geoStriderSkull, this.matPaleFlesh),
        new THREE.Mesh(this.geoStriderDarkMaw, this.matMonsterMaw),
        new THREE.Mesh(this.geoStriderTeeth, this.matMonsterTeeth),
        new THREE.Mesh(this.geoStriderEyes, this.matEyeGlow)
      );

      torso.add(armL, armR, head);
      group.add(legL, legR, torso);
      return { group, torso, head, armL, armR, legL, legR };
    }

    // Creates a 3D 1998 Sony Handycam Hi8 camcorder prop hurled away when battery hits 0%!
    createCamcorderProp() {
      const group = new THREE.Group();
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0x222528, roughness: 0.45, metalness: 0.55 });
      const lensMat = new THREE.MeshStandardMaterial({ color: 0x090d10, roughness: 0.18, metalness: 0.85 });
      const lcdMat = new THREE.MeshBasicMaterial({ color: 0x12261a });

      const chassis = this._mergeGeos([
        this._box(0.095, 0.105, 0.21, 0, 0, 0),                   // Main Handycam body
        this._cyl(0.038, 0.036, 0.075, 14, 0, 0.015, -0.135, Math.PI * 0.5, 0, 0), // Objective lens barrel
        this._box(0.088, 0.065, 0.035, 0, 0.02, -0.175),          // Rectangular lens hood
        this._cyl(0.018, 0.018, 0.09, 10, 0, 0.068, -0.04, Math.PI * 0.5, 0, 0),   // Top stereo microphone
        this._box(0.036, 0.036, 0.065, -0.015, 0.055, 0.115, 0.35, 0, 0),          // Rear angled viewfinder
        this._box(0.11, 0.075, 0.012, -0.10, 0.005, -0.02, 0, 0.22, 0)             // Open flip-out LCD panel!
      ]);
      const lcdScreen = this._box(0.092, 0.058, 0.006, -0.10, 0.005, -0.014, 0, 0.22, 0);
      const glass = this._cyl(0.031, 0.031, 0.01, 14, 0, 0.015, -0.175, Math.PI * 0.5, 0, 0);

      group.add(
        new THREE.Mesh(chassis, bodyMat),
        new THREE.Mesh(lcdScreen, lcdMat),
        new THREE.Mesh(glass, lensMat)
      );
      group.userData.lcdMat = lcdMat;
      return group;
    }

    // Creates a realistic 3D handheld metal flashlight (NO fake light-cylinder mesh — pure real optical SpotLight!)
    createFlashlightProp() {
      const g = new THREE.Group();

      const metalBarrelMat = new THREE.MeshStandardMaterial({ color: 0x36404c, roughness: 0.36, metalness: 0.68 });
      const rubberGripMat = new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.88, metalness: 0.08 });
      const silverBezelMat = new THREE.MeshStandardMaterial({ color: 0xa2aebc, roughness: 0.24, metalness: 0.82 });
      const redSwitchMat = new THREE.MeshStandardMaterial({ color: 0xc42e26, roughness: 0.42, metalness: 0.12 });

      // 1. Cylindrical metal barrel + smooth seamless conical flare into wide flashlight head
      const barrel = new THREE.Mesh(
        this._mergeGeos([
          this._cyl(0.022, 0.022, 0.23, 18, 0, 0,  0.02,  Math.PI * 0.5, 0, 0),
          this._cyl(0.022, 0.046, 0.058, 18, 0, 0, -0.122, Math.PI * 0.5, 0, 0),
          this._cyl(0.046, 0.048, 0.038, 18, 0, 0, -0.169, Math.PI * 0.5, 0, 0)
        ]),
        metalBarrelMat
      );

      // 2. Knurled rubber grip rings along the handle + switch slider housing
      const gripParts = [
        this._box(0.016, 0.008, 0.044, 0, 0.022, -0.052)
      ];
      for (let i = 0; i < 6; i++) {
        gripParts.push(this._cyl(0.0238, 0.0238, 0.012, 14, 0, 0, 0.00 + i * 0.022, Math.PI * 0.5, 0, 0));
      }
      const grips = new THREE.Mesh(this._mergeGeos(gripParts), rubberGripMat);

      // 3. Brushed aluminum front bezel ring & rear battery tailcap ring
      const silverTrim = new THREE.Mesh(
        this._mergeGeos([
          this._cyl(0.0495, 0.0485, 0.016, 18, 0, 0, -0.192, Math.PI * 0.5, 0, 0),
          this._cyl(0.0245, 0.0245, 0.018, 16, 0, 0,  0.136, Math.PI * 0.5, 0, 0)
        ]),
        silverBezelMat
      );

      // 4. Red power slide-button right under thumb on top of barrel
      const switchBtn = new THREE.Mesh(
        this._box(0.011, 0.007, 0.018, 0, 0.0265, -0.056),
        redSwitchMat
      );

      // 5. Glowing warm glass reflector/lens disc inside bezel (NO fake beam cylinder!)
      const lensGeo = new THREE.CircleGeometry(0.044, 18);
      lensGeo.rotateY(Math.PI);
      lensGeo.translate(0, 0, -0.201);
      const lens = new THREE.Mesh(lensGeo, new THREE.MeshBasicMaterial({ color: 0xfff4d8 }));

      // 6. Subtle local hand rim light so the flashlight body in our right hand is clearly readable in the dark
      const handRim = new THREE.PointLight(0xdce6f2, 0.52, 0.75, 1.7);
      handRim.position.set(-0.12, 0.15, 0.08);

      g.add(barrel, grips, silverTrim, switchBtn, lens, handRim);
      return g;
    }

    _buildConiferBoughsGeo(seed) {
      const rand = mulberry32(seed);
      const parts = [];
      const levels = [2.8, 4.4, 6.0, 7.6, 9.1, 10.4];
      for (let li = 0; li < levels.length; li++) {
        const y = levels[li];
        const t = li / (levels.length - 1);
        const boughLen = 2.85 - t * 1.65;
        const boughW = boughLen * 0.88;
        const count = li < 3 ? 5 : 4;
        for (let c = 0; c < count; c++) {
          const ang = (c / count) * Math.PI * 2 + li * 0.65 + (rand() - 0.5) * 0.3;
          const p = new THREE.PlaneGeometry(boughW, boughLen);
          p.translate(0, -boughLen * 0.48, 0);
          p.rotateX(1.12 + t * 0.18);
          p.rotateY(ang);
          p.translate(0, y, 0);
          parts.push(p);
        }
      }
      return this._mergeGeos(parts);
    }

    _buildTrunkGeo(height, baseRadius, branchCount, seed) {
      const rand = mulberry32(seed);
      const positions = [], normals = [], uvs = [], indices = [];
      function appendTube(pts, radii, segs) {
        const baseVert = positions.length / 3;
        let vDist = 0;
        for (let j = 0; j < pts.length; j++) {
          if (j > 0) vDist += pts[j].distanceTo(pts[j - 1]) * 0.45;
          for (let i = 0; i <= segs; i++) {
            const u = i / segs;
            const ang = u * Math.PI * 2;
            let r = radii[j];
            if (j === 0) r *= 1.28 + 0.16 * Math.sin(ang * 4);
            const nx = Math.cos(ang), nz = Math.sin(ang);
            positions.push(pts[j].x + nx * r, pts[j].y, pts[j].z + nz * r);
            normals.push(nx, 0.1, nz);
            uvs.push(u, vDist);
          }
        }
        const row = segs + 1;
        for (let j = 0; j < pts.length - 1; j++) {
          for (let i = 0; i < segs; i++) {
            const a = baseVert + j * row + i, b = a + 1, c = a + row, d = c + 1;
            indices.push(a, c, b, b, c, d);
          }
        }
      }
      const spine = [], radii = [];
      const hSegs = 8;
      let dx = 0, dz = 0;
      for (let j = 0; j <= hSegs; j++) {
        const t = j / hSegs;
        const y = -0.25 + t * height;
        if (y > 2.6) { dx += (rand() - 0.5) * 0.34; dz += (rand() - 0.5) * 0.34; }
        spine.push(new THREE.Vector3(dx, y, dz));
        radii.push(baseRadius * (1.0 - 0.84 * Math.pow(t, 0.85)));
      }
      appendTube(spine, radii, 8);
      for (let b = 0; b < branchCount; b++) {
        const idx = 3 + (b % (hSegs - 4));
        const start = spine[idx].clone();
        const ang = (b / branchCount) * Math.PI * 2 + (rand() - 0.5) * 0.5;
        const dir = new THREE.Vector3(Math.cos(ang), 0.42 + rand() * 0.35, Math.sin(ang)).normalize();
        const bPts = [], bRad = [];
        const cur = start.clone();
        for (let k = 0; k <= 3; k++) {
          bPts.push(cur.clone());
          bRad.push(radii[idx] * 0.50 * (1 - 0.85 * (k / 3)));
          cur.addScaledVector(dir, 1.05);
          cur.y += (rand() - 0.40) * 0.25;
        }
        appendTube(bPts, bRad, 5);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      return geo;
    }

    reset() {
      for (const [, tile] of this.tiles) this._recycleTile(tile);
      this.tiles.clear();
      this.pendingQueue.length = 0;
      this.runSeed = Math.floor(Math.random() * 1000000);
      this._rebuildBiomeSequence();
      this.update(0, 4.0, 0, 1.0, null, true);
    }

    _recycleTile(tile) {
      this.scene.remove(tile.group);
      if (tile.terrainMesh) {
        tile.group.remove(tile.terrainMesh);
        this.terrainPool.push(tile.terrainMesh);
        tile.terrainMesh = null;
      }
    }

    update(playerX, playerZ, dt, battery = 1.0, onHorrorEvent = null, buildAllSync = false, hideAllEnemies = false) {
      this.time += dt;
      const curCx = Math.floor(playerX / TILE_SIZE);
      const curCz = Math.floor(playerZ / TILE_SIZE);

      const needed = new Set();
      for (let cz = curCz + this.tilesZBehind; cz >= curCz - this.tilesZAhead; cz--) {
        for (let cx = curCx - this.tilesXRadius; cx <= curCx + this.tilesXRadius; cx++) {
          const key = `${cx},${cz}`;
          needed.add(key);
          if (!this.tiles.has(key) && !this.pendingQueue.some((q) => q.key === key)) {
            this.pendingQueue.push({ cx, cz, key });
          }
        }
      }

      for (const [key, tile] of this.tiles) {
        if (!needed.has(key)) {
          this._recycleTile(tile);
          this.tiles.delete(key);
        }
      }

      if (buildAllSync) {
        while (this.pendingQueue.length > 0) {
          const item = this.pendingQueue.shift();
          if (needed.has(item.key) && !this.tiles.has(item.key)) this._spawnTile(item.cx, item.cz, item.key);
        }
      } else if (this.pendingQueue.length > 0) {
        this.pendingQueue.sort((a, b) => Math.hypot(a.cx - curCx, a.cz - curCz) - Math.hypot(b.cx - curCx, b.cz - curCz));
        const maxBuild = this.mobilePerf ? 1 : 2;
        for (let q = 0; q < maxBuild && this.pendingQueue.length > 0; q++) {
          const item = this.pendingQueue.shift();
          if (needed.has(item.key) && !this.tiles.has(item.key)) this._spawnTile(item.cx, item.cz, item.key);
        }
      }

      // Animate tile set-pieces (NEVER tilt tile.foliageMesh around tile origin — keeps every grass root 100% locked to soil!)
      for (const [, tile] of this.tiles) {
        if (tile.windmillRotor) {
          tile.windmillRotor.rotation.z += dt * 1.35;
        }
        for (const p of tile.pickups) {
          if (!p.taken) {
            if (battery <= 0.001 || hideAllEnemies) {
              p.mesh.visible = false;
            } else {
              const d2 = (playerX - p.x) ** 2 + (playerZ - p.z) ** 2;
              p.mesh.visible = d2 < 38.0 * 38.0;
              if (p.mesh.visible && p.flare) {
                const sputter = 0.86 + 0.24 * Math.sin(this.time * 43.0 + p.x) * Math.cos(this.time * 29.0 + p.z);
                p.flare.haloMesh.scale.setScalar(sputter);
                for (let si = 0; si < p.flare.smokePuffs.length; si++) {
                  const puff = p.flare.smokePuffs[si];
                  const u = (this.time * 0.85 + si * 0.33) % 1.0;
                  puff.position.set(
                    0.25 + Math.sin(this.time * 2.2 + si * 2.0) * 0.05 * u,
                    0.38 + u * 0.68,
                    0.09 - u * 0.08
                  );
                  puff.scale.setScalar(0.55 + u * 1.45);
                }
              }
            }
          }
        }

        if (tile.enemies && tile.enemies.length > 0) {
          if (hideAllEnemies) {
            for (const e of tile.enemies) {
              if (e.group.visible) e.group.visible = false;
              e.ob.active = false;
            }
          } else {
            this._updateTileEnemies(tile, playerX, playerZ, dt, battery, onHorrorEvent);
          }
        }

        if (tile.crowFlock && !hideAllEnemies) {
          const cf = tile.crowFlock;
          if (!cf.triggered) {
            if ((playerX - cf.wx) ** 2 + (playerZ - cf.wz) ** 2 < 13.8 * 13.8) {
              cf.triggered = true;
              cf.group.visible = true;
              if (onHorrorEvent) onHorrorEvent("crows", cf.wx - playerX, cf.wz - playerZ);
            }
          } else if (cf.flyTime < 3.5) {
            cf.flyTime += dt;
            cf.group.position.y += dt * 5.8;
            cf.group.position.z += dt * 3.2;
            for (let i = 0; i < cf.birds.length; i++) {
              const b = cf.birds[i];
              b.position.x += b.userData.vx * dt;
              b.position.z += b.userData.vz * dt;
              b.scale.y = 0.4 + Math.abs(Math.sin(this.time * 26.0 + i * 1.4)) * 1.2;
            }
            if (cf.flyTime >= 3.5) cf.group.visible = false;
          }
        }

        if (!hideAllEnemies) {
          for (const snd of tile.soundSpots) {
            if (snd.played) continue;
            const rx = snd.wx - playerX, rz = snd.wz - playerZ;
            if (rx * rx + rz * rz < snd.range * snd.range) {
              snd.played = true;
              if (onHorrorEvent) onHorrorEvent(snd.kind, rx, rz);
            }
          }
        }
      }
    }

    _spawnTile(cx, cz, key) {
      const seed = (this.runSeed ^ Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663)) >>> 0;
      const rand = mulberry32(seed);
      const wx0 = cx * TILE_SIZE;
      const wz0 = cz * TILE_SIZE;
      const centerX = wx0 + TILE_SIZE * 0.5;
      const centerZ = wz0 + TILE_SIZE * 0.5;

      const group = new THREE.Group();
      group.position.set(centerX, 0, centerZ);
      this.scene.add(group);

      const terrainMesh = this._acquireTerrainMesh(centerX, centerZ);
      group.add(terrainMesh);

      const obstacles = [];
      const pickups = [];
      const soundSpots = [];
      const enemies = [];
      let windmillRotor = null;
      let crowFlock = null;
      let foliageMesh = null;

      const tooClose = (wx, wz, minDist) => {
        for (const ob of obstacles) {
          if ((wx - ob.x) ** 2 + (wz - ob.z) ** 2 < minDist * minDist) return true;
        }
        return false;
      };
      // Keep BOTH the opening area (-18m..+8m) AND the 3,000m Finale Open Field (-2960m..-3152m) clear of random clutter!
      const isSpawnArea = (wx, wz) =>
        (Math.abs(wx) < 5.0 && wz > -18.0 && wz < 8.0) ||
        (wz < -2960.0 && wz > -3152.0);

      const zone = this.zoneAt(centerX, centerZ);
      // No road asphalt or roadside power poles inside the 3,000m Finale Open Field (`zone === 9`)!
      const hasRoad = (zone !== 9) && Math.abs(this.roadCenterX(centerZ) - centerX) < TILE_SIZE * 0.82;
      if (hasRoad) {
        this._addRoadOnTile(group, centerX, centerZ, wz0, obstacles, soundSpots, rand, tooClose, isSpawnArea);
      }

      if (zone === 1) {
        // === BIOME 1: ROW-PLANTED TALL HEMP FIELD (`Поле дикой конопли рядами`) & WATER TOWER! ===
        const wtX = centerX + (rand() - 0.5) * 14.0;
        const wtZ = centerZ + (rand() - 0.5) * 12.0;
        if ((Math.abs(cx + cz) % 3 === 0) && !this.isNearRoad(wtX, wtZ, 8.5) && !isSpawnArea(wtX, wtZ)) {
          const wt = new THREE.Mesh(this.geoWaterTower, this.matRust);
          wt.position.set(wtX - centerX, this.terrainHeight(wtX, wtZ) - 0.15, wtZ - centerZ);
          group.add(wt);
          // 4 individual corner-leg colliders ONLY — wide 3.4m open walkthrough passage right underneath the water tower!
          for (const lx of [-1.72, 1.72]) {
            for (const lz of [-1.72, 1.72]) {
              obstacles.push({
                type: "circle", x: wtX + lx, z: wtZ + lz, crashR: 0.17, grazeR: 0.34, nearR: 1.6, nearPlayed: false
              });
            }
          }
          soundSpots.push({ kind: "windmill_creak", wx: wtX, wz: wtZ, range: 22.0, played: false });
        }

        // Occasional wooden irrigation barrels / hay bales between rows so you weave across rows!
        for (let b = 0; b < 3; b++) {
          const bx = centerX + (rand() - 0.5) * (TILE_SIZE - 4.0);
          const bz = centerZ + (rand() - 0.5) * (TILE_SIZE - 4.0);
          if (this.isNearRoad(bx, bz, 5.5) || isSpawnArea(bx, bz) || tooClose(bx, bz, 6.5)) continue;
          const drums = new THREE.Mesh(this.geoOilDrums, this.matRust);
          drums.position.set(bx - centerX, this.terrainHeight(bx, bz) - 0.05, bz - centerZ);
          group.add(drums);
          obstacles.push({ type: "circle", x: bx, z: bz, crashR: 0.58, grazeR: 0.95, nearR: 2.2, nearPlayed: false });
        }

        // PLANT IN CRISP PARALLEL ROWS (`рядами как в оригинале`! Clear aisles between rows!)
        foliageMesh = this._populateRowField(group, wx0, wz0, centerX, centerZ, rand, this.geoHempBush, this.matHemp, obstacles);

      } else if (zone === 2) {
        // === BIOME 2: ABANDONED RAILWAY EMBANKMENT & DERAILED FREIGHT BOXCARS (`Железная дорога и вагоны`)! ===
        // Diagonal railway track + wooden sleepers + steel rails across tile!
        this._buildRailwayOnTile(group, centerX, centerZ, wx0, wz0, obstacles, soundSpots, rand, tooClose, isSpawnArea);
        this._populateTrees(group, centerX, centerZ, 10, 0.55, rand, obstacles, tooClose, isSpawnArea, false, false);
        foliageMesh = this._populateScattered(group, centerX, centerZ, rand, this.geoGrassTuft, this.matGrass, 260, 1.0);

      } else if (zone === 3) {
        // === BIOME 3: MISTY DEAD SWAMP, CATTAILS & SUNKEN BOAT (`Мёртвое болото и камыши`)! ===
        // Shallow reflective swamp pool
        const poolGeo = new THREE.CircleGeometry(9.5, 16);
        poolGeo.rotateX(-Math.PI * 0.5);
        const pool = new THREE.Mesh(poolGeo, this.matSwampWater);
        const py = this.terrainHeight(centerX, centerZ) + 0.05;
        pool.position.set(0, py, 0);
        group.add(pool);

        if (rand() < 0.65 && !this.isNearRoad(centerX, centerZ, 7.0)) {
          const boat = new THREE.Mesh(this.geoSwampBoat, this.matBarnWood);
          boat.position.set(2.2, py, -1.5);
          boat.rotation.y = rand() * Math.PI;
          group.add(boat);
          obstacles.push({ type: "box", x: centerX + 2.2, z: centerZ - 1.5, hx: 0.72, hz: 1.75, yaw: boat.rotation.y, nearPlayed: false });
        }

        this._populateTrees(group, centerX, centerZ, 12, 0.0, rand, obstacles, tooClose, isSpawnArea, false, true);
        foliageMesh = this._populateScattered(group, centerX, centerZ, rand, this.geoReedClump, this.matReed, 240, 1.0);

      } else if (zone === 4) {
        // === BIOME 4: ABANDONED SAWMILL, GANTRY CRANE & TIMBER STACKS (`Старая лесопилка`)! ===
        const crX = centerX + (rand() - 0.5) * 10.0;
        const crZ = centerZ + (rand() - 0.5) * 10.0;
        if (!this.isNearRoad(crX, crZ, 8.5) && !isSpawnArea(crX, crZ)) {
          const crane = new THREE.Mesh(this.geoSawmillCrane, this.matRust);
          crane.position.set(crX - centerX, this.terrainHeight(crX, crZ) - 0.15, crZ - centerZ);
          group.add(crane);
          // Colliders only on left & right A-frame legs (7.2m wide clear passage underneath!)
          obstacles.push(
            { type: "circle", x: crX - 3.8, z: crZ, crashR: 0.35, grazeR: 0.65, nearR: 2.0, nearPlayed: false },
            { type: "circle", x: crX + 3.8, z: crZ, crashR: 0.35, grazeR: 0.65, nearR: 2.0, nearPlayed: false }
          );
          soundSpots.push({ kind: "windmill_creak", wx: crX, wz: crZ, range: 22.0, played: false });
        }

        for (let l = 0; l < 4; l++) {
          const lx = centerX + (rand() - 0.5) * (TILE_SIZE - 6.0);
          const lz = centerZ + (rand() - 0.5) * (TILE_SIZE - 6.0);
          if (this.isNearRoad(lx, lz, 6.0) || isSpawnArea(lx, lz) || tooClose(lx, lz, 5.5)) continue;
          const logs = new THREE.Mesh(this.geoLogPile, this.matPine);
          const lyaw = (rand() - 0.5) * 0.8;
          logs.position.set(lx - centerX, this.terrainHeight(lx, lz) - 0.05, lz - centerZ);
          logs.rotation.y = lyaw;
          group.add(logs);
          obstacles.push({ type: "box", x: lx, z: lz, hx: 0.85, hz: 1.85, yaw: lyaw, nearPlayed: false });
        }

        this._populateTrees(group, centerX, centerZ, 8, 0.4, rand, obstacles, tooClose, isSpawnArea, false, false);
        foliageMesh = this._populateScattered(group, centerX, centerZ, rand, this.geoGrassTuft, this.matGrass, 220, 0.95);

      } else if (zone === 5) {
        // === BIOME 5: ROW-PLANTED CORNFIELD + RUN-THROUGH BARN & SPINNING WINDMILL! ===
        const mainWx = centerX + (rand() - 0.5) * 10.0;
        const mainWz = centerZ + (rand() - 0.5) * 8.0;
        if (!this.isNearRoad(mainWx, mainWz, 10.5) && !isSpawnArea(mainWx, mainWz)) {
          if ((cx + cz) % 2 === 0) {
            const barn = new THREE.Group();
            barn.add(new THREE.Mesh(this.geoBarnWalls, this.matBarnWood), new THREE.Mesh(this.geoBarnRoof, this.matRoof));
            const by = this.terrainHeight(mainWx, mainWz) - 0.15;
            barn.position.set(mainWx - centerX, by, mainWz - centerZ);
            group.add(barn);
            obstacles.push(
              { type: "box", x: mainWx - 3.65, z: mainWz, hx: 0.24, hz: 5.05, yaw: 0, nearPlayed: false },
              { type: "box", x: mainWx + 3.65, z: mainWz, hx: 0.24, hz: 5.05, yaw: 0, nearPlayed: false }
            );
          } else {
            const wm = new THREE.Group();
            wm.add(new THREE.Mesh(this.geoWindmillTower, this.matRust));
            windmillRotor = new THREE.Mesh(this.geoWindmillRotor, this.matRust);
            windmillRotor.position.set(0, 11.1, 0.55);
            wm.add(windmillRotor);
            wm.position.set(mainWx - centerX, this.terrainHeight(mainWx, mainWz) - 0.15, mainWz - centerZ);
            group.add(wm);
            // 4 individual corner-leg colliders ONLY — wide 3.1m open walkthrough passage underneath the windmill!
            for (const lx of [-1.58, 1.58]) {
              for (const lz of [-1.58, 1.58]) {
                obstacles.push({
                  type: "circle", x: mainWx + lx, z: mainWz + lz, crashR: 0.16, grazeR: 0.32, nearR: 1.6, nearPlayed: false
                });
              }
            }
            soundSpots.push({ kind: "windmill_creak", wx: mainWx, wz: mainWz, range: 24.0, played: false });
          }
        }

        for (let i = 0; i < 3; i++) {
          const bx = centerX + (rand() - 0.5) * (TILE_SIZE - 4.0);
          const bz = centerZ + (rand() - 0.5) * (TILE_SIZE - 4.0);
          if (this.isNearRoad(bx, bz, 6.0) || isSpawnArea(bx, bz) || tooClose(bx, bz, 6.2)) continue;
          const bale = new THREE.Mesh(this.geoHayBale, this.matHay);
          bale.position.set(bx - centerX, this.terrainHeight(bx, bz) - 0.05, bz - centerZ);
          bale.rotation.y = rand() * Math.PI;
          group.add(bale);
          obstacles.push({ type: "circle", x: bx, z: bz, crashR: 0.65, grazeR: 1.02, nearR: 2.3, nearPlayed: false });
        }

        // PLANT CORN IN CRISP PARALLEL ROWS (`рядами как в оригинале`!)
        foliageMesh = this._populateRowField(group, wx0, wz0, centerX, centerZ, rand, this.geoCornClump, this.matCorn, obstacles);

      } else if (zone === 6) {
        // === BIOME 6: EVACUATION BLOCKPOST, CONCRETE BUS STOP & DETAILED MI-8 HELICOPTER CRASH! ===
        const hz = centerZ + 7.2; // Offset cleanly from roadside power pole at centerZ!
        const sideSign = ((Math.abs(cx) + Math.abs(cz)) % 2 === 0) ? -1 : 1; // Place on opposite side from power pole (+5.5m) when even!
        const hx = hasRoad ? (this.roadCenterX(hz) + sideSign * 7.2) : (centerX + (rand() - 0.5) * 10.0);
        if (Math.abs(hx - centerX) < TILE_SIZE * 0.46 && !isSpawnArea(hx, hz)) {
          if (hasRoad || (Math.abs(cx + cz) % 2 === 0)) {
            const heli = this.createCrashedHelicopter();
            const hyaw = sideSign > 0 ? -0.68 : 0.68; // Angled dramatically toward camera!
            heli.position.set(hx - centerX, this.terrainHeight(hx, hz) - 0.14, hz - centerZ);
            heli.rotation.order = "YXZ";
            // Cohesive crash tilt applied to the whole assembled Mi-8 Group so every window, rotor & wheel stays 100% aligned!
            heli.rotation.set(0.08, hyaw, sideSign > 0 ? -0.20 : 0.20);
            group.add(heli);
            // Tight cabin-only collider (excludes the high raised tailboom so you never hit invisible air behind the tail!)
            const heliCabX = hx + Math.sin(hyaw) * 0.95;
            const heliCabZ = hz + Math.cos(hyaw) * 0.95;
            obstacles.push({ type: "box", x: heliCabX, z: heliCabZ, hx: 1.22, hz: 2.95, yaw: hyaw, nearPlayed: false });
            soundSpots.push({ kind: "radio_static", wx: hx, wz: hz, range: 24.0, played: false });
          } else {
            const busStop = new THREE.Mesh(this.geoBusStop, this.matStone);
            busStop.position.set(hx - centerX, this.terrainHeight(hx, hz) - 0.08, hz - centerZ);
            busStop.rotation.y = Math.PI * 0.5;
            group.add(busStop);
            // Thin wall-only colliders matching the rotated shelter walls so the interior under the roof is open!
            obstacles.push(
              { type: "box", x: hx - 1.15, z: hz,       hx: 0.16, hz: 2.30, yaw: 0, nearPlayed: false },
              { type: "box", x: hx,        z: hz + 2.2, hx: 1.18, hz: 0.16, yaw: 0, nearPlayed: false },
              { type: "box", x: hx - 0.50, z: hz - 2.2, hx: 0.68, hz: 0.16, yaw: 0, nearPlayed: false }
            );
          }
        }

        // Keep trees clear of the crash site so the Mi-8 wreck is never obstructed!
        this._populateTrees(group, centerX, centerZ, 5, 0.55, rand, obstacles, (tx, tz, r) => tooClose(tx, tz, Math.max(r, 7.5)), isSpawnArea, false, false);
        foliageMesh = this._populateScattered(group, centerX, centerZ, rand, this.geoGrassTuft, this.matGrass, 280, 1.10);

      } else if (zone === 7) {
        // === BIOME 7: SCORCHED ASH FOREST (`Выгоревший лес` — stoves removed, dark charred fallen timber instead!) ===
        for (let c = 0; c < 2; c++) {
          const rx = centerX + (rand() - 0.5) * 18.0;
          const rz = centerZ + (rand() - 0.5) * 18.0;
          if (this.isNearRoad(rx, rz, 6.0) || isSpawnArea(rx, rz) || tooClose(rx, rz, 6.0)) continue;
          const charredLogs = new THREE.Mesh(this.geoLogPile, this.matCharred);
          const cyaw = (rand() - 0.5) * 1.4;
          charredLogs.position.set(rx - centerX, this.terrainHeight(rx, rz) - 0.06, rz - centerZ);
          charredLogs.rotation.y = cyaw;
          group.add(charredLogs);
          obstacles.push({ type: "box", x: rx, z: rz, hx: 0.85, hz: 1.85, yaw: cyaw, nearPlayed: false });
        }

        this._populateTrees(group, centerX, centerZ, 16, 0.0, rand, obstacles, tooClose, isSpawnArea, false, true);
        foliageMesh = this._populateScattered(group, centerX, centerZ, rand, this.geoGrassTuft, this.matGrass, 140, 0.75);

      } else if (zone === 8) {
        // === BIOME 8: DEAD VILLAGE, ABANDONED TOWN HALL AND OLD TOMBSTONES ===
        const chZ = centerZ + (rand() - 0.5) * 8.0;
        const chX = hasRoad ? (this.roadCenterX(chZ) + (((Math.abs(cx + cz) % 2 === 0) ? 1 : -1) * 9.2)) : (centerX + (rand() - 0.5) * 10.0);
        if (Math.abs(chX - centerX) < TILE_SIZE * 0.46 && !isSpawnArea(chX, chZ)) {
          if (hasRoad || ((Math.abs(cx) + Math.abs(cz)) % 2 === 0)) {
            // Square civic clock tower, with large dials facing all four directions.
            const townHall = new THREE.Group();
            townHall.userData.isTownHall = true;
            townHall.add(
              new THREE.Mesh(this.geoTownHallStone, this.matTownHallFacade),
              new THREE.Mesh(this.geoTownHallRoof, this.matTownHallRoof)
            );
            for (let side = 0; side < 4; side++) {
              const dial = new THREE.Mesh(this.geoClockFace, this.matClockFace);
              dial.rotation.y = side * Math.PI / 2;
              const radius = side % 2 ? 1.711 : 1.611;
              dial.position.set(Math.sin(dial.rotation.y) * radius, 7.65, 2.65 + Math.cos(dial.rotation.y) * radius);
              townHall.add(dial);
            }
            townHall.position.set(chX - centerX, this.terrainHeight(chX, chZ) - 0.20, chZ - centerZ);
            group.add(townHall);
            obstacles.push({ type: "box", x: chX, z: chZ, hx: 3.1, hz: 4.3, yaw: 0, nearPlayed: false });
            soundSpots.push({ kind: "clock_bell", wx: chX, wz: chZ, range: 32.0, played: false });

            // Surrounding crossless stone grave markers
            for (let g = 0; g < 6; g++) {
              const gx = chX + (rand() < 0.5 ? -1 : 1) * (4.8 + rand() * 5.0);
              const gz = chZ + (rand() - 0.5) * 12.0;
              if (Math.abs(gx - centerX) < 14.5 && !this.isNearRoad(gx, gz, 5.0) && !tooClose(gx, gz, 3.8)) {
                const stone = new THREE.Mesh(this.geoGravestone, this.matStone);
                stone.position.set(gx - centerX, this.terrainHeight(gx, gz) - 0.08, gz - centerZ);
                group.add(stone);
                obstacles.push({ type: "circle", x: gx, z: gz, crashR: 0.25, grazeR: 0.48, nearR: 2.0, nearPlayed: false });
              }
            }
          } else {
            // Clean Log Cabin (`Изба`) + Fence
            const cabYaw = (rand() - 0.5) * 0.45;
            const cabin = new THREE.Group();
            cabin.add(
              new THREE.Mesh(this.geoCabinWalls, this.matCabinFacade),
              new THREE.Mesh(this.geoCabinTrim, this.matPine),
              new THREE.Mesh(this.geoCabinRoof, this.matRoof)
            );
            cabin.position.set(chX - centerX, this.terrainHeight(chX, chZ) - 0.18, chZ - centerZ);
            cabin.rotation.y = cabYaw;
            group.add(cabin);
            obstacles.push({ type: "box", x: chX, z: chZ, hx: 2.45, hz: 2.85, yaw: cabYaw, nearPlayed: false });
          }
        }

        // Keep trees clear of the town hall and clock tower silhouette.
        this._populateTrees(group, centerX, centerZ, 6, 0.65, rand, obstacles, (tx, tz, r) => tooClose(tx, tz, Math.max(r, 8.2)), isSpawnArea, false, false);
        foliageMesh = this._populateScattered(group, centerX, centerZ, rand, this.geoGrassTuft, this.matGrass, 240, 0.95);

      } else if (zone === 9) {
        // === BIOME 9: WIDE OPEN FINALE FIELD (`Открытое поле в финале 5,000м`) — zero trees, zero buildings, pure open grass! ===
        foliageMesh = this._populateScattered(group, centerX, centerZ, rand, this.geoGrassTuft, this.matGrass, 380, 1.05);

      } else {
        // === BIOME 0: DEEP OLD-GROWTH TAIGA & BLAIR-WITCH TOTEMS ===
        this._populateTrees(group, centerX, centerZ, 19, 0.36, rand, obstacles, tooClose, isSpawnArea, true, false);
        foliageMesh = this._populateScattered(group, centerX, centerZ, rand, this.geoGrassTuft, this.matGrass, 260, 0.95);
        this._populateScattered(group, centerX, centerZ, rand, this.geoFernRosette, this.matFern, 65, 1.0);
      }

      // Populate Road & Forest Enemies (none in Finale Open Field `zone === 9`!)
      if (zone !== 9) {
        this._spawnEnemiesOnTile(group, cx, cz, zone, hasRoad, centerX, centerZ, wz0, obstacles, enemies, rand, tooClose, isSpawnArea);
      }

      // Crow Flock Scare
      if (zone !== 9 && rand() < 0.28 && (Math.abs(cx) + Math.abs(cz) >= 1)) {
        const cfx = centerX + (rand() - 0.5) * 14.0;
        const cfz = centerZ + (rand() - 0.5) * 14.0;
        if (!isSpawnArea(cfx, cfz)) {
          const cfGroup = new THREE.Group();
          cfGroup.position.set(cfx - centerX, this.terrainHeight(cfx, cfz) + 0.5, cfz - centerZ);
          cfGroup.visible = false;
          const birds = [];
          for (let b = 0; b < 7; b++) {
            const bird = new THREE.Mesh(this.geoCrow, this.matDark);
            bird.position.set((rand() - 0.5) * 2.5, rand() * 0.8, (rand() - 0.5) * 2.5);
            bird.userData = { vx: (rand() - 0.5) * 5.5, vz: (rand() - 0.5) * 3.5 };
            cfGroup.add(bird);
            birds.push(bird);
          }
          group.add(cfGroup);
          crowFlock = { group: cfGroup, birds, wx: cfx, wz: cfz, triggered: false, flyTime: 0 };
        }
      }

      // Military Supply Crate + Blazing Signal Flare Pickup (frequent & clearly placed along open road/lanes!)
      const crateChance = hasRoad ? 0.86 : 0.60;
      if (zone !== 9 && rand() < crateChance && centerZ < -26.0 && centerZ > -4905.0) {
        for (let att = 0; att < 14; att++) {
          const pz = wz0 + 3.0 + rand() * (TILE_SIZE - 6.0);
          const px = hasRoad
            ? (this.roadCenterX(pz) + (rand() - 0.5) * 6.8)
            : (centerX + (rand() - 0.5) * 18.0);
          if (Math.abs(px - centerX) > TILE_SIZE * 0.45) continue;
          if (!isSpawnArea(px, pz) && !tooClose(px, pz, 1.45)) {
            const flareProp = this.createMilitarySupplyCrate();
            flareProp.group.position.set(px - centerX, this.terrainHeight(px, pz), pz - centerZ);
            flareProp.group.rotation.y = (rand() - 0.5) * 1.4;
            group.add(flareProp.group);
            pickups.push({ mesh: flareProp.group, flare: flareProp, x: px, z: pz, taken: false });
            break;
          }
        }
      }

      this.tiles.set(key, {
        cx, cz, zone, centerX, centerZ, group, terrainMesh, foliageMesh, windmillRotor, enemies, crowFlock, soundSpots, obstacles, pickups
      });
    }

    _canEnemyStepTo(tile, enemy, nx, nz, ignoreEnemies = false) {
      for (const ob of tile.obstacles) {
        if (ob === enemy.ob || ob.active === false) continue;
        if (ignoreEnemies && ob.isEnemy) continue;
        if (ob.type === "circle") {
          const minR = ob.isEnemy ? 0.44 : ((ob.crashR || 0.3) + 0.50);
          if ((nx - ob.x) ** 2 + (nz - ob.z) ** 2 < minR * minR) return false;
        } else if (ob.type === "box") {
          const cy = Math.cos(ob.yaw || 0), sy = Math.sin(ob.yaw || 0);
          const rx = nx - ob.x, rz = nz - ob.z;
          const lx = rx * cy - rz * sy, lz = rx * sy + rz * cy;
          if (Math.abs(lx) < ob.hx + 0.55 && Math.abs(lz) < ob.hz + 0.55) return false;
        }
      }
      // Never let oncoming runners (`contorted_strider`) run into tall-crop fields (hemp/corn/tall reeds) or finale clearing!
      if (enemy.kind === "contorted_strider") {
        const zNext = this.zoneAt(nx, nz);
        if (zNext === 9) return false;
        if ((zNext === 1 || zNext === 5 || zNext === 3) && !this.isNearRoad(nx, nz, 3.8)) {
          return false;
        }
      }
      return true;
    }

    _spawnEnemiesOnTile(group, cx, cz, zone, hasRoad, centerX, centerZ, wz0, obstacles, enemies, rand, tooClose, isSpawnArea) {
      // Keep the opening area (-24m .. +10m) AND the 3,000m Finale Open Field (-2960m .. -3152m) completely clear of enemies!
      if (zone === 9 || centerZ > -18.0 || (centerZ < -2960.0 && centerZ > -3152.0)) return;

      const isNearAnyObstacle = (ex, ez, minObsDist, minEnemyDist) => {
        if (isSpawnArea(ex, ez) || ez > -22.0) return true;

        const checkObList = (obList) => {
          for (const ob of obList) {
            if (ob.active === false) continue;
            if (ob.isEnemy) {
              if ((ex - ob.x) ** 2 + (ez - ob.z) ** 2 < minEnemyDist * minEnemyDist) return true;
            } else if (ob.type === "box") {
              const cy = Math.cos(ob.yaw || 0), sy = Math.sin(ob.yaw || 0);
              const rx = ex - ob.x, rz = ez - ob.z;
              const lx = Math.abs(rx * cy - rz * sy);
              const lz = Math.abs(rx * sy + rz * cy);
              if (lx < (ob.hx || 1.0) + minObsDist && lz < (ob.hz || 1.0) + minObsDist) return true;
            } else {
              const rClear = (ob.grazeR || ob.crashR || 0.35) + minObsDist;
              if ((ex - ob.x) ** 2 + (ez - ob.z) ** 2 < rClear * rClear) return true;
            }
          }
          return false;
        };

        if (checkObList(obstacles)) return true;
        for (let ncx = cx - 1; ncx <= cx + 1; ncx++) {
          for (let ncz = cz - 1; ncz <= cz + 1; ncz++) {
            if (ncx === cx && ncz === cz) continue;
            const nt = this.tiles.get(`${ncx},${ncz}`);
            if (nt && checkObList(nt.obstacles)) return true;
          }
        }
        return false;
      };

      // Progressive Distance Scaling: 1.0x monsters at 0m -> smoothly ramping up to 2.0x monsters at 3,000m!
      const distProg = Math.max(0.0, Math.min(1.0, (-centerZ - 24.0) / 2900.0));
      const distDifficultyMult = 1.0 + distProg;

      // Guaranteed wide walkthrough spacing (Blue-Noise): NEVER clumped into walls, NEVER pinched against trees/cars!
      const minEnemyGap = 2.50 - distProg * 0.62; // 2.50m at 0m -> 1.88m at 3,000m (always wide enough to weave cleanly!)
      const minObsGap = 1.45 - distProg * 0.15;   // Clear walkthrough gap around every tree, car, log pile & boxcar!

      // NO oncoming runners (`contorted_strider`) in tall-crop fields (`zone === 1` hemp & `zone === 5` corn) where tall plants block sightlines!
      const isTallCropBiome = (zone === 1 || zone === 5);
      const maxStridersOnTile = isTallCropBiome
        ? 0
        : (1 + Math.floor(distProg * 2.2 + (hasRoad ? 0.6 : 0.0)));
      let stridersOnTile = 0;

      // Exact spawn ratio among standing monsters:
      // smiling_infected : trance_walker : lanky_watcher = 6 : 3 : 2
      // (trance_walker = 1/2 of smiling_infected, lanky_watcher = 1/3 of smiling_infected!)
      const pickStandardKind = () => {
        const s = rand();
        if (s < 6 / 11) return "smiling_infected";
        if (s < 9 / 11) return "trance_walker";
        return "lanky_watcher";
      };

      const pickEnemyKind = (isNoCamExtra) => {
        const rType = rand();
        if (!isNoCamExtra && stridersOnTile < maxStridersOnTile && rType < 0.12) {
          return "contorted_strider";
        }
        return pickStandardKind();
      };

      const placeEnemyAt = (ex, ez, isNoCamExtra) => {
        const ptZone = this.zoneAt(ex, ez);
        let kind;
        // In tall non-row swamp grass (tile zone 3 OR point zone 3 off-road), spawn ONLY towering lanky_watcher so its head is clearly visible above the reeds!
        if ((zone === 3 || ptZone === 3) && !this.isNearRoad(ex, ez, 4.0)) {
          kind = "lanky_watcher";
        } else {
          kind = pickEnemyKind(isNoCamExtra);
          if (kind === "contorted_strider") {
            // Never spawn oncoming runners inside tall hemp (1), tall corn (5), or tall swamp reeds (3 off-road)!
            if (ptZone === 1 || ptZone === 5 || (ptZone === 3 && !this.isNearRoad(ex, ez, 4.0))) {
              kind = pickStandardKind();
            } else {
              for (const other of enemies) {
                if (other.kind === "contorted_strider" && (ex - other.wx) ** 2 + (ez - other.wz) ** 2 < 72.25) {
                  kind = pickStandardKind();
                  break;
                }
              }
            }
          }
        }

        const moveMode = kind === "contorted_strider" ? "sprint_oncoming" : "static";
        const microAmp = 0.0;
        const microFreq = 0.0;

        if (kind === "trance_walker") {
          const model = this.createTranceWalker(Math.floor(rand() * 4));
          const initYaw = (rand() < 0.48 ? Math.PI : 0) + (rand() - 0.5) * 0.85;
          model.group.position.set(ex - centerX, this.terrainHeight(ex, ez), ez - centerZ);
          model.group.rotation.y = initYaw;
          model.head.rotation.set(-0.44, 0, (rand() < 0.5 ? 1 : -1) * 0.26);
          model.group.visible = !isNoCamExtra;
          group.add(model.group);

          const ob = {
            type: "circle", isEnemy: true, active: !isNoCamExtra,
            x: ex, z: ez, enemyCoreR: 0.30, enemyClipR: 0.42, crashR: 0.30, grazeR: 0.42, nearR: 1.85, nearPlayed: false
          };
          obstacles.push(ob);
          enemies.push({
            kind, model, group: model.group, ob,
            wx: ex, wz: ez, spawnX: ex, spawnZ: ez,
            yaw: initYaw, phase: rand() * Math.PI * 2,
            moveMode, microAmp, microFreq, noCamExtra: isNoCamExtra,
            alerted: false
          });
          return true;

        } else if (kind === "smiling_infected") {
          const model = this.createSmilingInfected(Math.floor(rand() * 4));
          const initYaw = (rand() - 0.5) * 0.95;
          model.group.position.set(ex - centerX, this.terrainHeight(ex, ez), ez - centerZ);
          model.group.rotation.y = initYaw;
          model.group.visible = !isNoCamExtra;
          group.add(model.group);

          const ob = {
            type: "circle", isEnemy: true, active: !isNoCamExtra,
            x: ex, z: ez, enemyCoreR: 0.30, enemyClipR: 0.42, crashR: 0.30, grazeR: 0.42, nearR: 1.85, nearPlayed: false
          };
          obstacles.push(ob);
          enemies.push({
            kind, model, group: model.group, ob,
            wx: ex, wz: ez, spawnX: ex, spawnZ: ez,
            yaw: initYaw, phase: rand() * Math.PI * 2,
            moveMode, microAmp, microFreq, noCamExtra: isNoCamExtra,
            weepPlayed: false, revealed: false, revealU: 0.0
          });
          return true;

        } else if (kind === "lanky_watcher") {
          const model = this.createLankyWatcher(Math.floor(rand() * 4));
          const initYaw = (rand() - 0.5) * 0.55;
          model.group.position.set(ex - centerX, this.terrainHeight(ex, ez), ez - centerZ);
          model.group.rotation.y = initYaw;
          model.group.visible = !isNoCamExtra;
          group.add(model.group);

          const ob = {
            type: "circle", isEnemy: true, active: !isNoCamExtra,
            x: ex, z: ez, enemyCoreR: 0.28, enemyClipR: 0.40, crashR: 0.28, grazeR: 0.40, nearR: 1.85, nearPlayed: false
          };
          obstacles.push(ob);
          enemies.push({
            kind, model, group: model.group, ob,
            wx: ex, wz: ez, spawnX: ex, spawnZ: ez,
            yaw: initYaw, phase: rand() * Math.PI * 2,
            tiltSign: rand() < 0.5 ? 1 : -1,
            moveMode, microAmp, microFreq, noCamExtra: isNoCamExtra,
            tiltU: 0.0
          });
          return true;

        } else if (kind === "contorted_strider") {
          stridersOnTile++;
          const model = this.createContortedStrider();
          const initYaw = (rand() - 0.5) * 0.35;
          model.group.position.set(ex - centerX, this.terrainHeight(ex, ez), ez - centerZ);
          model.group.rotation.y = initYaw;
          model.group.visible = !isNoCamExtra;
          group.add(model.group);

          const ob = {
            type: "circle", isEnemy: true, active: !isNoCamExtra,
            x: ex, z: ez, enemyCoreR: 0.32, enemyClipR: 0.44, crashR: 0.32, grazeR: 0.44, nearR: 1.95, nearPlayed: false
          };
          obstacles.push(ob);
          const baseRunSpd = (3.60 + rand() * 0.78) * (1.0 + distProg * 0.10);
          enemies.push({
            kind, model, group: model.group, ob,
            wx: ex, wz: ez, spawnX: ex, spawnZ: ez,
            yaw: initYaw, phase: rand() * Math.PI * 2,
            sprintSpeed: baseRunSpd,
            commitVx: 0.0,
            commitVz: baseRunSpd,
            moveMode: "sprint_oncoming", microAmp: 0.0, microFreq: 0.0, noCamExtra: isNoCamExtra,
            groanPlayed: false
          });
          return true;
        }
        return false;
      };

      // 1. Organic Stratified Blue-Noise Spawning across the FULL 32m x 32m tile:
      // Zero artificial lines/checkerboards, zero ugly clumps, zero empty deserts, zero seam gaps!
      const wx0 = centerX - TILE_SIZE * 0.5;
      const rawBase = 26 + Math.floor(rand() * 3); // 26..28 at 0m -> 52..56 at 5,000m (smooth 1.0x -> 2.0x!)
      const baseTarget = Math.round(rawBase * distDifficultyMult);

      // Build organic jittered cells slightly larger than baseTarget and shuffle them randomly
      const cellTarget = Math.ceil(baseTarget * 1.22);
      const cols = Math.max(5, Math.round(Math.sqrt(cellTarget)));
      const rows = Math.max(5, Math.ceil(cellTarget / cols));
      const cellW = TILE_SIZE / cols;
      const cellH = TILE_SIZE / rows;

      const cellIndices = [];
      for (let i = 0; i < cols * rows; i++) cellIndices.push(i);
      for (let i = cellIndices.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        const tmp = cellIndices[i];
        cellIndices[i] = cellIndices[j];
        cellIndices[j] = tmp;
      }

      let spawnedBase = 0;
      for (let idx = 0; idx < cellIndices.length && spawnedBase < baseTarget; idx++) {
        const cIdx = cellIndices[idx];
        const ci = cIdx % cols;
        const ri = Math.floor(cIdx / cols);
        for (let att = 0; att < 6; att++) {
          // Full free organic jitter inside cell (no grid look, seamless right up to tile edges!)
          const ex = wx0 + (ci + 0.06 + rand() * 0.88) * cellW;
          const ez = wz0 + (ri + 0.06 + rand() * 0.88) * cellH;
          if (isNearAnyObstacle(ex, ez, minObsGap, minEnemyGap)) continue;
          if (placeEnemyAt(ex, ez, false)) {
            spawnedBase++;
            break;
          }
        }
      }

      // Top up any cells blocked by large structures (barns/town halls) using global blue-noise scatter
      const spawnBlueNoiseExtra = (isNoCamExtra) => {
        const gapReq = isNoCamExtra ? minEnemyGap * 0.86 : minEnemyGap;
        for (let attempt = 0; attempt < 24; attempt++) {
          const ex = wx0 + 0.35 + rand() * (TILE_SIZE - 0.70);
          const ez = wz0 + 0.35 + rand() * (TILE_SIZE - 0.70);
          if (isNearAnyObstacle(ex, ez, minObsGap * 0.92, gapReq)) continue;
          return placeEnemyAt(ex, ez, isNoCamExtra);
        }
        return false;
      };

      while (spawnedBase < baseTarget) {
        if (!spawnBlueNoiseExtra(false)) break;
        spawnedBase++;
      }

      // 2. Without Camcorder (`0%` battery): 1.3x MORE monsters (`+30%` extra dormant figures that materialize in darkness)!
      const extraTarget = Math.max(4, Math.round(spawnedBase * 0.30));
      for (let s = 0; s < extraTarget; s++) {
        spawnBlueNoiseExtra(true);
      }

      // 3. Rare Dormant #4 «Двойники-тени» (STRICTLY hidden & non-collidable unless battery is on 1 bar, rare so they don't spam!)
      const shadowCount = (rand() < 0.28 && zone !== 3) ? 1 : 0;
      for (let k = 0; k < shadowCount; k++) {
        if (centerZ >= -28.0) break;
        const sz = wz0 + 4.5 + rand() * (TILE_SIZE - 9.0);
        const sx = hasRoad
          ? (this.roadCenterX(sz) + (rand() - 0.5) * 6.0)
          : (centerX + (rand() - 0.5) * 16.0);
        if (Math.abs(sx - centerX) < TILE_SIZE * 0.45 && !isNearAnyObstacle(sx, sz, 1.8, 2.4)) {
          const model = this.createBlackMonster();
          model.group.position.set(sx - centerX, this.terrainHeight(sx, sz), sz - centerZ);
          model.group.visible = false;
          group.add(model.group);

          const isPhantom = rand() < 0.50;
          const ob = {
            type: "circle", isEnemy: true, active: false,
            x: sx, z: sz, enemyCoreR: 0.30, enemyClipR: 0.42, crashR: 0.30, grazeR: 0.42, nearR: 2.0, nearPlayed: false
          };
          obstacles.push(ob);
          enemies.push({
            kind: "shadow_double", model, group: model.group, ob,
            wx: sx, wz: sz, spawnX: sx, spawnZ: sz,
            moveMode: "static", microAmp: 0.0, onlyOneBar: true,
            isPhantom, vanished: false, phase: rand() * Math.PI * 2
          });
        }
      }
    }

    _updateTileEnemies(tile, playerX, playerZ, dt, battery, onHorrorEvent) {
      const isZeroBattery = (battery <= 0.001);
      const bars = isZeroBattery ? 0 : Math.ceil(battery * 4);
      const isOneBarBattery = (bars === 1);

      for (const e of tile.enemies) {
        if (e.noCamExtra) {
          // Extra darkness horde ONLY exists once battery hits 0% and camcorder is thrown away!
          if (!isZeroBattery) {
            if (e.group.visible) e.group.visible = false;
            e.ob.active = false;
            continue;
          } else if (!e.group.visible) {
            e.group.visible = true;
            e.ob.active = true;
          }
        }

        const dx = playerX - e.wx;
        const dz = playerZ - e.wz;
        const dist = Math.hypot(dx, dz);

        if (e.kind === "shadow_double") {
          // STRICT RULE: #4 «Двойники-тени» ONLY exist when camcorder battery has 1 bar (`1 полосочка зарядки`)!
          if (!isOneBarBattery || e.vanished) {
            if (e.group.visible) e.group.visible = false;
            e.ob.active = false;
            continue;
          }

          e.group.visible = (Math.sin(this.time * 47.0 + e.phase) > -0.82);
          e.group.rotation.y = Math.atan2(dx, dz);
          e.group.rotation.z = Math.sin(this.time * 54.0 + e.phase) * 0.04;
          e.model.head.rotation.set(0.10, 0, Math.sin(this.time * 2.4 + e.phase) * 0.52);

          if (e.isPhantom) {
            e.ob.active = false;
            if (dist < 6.0) {
              e.vanished = true;
              e.group.visible = false;
              if (onHorrorEvent) onHorrorEvent("shadow_vanish", e.wx - playerX, e.wz - playerZ);
            }
          } else {
            e.ob.active = true;
          }

          e.group.position.set(e.wx - tile.centerX, this.terrainHeight(e.wx, e.wz), e.wz - tile.centerZ);
          e.ob.x = e.wx;
          e.ob.z = e.wz;
          continue;
        }

        if (dist > 42.0) continue;

        // Close-Pass Lunge (`<= 2.15m`): visual claw/head lunge on every close monster, sound throttled cleanly in game.js!
        if (!e.closePassPlayed && dist <= 2.15 && dz >= -0.25 && dz <= 2.10) {
          e.closePassPlayed = true;
          e.closeLungeU = 1.0;
          if (onHorrorEvent) {
            onHorrorEvent("close_pass", e.wx - playerX, e.wz - playerZ, e.kind);
          }
        }
        if (e.closeLungeU > 0) {
          e.closeLungeU = Math.max(0, e.closeLungeU - dt * 2.4);
        }
        const lunge = e.closeLungeU || 0;

        if (e.kind === "trance_walker") {
          // #1 «Ведомый»: ALWAYS shaking/convulsing violently in 16Hz VHS stop-motion at ALL distances (`dist <= 42m`)!
          if (!e.alerted && dist <= 15.5 && dz > -1.0) {
            e.alerted = true;
            if (onHorrorEvent && Math.sin(e.phase * 13.7) > 0.45) {
              onHorrorEvent("trance_snap", e.wx - playerX, e.wz - playerZ);
            }
          }

          e.phase += dt * 1.8;
          // Quantized 16Hz VHS stop-motion twitch ALWAYS active (`c = 1.0`), feet firmly planted!
          const q = Math.floor(this.time * 16.0) + e.phase * 3.1;
          const jerkA = Math.sin(q * 12.9898);
          const jerkB = Math.cos(q * 78.233);
          const jerkC = Math.sin(q * 37.719);

          e.model.torso.rotation.x = 0.04 + jerkA * 0.14 + lunge * 0.22;
          e.model.torso.rotation.z = Math.sin(e.phase) * 0.03 + jerkB * 0.17;
          e.model.torso.rotation.y = jerkC * 0.18;
          e.model.armL.rotation.set(Math.sin(e.phase) * 0.05 + jerkA * 0.34 - lunge * 0.45, 0, -0.14 - Math.abs(jerkB) * 0.18);
          e.model.armR.rotation.set(-Math.sin(e.phase) * 0.05 + jerkB * 0.34 - lunge * 0.40, 0,  0.14 + Math.abs(jerkC) * 0.18);

          e.model.head.rotation.x = -0.18 + jerkB * 0.32 + lunge * 0.16;
          e.model.head.rotation.y = jerkC * 0.48;
          e.model.head.rotation.z = 0.50 + jerkA * 0.52 - lunge * 0.45;

          if (e.alerted) {
            const targetYaw = Math.atan2(dx, dz);
            let dYaw = targetYaw - e.yaw;
            while (dYaw > Math.PI) dYaw -= Math.PI * 2;
            while (dYaw < -Math.PI) dYaw += Math.PI * 2;
            e.yaw += dYaw * Math.min(1, dt * (6.0 + lunge * 10.0));
            e.group.rotation.y = e.yaw;
          }

          e.group.position.set(e.wx - tile.centerX, this.terrainHeight(e.wx, e.wz), e.wz - tile.centerZ);
          e.ob.x = e.wx;
          e.ob.z = e.wz;

        } else if (e.kind === "smiling_infected") {
          // #2 «Заражённый улыбкой»: stays planted, shivers covering face until close (`7.8m`), then snaps hands open & leans into Nightshot!
          if (!e.weepPlayed && dist <= 18.0 && dz > 0) {
            e.weepPlayed = true;
            if (onHorrorEvent && Math.cos(e.phase * 9.3) > 0.55) {
              onHorrorEvent("infected_weep", e.wx - playerX, e.wz - playerZ);
            }
          }
          if (!e.revealed && dist <= 7.8 && dz > 0.2) {
            e.revealed = true;
            if (onHorrorEvent && Math.sin(e.phase * 7.1) > 0.35) {
              onHorrorEvent("infected_reveal", e.wx - playerX, e.wz - playerZ);
            }
          }

          if (!e.revealed) {
            const shiver = Math.sin(this.time * 38.0 + e.phase) * 0.016;
            e.model.torso.position.x = shiver;
            e.model.head.rotation.x = 0.16 + Math.sin(this.time * 8.0 + e.phase) * 0.025;
            const targetYaw = Math.atan2(dx, dz);
            let dYaw = targetYaw - e.yaw;
            while (dYaw > Math.PI) dYaw -= Math.PI * 2;
            while (dYaw < -Math.PI) dYaw += Math.PI * 2;
            e.yaw += dYaw * Math.min(1, dt * 3.5);
            e.group.rotation.y = e.yaw;
          } else {
            e.revealU = Math.min(1.0, e.revealU + dt * 7.5);
            const u = e.revealU;
            e.model.torso.position.x = Math.sin(this.time * 44.0 + e.phase) * 0.008 * lunge;
            e.model.torso.rotation.x = 0.24 + 0.04 * u + lunge * 0.20;
            e.model.head.rotation.set(-0.16 * u + lunge * 0.14, 0, -0.32 * u + Math.sin(this.time * 32.0) * 0.18 * lunge);
            e.model.armL.rotation.set(-0.48 * u - lunge * 0.42, -1.22 * u,  0.34 * u);
            e.model.armR.rotation.set(-0.48 * u - lunge * 0.42,  1.22 * u, -0.34 * u);

            const targetYaw = Math.atan2(dx, dz);
            let dYaw = targetYaw - e.yaw;
            while (dYaw > Math.PI) dYaw -= Math.PI * 2;
            while (dYaw < -Math.PI) dYaw += Math.PI * 2;
            e.yaw += dYaw * Math.min(1, dt * (7.5 + lunge * 10.0));
            e.group.rotation.y = e.yaw;
          }

          e.group.position.set(e.wx - tile.centerX, this.terrainHeight(e.wx, e.wz), e.wz - tile.centerZ);
          e.ob.x = e.wx;
          e.ob.z = e.wz;

        } else if (e.kind === "lanky_watcher") {
          // #4 «Длинный Наблюдатель»: towering 2.45m dead-still silhouette silently turning & tilting head 75°!
          const targetYaw = Math.atan2(dx, dz);
          let dYaw = targetYaw - e.yaw;
          while (dYaw > Math.PI) dYaw -= Math.PI * 2;
          while (dYaw < -Math.PI) dYaw += Math.PI * 2;
          e.yaw += dYaw * Math.min(1, dt * 3.8);
          e.group.rotation.y = e.yaw;

          const tiltTarget = (dist <= 12.5 && dz > -0.5) ? 1.0 : 0.0;
          e.tiltU = (e.tiltU || 0) + (tiltTarget - (e.tiltU || 0)) * Math.min(1, dt * 2.8);
          e.model.head.rotation.set(0.05 * e.tiltU, 0, e.tiltSign * 1.28 * e.tiltU);
          e.model.torso.rotation.x = 0.05 + lunge * 0.14;

          e.group.position.set(e.wx - tile.centerX, this.terrainHeight(e.wx, e.wz), e.wz - tile.centerZ);
          e.ob.x = e.wx;
          e.ob.z = e.wz;

        } else if (e.kind === "contorted_strider") {
          // #5 «Искажённый Шатун»: Heavy lurching oncoming runner (`3.55..4.4 m/s` — scary & active, never excessively fast!)
          // Closes onto a straight-ahead runner within ~2.2m, then locks its lane inside 5.2m so [A/D] dodges feel crisp & fair!
          if (dz > -4.0 && dist < 38.0) {
            if (!e.groanPlayed && dist <= 18.0 && dz > 2.0) {
              e.groanPlayed = true;
              if (onHorrorEvent && Math.sin(e.phase * 11.3) > 0.65) {
                onHorrorEvent("trance_snap", e.wx - playerX, e.wz - playerZ);
              }
            }

            const baseSpd = e.sprintSpeed || 3.85;
            const runCycle = this.time * 8.2 + e.phase;
            const strideSurge = 0.92 + 0.14 * Math.abs(Math.sin(runCycle));
            const spd = baseSpd * strideSurge;

            let vx = e.commitVx || 0.0;
            let vz = e.commitVz || spd;

            if (dz >= 5.2) {
              const timeToReach = Math.max(0.45, dz / (spd + 9.2));
              const desiredVx = dx / timeToReach;
              const maxLatSpd = Math.min(1.78, spd * 0.44);
              vx = Math.max(-maxLatSpd, Math.min(maxLatSpd, desiredVx));
              vz = Math.sqrt(Math.max(6.5, spd * spd - vx * vx * 0.40));
              e.commitVx = vx;
              e.commitVz = vz;
            } else {
              // Inside 5.2m and after passing: keep running straight oncoming along committed vector!
              vx = e.commitVx;
              vz = Math.max(3.1, e.commitVz);
            }

            const nextX = e.wx + vx * dt;
            const nextZ = e.wz + vz * dt;

            if (this._canEnemyStepTo(tile, e, nextX, nextZ)) {
              e.wx = nextX;
              e.wz = nextZ;
            } else {
              // Smart lateral sidestep steering around standing monsters, trees & cars so oncoming runners NEVER get stuck!
              if (!e.avoidDir) {
                e.avoidDir = (Math.sin(e.phase * 17.3) >= 0) ? 1 : -1;
              }
              let moved = false;
              const baseAng = Math.atan2(vx, Math.max(1.5, vz));
              const tryAngles = [
                e.avoidDir * 0.52, -e.avoidDir * 0.52,
                e.avoidDir * 0.98, -e.avoidDir * 0.98,
                e.avoidDir * 1.38, -e.avoidDir * 1.38
              ];
              for (let ai = 0; ai < tryAngles.length; ai++) {
                const ang = baseAng + tryAngles[ai];
                const tvx = Math.sin(ang) * spd;
                const tvz = Math.max(1.2, Math.cos(ang) * spd);
                const tx = e.wx + tvx * dt;
                const tz = e.wz + tvz * dt;
                if (this._canEnemyStepTo(tile, e, tx, tz)) {
                  e.wx = tx;
                  e.wz = tz;
                  vx = tvx;
                  vz = tvz;
                  if (ai % 2 === 1) e.avoidDir = -e.avoidDir;
                  moved = true;
                  break;
                }
              }
              // Final guarantee: if pinched between standing monsters, slip past enemies while still respecting solid trees/cars!
              if (!moved && this._canEnemyStepTo(tile, e, nextX, nextZ, true)) {
                e.wx = nextX;
                e.wz = nextZ;
              } else if (!moved && this._canEnemyStepTo(tile, e, e.wx, nextZ, true)) {
                e.wz = nextZ;
                vx = 0;
              }
            }

            // ALWAYS face its true oncoming run direction (`vz > 0`), NEVER spin around backward when passing the player!
            const targetYaw = Math.atan2(vx, Math.max(2.0, vz));
            let dYaw = targetYaw - e.yaw;
            while (dYaw > Math.PI) dYaw -= Math.PI * 2;
            while (dYaw < -Math.PI) dYaw += Math.PI * 2;
            e.yaw += dYaw * Math.min(1, dt * 8.0);
            e.group.rotation.y = e.yaw;

            // Heavy lurching run gait (`тяжёлый жуткий бег навстречу`)
            const sL = Math.sin(runCycle);
            const cL = Math.cos(runCycle);
            const reach = (dz > -0.5 && dist < 13.0) ? Math.min(1.0, (13.0 - dist) / 8.5) : 0.0;
            e.model.legL.rotation.x = sL * 0.72;
            e.model.legR.rotation.x = -sL * 0.72;
            const bobY = Math.abs(cL) * 0.075 - 0.04;
            e.model.torso.position.y = 1.08 + bobY;
            e.model.torso.rotation.x = 0.34 + Math.sin(runCycle * 2.0) * 0.07 + reach * 0.16 + lunge * 0.22;
            e.model.torso.rotation.z = sL * 0.14 - (vx / 5.0) * 0.10;

            // Long 1.28m scythe-clawed arms swing with the run and reach out as it closes in!
            e.model.armL.rotation.set(-sL * 0.52 - reach * 0.74 - lunge * 0.52, 0,  0.11 + reach * 0.10);
            e.model.armR.rotation.set( sL * 0.52 - reach * 0.64 - lunge * 0.52, 0, -0.11 - reach * 0.10);

            const twitch = Math.sin(this.time * 29.0 + e.phase) > 0.85 ? -0.25 : 0.0;
            e.model.head.rotation.set(-0.18 + reach * 0.14 + lunge * 0.14, 0, 0.44 + twitch - sL * 0.10);

            e.group.position.set(e.wx - tile.centerX, this.terrainHeight(e.wx, e.wz), e.wz - tile.centerZ);
            e.ob.x = e.wx;
            e.ob.z = e.wz;
          }
        }
      }
    }

    /**
     * Plants Hemp or Corn in CRISP AGRICULTURAL PARALLEL ROWS (`рядами как в оригинале`!)
     * Every row X = k * ROW_SPACING has tightly spaced stalks along Z, leaving a clear navigable aisle between rows!
     */
    _populateRowField(group, wx0, wz0, centerX, centerZ, rand, geo, mat, avoidObs) {
      const kStart = Math.ceil(wx0 / ROW_SPACING);
      const kEnd = Math.floor((wx0 + TILE_SIZE) / ROW_SPACING);
      const zStep = this.mobilePerf ? 1.72 : 1.25; // Tight spacing along each row!
      const zCount = Math.floor(TILE_SIZE / zCountSafe(zStep));
      function zCountSafe(s) { return s; }

      const maxInstances = (kEnd - kStart + 2) * (zCount + 2);
      const im = new THREE.InstancedMesh(geo, mat, maxInstances);
      const dummy = new THREE.Object3D();
      const scaleBoost = this.mobilePerf ? 1.12 : 1.0;
      let placed = 0;

      for (let k = kStart; k <= kEnd; k++) {
        const rowBaseX = k * ROW_SPACING;
        for (let zi = 0; zi < zCount; zi++) {
          const wz = wz0 + (zi + 0.5) * zStep + (rand() - 0.5) * 0.25;
          const wx = rowBaseX + (rand() - 0.5) * 0.14; // Strictly aligned along the row!
          if (this.isNearRoad(wx, wz, 4.0)) continue;

          // Leave small natural gaps & keep clear of Barn interior
          if (rand() < 0.06) continue;
          let blocked = false;
          if (avoidObs) {
            for (const ob of avoidObs) {
              if (ob.type === "box" && ob.hz > 4.5 && Math.abs(wx - ob.x) < 4.5 && Math.abs(wz - ob.z) < 5.5) {
                blocked = true;
                break;
              }
            }
          }
          if (blocked) continue;

          dummy.position.set(wx - centerX, this.terrainSurfaceHeight(wx, wz) - 0.03, wz - centerZ);
          dummy.rotation.set(0, rand() * Math.PI * 2, 0);
          const sw = (0.88 + rand() * 0.28) * scaleBoost;
          const sh = 0.90 + rand() * 0.25;
          dummy.scale.set(sw, sh, sw);
          dummy.updateMatrix();
          im.setMatrixAt(placed++, dummy.matrix);
        }
      }
      im.count = placed;
      im.instanceMatrix.needsUpdate = true;
      group.add(im);
      return im;
    }

    _buildRailwayOnTile(group, centerX, centerZ, wx0, wz0, obstacles, soundSpots, rand, tooClose, isSpawnArea) {
      // Straight diagonal/north-south railway line near centerX if clear of highway
      const railX = centerX + 2.5;
      if (this.isNearRoad(railX, centerZ, 8.5)) return;

      // Wooden sleepers (`шпалы`) via InstancedMesh + 2 gleaming steel rails!
      const sleeperGeo = this._box(2.55, 0.14, 0.26, 0, 0.07, 0);
      const sleeperCount = 26;
      const im = new THREE.InstancedMesh(sleeperGeo, this.matPine, sleeperCount);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < sleeperCount; i++) {
        const wz = wz0 + (i + 0.5) * (TILE_SIZE / sleeperCount);
        dummy.position.set(railX - centerX, this.terrainHeight(railX, wz) + 0.02, wz - centerZ);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
      }
      im.instanceMatrix.needsUpdate = true;
      group.add(im);

      for (const roff of [-0.76, 0.76]) {
        const railGeo = this._box(0.08, 0.14, TILE_SIZE, railX - centerX + roff, this.terrainHeight(railX, centerZ) + 0.15, 0);
        group.add(new THREE.Mesh(railGeo, this.matSteelRail));
      }

      // Parked / Derailed Freight Boxcar (`Товарный вагон`) on every other railway tile!
      if ((Math.floor(wz0 / TILE_SIZE) % 2 === 0) && !isSpawnArea(railX, centerZ) && !tooClose(railX, centerZ, 7.0)) {
        const boxcar = new THREE.Mesh(this.geoTrainBoxcar, this.matRust);
        boxcar.position.set(railX - centerX, this.terrainHeight(railX, centerZ) + 0.12, 0);
        group.add(boxcar);
        obstacles.push({ type: "box", x: railX, z: centerZ, hx: 1.52, hz: 5.75, yaw: 0, nearPlayed: false });
      }
    }

    _populateTrees(group, centerX, centerZ, count, birchRatio, rand, obstacles, tooClose, isSpawnArea, addTotems, deadSkeletal) {
      for (let i = 0; i < count; i++) {
        const wx = centerX + (rand() - 0.5) * (TILE_SIZE - 2.0);
        const wz = centerZ + (rand() - 0.5) * (TILE_SIZE - 2.0);
        if (isSpawnArea(wx, wz) || this.isNearRoad(wx, wz, 5.2)) continue;
        if (valueNoise2D(wx * 0.085, wz * 0.085, this.runSeed + 313) < 0.28) continue;
        if (tooClose(wx, wz, 3.7)) continue;

        const sc = 0.88 + rand() * 0.35;
        const ty = this.terrainHeight(wx, wz) - 0.12;
        const yaw = rand() * Math.PI * 2;

        if (deadSkeletal) {
          const dead = new THREE.Mesh(this.geoDeadTree, this.matCharred);
          dead.position.set(wx - centerX, ty, wz - centerZ);
          dead.rotation.y = yaw;
          dead.scale.set(sc, 0.88 + rand() * 0.3, sc);
          group.add(dead);
        } else if (rand() < birchRatio) {
          const birch = new THREE.Mesh(this.geoBirchTree, this.matBirch);
          birch.position.set(wx - centerX, ty, wz - centerZ);
          birch.rotation.y = yaw;
          birch.scale.set(sc, 0.92 + rand() * 0.26, sc);
          group.add(birch);
        } else {
          const pineGroup = new THREE.Group();
          pineGroup.add(new THREE.Mesh(this.geoPineTrunk, this.matPine), new THREE.Mesh(this.geoPineBoughs, this.matBough));
          if (addTotems && i < 2 && rand() < 0.45) {
            const totem = new THREE.Mesh(this.geoBlairTotem, this.matBirch);
            totem.position.set(1.25, 0, 0);
            pineGroup.add(totem);
          }
          pineGroup.position.set(wx - centerX, ty, wz - centerZ);
          pineGroup.rotation.y = yaw;
          pineGroup.scale.set(sc, 0.92 + rand() * 0.26, sc);
          group.add(pineGroup);
        }

        // Chest-height trunk radius is ~0.26m*sc; only dead-on hits into the inner solid core (~0.19m*sc) kill,
        // while clipping the outer bark/side (~0.20..0.48m*sc) causes a survivable shoulder stumble!
        obstacles.push({
          type: "circle", isTree: true, x: wx, z: wz, crashR: 0.19 * sc, grazeR: 0.48 * sc, nearR: 0.40 * sc + 1.85, nearPlayed: false
        });
      }
    }

    _populateScattered(group, centerX, centerZ, rand, geo, mat, count, hScale) {
      const targetCount = this.mobilePerf ? Math.max(12, Math.round(count * 0.44)) : count;
      const scaleBoost = this.mobilePerf ? 1.14 : 1.0;
      const isReed = (geo === this.geoReedClump);
      const im = new THREE.InstancedMesh(geo, mat, targetCount);
      const dummy = new THREE.Object3D();
      const tileZone = this.zoneAt(centerX, centerZ);
      let placed = 0;
      for (let i = 0; i < targetCount; i++) {
        const wx = centerX + (rand() - 0.5) * TILE_SIZE;
        const wz = centerZ + (rand() - 0.5) * TILE_SIZE;
        if (tileZone !== 9 && this.isNearRoad(wx, wz, 3.5)) continue;
        dummy.position.set(wx - centerX, this.terrainSurfaceHeight(wx, wz) - 0.02, wz - centerZ);
        dummy.rotation.set(0, rand() * Math.PI * 2, 0);
        const sw = (0.78 + rand() * 0.55) * scaleBoost;
        const sh = isReed
          ? (0.78 + rand() * 0.27) * hScale
          : (0.72 + rand() * 0.60) * hScale * scaleBoost;
        dummy.scale.set(sw, sh, sw);
        dummy.updateMatrix();
        im.setMatrixAt(placed++, dummy.matrix);
      }
      im.count = placed;
      im.instanceMatrix.needsUpdate = true;
      group.add(im);
      return im;
    }

    _addRoadOnTile(group, centerX, centerZ, wz0, obstacles, soundSpots, rand, tooClose, isSpawnArea) {
      const segs = 6;
      const roadW = 7.4;
      const pos = [], norm = [], uvs = [], idx = [];
      for (let s = 0; s <= segs; s++) {
        const t = s / segs;
        const wz = wz0 + t * TILE_SIZE;
        const rx = this.roadCenterX(wz);
        const rxNext = this.roadCenterX(wz - 1.0);
        const tx = rxNext - rx, tz = -1.0;
        const len = Math.hypot(tx, tz);
        const px = -tz / len, pz = tx / len;
        const lx = rx - px * (roadW * 0.5), lz = wz - pz * (roadW * 0.5);
        const rrx = rx + px * (roadW * 0.5), rrz = wz + pz * (roadW * 0.5);
        pos.push(lx - centerX, this.terrainHeight(lx, lz) + 0.03, lz - centerZ);
        pos.push(rrx - centerX, this.terrainHeight(rrx, rrz) + 0.03, rrz - centerZ);
        norm.push(0, 1, 0, 0, 1, 0);
        uvs.push(0, t * 2.5, 1, t * 2.5);
      }
      for (let s = 0; s < segs; s++) {
        const i = s * 2;
        idx.push(i, i + 2, i + 1, i + 1, i + 2, i + 3);
      }
      const rGeo = new THREE.BufferGeometry();
      rGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      rGeo.setAttribute("normal", new THREE.Float32BufferAttribute(norm, 3));
      rGeo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      rGeo.setIndex(idx);
      group.add(new THREE.Mesh(rGeo, this.matRoad));

      const poleZ = wz0 + TILE_SIZE * 0.5;
      const poleX = this.roadCenterX(poleZ) + 5.5;
      if (Math.abs(poleX - centerX) < TILE_SIZE * 0.52) {
        const pole = new THREE.Mesh(this.geoPowerPole, this.matPine);
        pole.position.set(poleX - centerX, this.terrainHeight(poleX, poleZ) - 0.15, poleZ - centerZ);
        group.add(pole);
        obstacles.push({ type: "circle", x: poleX, z: poleZ, crashR: 0.18, grazeR: 0.36, nearR: 1.9, nearPlayed: false });
      }

      if (rand() < 0.58) {
        const carZ = wz0 + 6.0 + rand() * (TILE_SIZE - 12.0);
        const carX = this.roadCenterX(carZ) + (rand() - 0.5) * 3.8;
        if (Math.abs(carX - centerX) < TILE_SIZE * 0.48 && !isSpawnArea(carX, carZ) && !tooClose(carX, carZ, 5.5)) {
          const carYaw = (rand() - 0.5) * 0.85 + (rand() < 0.35 ? Math.PI : 0);
          const variant = rand() < 0.45 ? 1 : 0; // Mix VAZ-2106 Zhiguli sedans & UAZ-452 Bukhanka vans!
          const paintIdx = variant === 1 ? (rand() < 0.65 ? 2 : 1) : Math.floor(rand() * 4);
          const car = this.createAbandonedCar(variant, paintIdx);
          car.position.set(carX - centerX, this.terrainHeight(carX, carZ) + 0.01, carZ - centerZ);
          car.rotation.order = "YXZ";
          car.rotation.set(0, carYaw, (rand() - 0.5) * 0.05);
          group.add(car);
          const carHx = variant === 1 ? 0.98 : 0.86;
          const carHz = variant === 1 ? 2.26 : 2.10;
          obstacles.push({ type: "box", x: carX, z: carZ, hx: carHx, hz: carHz, yaw: carYaw, nearPlayed: false });
          if (rand() < 0.5) soundSpots.push({ kind: "radio_static", wx: carX, wz: carZ, range: 17.0, played: false });
        }
      }
    }

    checkPlayerInteraction(prevX, prevZ, px, pz, alreadyStumbled = false) {
      // Support 2-arg legacy calls if needed
      if (px === undefined) { px = prevX; pz = prevZ; }
      const curCx = Math.floor(px / TILE_SIZE);
      const curCz = Math.floor(pz / TILE_SIZE);
      const res = { hit: "none", pushX: 0, pan: 0, nearMissPan: null, hitOb: null, targetSafeX: null, targetSafeZ: null };
      const corePlayerR = 0.15; // Tight lethal head/chest center (~0.34m lethal radius on trees = dead-on center hit only!)
      const bodyPlayerR = 0.28; // Shoulder width for survivable edge/bark clip stumble!

      // Closest point on player step segment (prevX,prevZ)->(px,pz) to point (ox,oz)
      const segDx = px - prevX, segDz = pz - prevZ;
      const segLenSq = segDx * segDx + segDz * segDz;
      const closestSq = (ox, oz) => {
        if (segLenSq < 1e-6) return (px - ox) ** 2 + (pz - oz) ** 2;
        const t = Math.max(0, Math.min(1, ((ox - prevX) * segDx + (oz - prevZ) * segDz) / segLenSq));
        const cxp = prevX + t * segDx;
        const czp = prevZ + t * segDz;
        return (cxp - ox) ** 2 + (czp - oz) ** 2;
      };

      for (let cx = curCx - 2; cx <= curCx + 2; cx++) {
        for (let cz = curCz - 2; cz <= curCz + 2; cz++) {
          const tile = this.tiles.get(`${cx},${cz}`);
          if (!tile) continue;

          for (const ob of tile.obstacles) {
            if (ob.active === false) continue;
            if (ob.type === "circle") {
              const dx = px - ob.x, dz = pz - ob.z;
              const d2 = closestSq(ob.x, ob.z);

              // MONSTERS (`ob.isEnemy`): Authentic *Into the Dead* collision!
              // 1) Solid torso/chest impact (`d <= ~0.47m`) -> LETHAL CRASH!
              // 2) Partial outer-shoulder clip (`0.47m < d <= ~0.70m`) when healthy -> HEAVY MONSTER STUMBLE!
              if (ob.isEnemy) {
                const solidKillR = (ob.enemyCoreR || 0.31) + 0.16;
                const stumbleOuterR = (ob.enemyClipR || 0.42) + bodyPlayerR;
                if (!ob.nearPlayed && Math.abs(dz) < 1.15 && d2 < ob.nearR * ob.nearR && d2 > stumbleOuterR * stumbleOuterR) {
                  ob.nearPlayed = true;
                  res.nearMissPan = Math.max(-1, Math.min(1, -dx / 2.2));
                }
                if (d2 <= solidKillR * solidKillR) {
                  return { hit: "crash", pushX: 0, pan: 0, nearMissPan: null, hitOb: ob, targetSafeX: null };
                }
                if (!ob._grazed && d2 <= stumbleOuterR * stumbleOuterR) {
                  if (alreadyStumbled) {
                    return { hit: "crash", pushX: 0, pan: 0, nearMissPan: null, hitOb: ob, targetSafeX: null };
                  }
                  ob._grazed = true;
                  const side = dx >= 0 ? 1 : -1;
                  res.hit = "monster_stumble";
                  res.pushX = side * 2.55;
                  res.pan = -side * 0.85;
                  res.targetSafeX = ob.x + side * (stumbleOuterR + 0.05);
                }
                continue;
              }

              const coreLethalR = ob.crashR + corePlayerR;
              const grazeOuterR = Math.max(ob.grazeR || (ob.crashR + 0.26), coreLethalR + 0.22) + (bodyPlayerR - corePlayerR);

              if (!ob.nearPlayed && Math.abs(dz) < 1.15 && d2 < ob.nearR * ob.nearR && d2 > grazeOuterR * grazeOuterR) {
                ob.nearPlayed = true;
                res.nearMissPan = Math.max(-1, Math.min(1, -dx / 2.2));
              }

              // 1. Direct dead-on center impact into solid trunk/post -> LETHAL CRASH!
              if (d2 <= coreLethalR * coreLethalR) {
                return { hit: "crash", pushX: 0, pan: 0, nearMissPan: null, hitOb: ob, targetSafeX: null };
              }
              // 2. Clipping/brushing the side or edge of a tree (`немного задел дерево сбоку`) -> SURVIVABLE SHOULDER STUMBLE!
              // Guarded by Math.abs(dx) >= coreLethalR * 0.96 AND !ob._grazed so dead-center runs NEVER deflect early!
              if (!ob._grazed && d2 <= grazeOuterR * grazeOuterR && Math.abs(dx) >= coreLethalR * 0.96) {
                ob._grazed = true;
                const side = dx >= 0 ? 1 : -1;
                res.hit = "graze";
                res.pushX = side * 2.35;
                res.pan = -side * 0.78;
                res.targetSafeX = ob.x + side * (grazeOuterR + 0.04);
              }
            } else if (ob.type === "box") {
              const yaw = ob.yaw || 0;
              const cy = Math.cos(yaw), sy = Math.sin(yaw);
              // Keep lethal box hull strictly OUTSIDE the outer metal/glass shell (> camera.near) so camera NEVER clips inside!
              const coreHx = ob.hx + 0.10;
              const coreHz = ob.hz + 0.10;
              const grazeHx = ob.hx + 0.28;
              const grazeHz = ob.hz + 0.24;

              for (const s of [0.25, 0.5, 0.75, 1.0]) {
                const sx = prevX + segDx * s, sz = prevZ + segDz * s;
                const relX = sx - ob.x, relZ = sz - ob.z;
                // Proper inverse R_y(yaw) transform from world (relX, relZ) to box-local (lx, lz)
                const lx =  relX * cy - relZ * sy;
                const lz =  relX * sy + relZ * cy;

                if (!ob.nearPlayed && Math.abs(lz) < grazeHz + 0.55 && Math.abs(lx) < grazeHx + 1.5 && Math.abs(lx) > grazeHx) {
                  ob.nearPlayed = true;
                  res.nearMissPan = relX >= 0 ? -0.78 : 0.78;
                }

                // 1. Entering the solid vehicle/structure hull ALWAYS crashes (never let _grazed disable collision and allow walking through!)
                if (Math.abs(lx) <= coreHx && Math.abs(lz) <= coreHz) {
                  // Compute safe outer surface point pushed 0.20m clear of the shell so death camera never peeks inside!
                  const penX = coreHx - Math.abs(lx);
                  const penZ = coreHz - Math.abs(lz);
                  let outLx = lx, outLz = lz;
                  if (penX <= penZ) {
                    outLx = (lx >= 0 ? 1 : -1) * (coreHx + 0.20);
                  } else {
                    outLz = (lz >= 0 ? 1 : -1) * (coreHz + 0.20);
                  }
                  const safeWx = ob.x + outLx * cy + outLz * sy;
                  const safeWz = ob.z - outLx * sy + outLz * cy;
                  return { hit: "crash", pushX: 0, pan: 0, nearMissPan: null, hitOb: ob, targetSafeX: safeWx, targetSafeZ: safeWz };
                }

                // 2. Survivable graze ONLY when brushing the outer flank (strictly outside coreHx, never on front/rear corners!)
                if (!ob._grazed && Math.abs(lx) > coreHx && Math.abs(lx) <= grazeHx && Math.abs(lz) <= grazeHz) {
                  ob._grazed = true;
                  const sideL = lx >= 0 ? 1 : -1;
                  const safeLx = sideL * (grazeHx + 0.08);
                  const safeWx = ob.x + safeLx * cy + lz * sy;
                  const safeWz = ob.z - safeLx * sy + lz * cy;
                  const pushSign = (safeWx - sx) >= 0 ? 1 : -1;
                  res.hit = "graze";
                  res.pushX = pushSign * 2.35;
                  res.pan = relX >= 0 ? -0.78 : 0.78;
                  res.targetSafeX = safeWx;
                  res.targetSafeZ = safeWz;
                  break;
                }
              }
            }
          }
        }
      }
      return res;
    }

    checkBatteryPickup(px, pz) {
      const curCx = Math.floor(px / TILE_SIZE);
      const curCz = Math.floor(pz / TILE_SIZE);
      for (let cx = curCx - 1; cx <= curCx + 1; cx++) {
        for (let cz = curCz - 1; cz <= curCz + 1; cz++) {
          const tile = this.tiles.get(`${cx},${cz}`);
          if (!tile) continue;
          for (const p of tile.pickups) {
            if (p.taken) continue;
            if ((px - p.x) ** 2 + (pz - p.z) ** 2 < 2.35 * 2.35) {
              p.taken = true;
              p.mesh.visible = false;
              return true;
            }
          }
        }
      }
      return false;
    }
  }

  return { WorldManager };
})();
