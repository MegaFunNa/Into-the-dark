// Authentic 1990s VCR / Hi8 Camcorder Pixel-Bitmap OSD Renderer (NEC uPD6450 style)
// Drawn at low 384x216 resolution with imageSmoothingEnabled=false and composited INSIDE the VHS shader!
window.HorrorVhsOsd = (function () {
  const OSD_W = 384;
  const OSD_H = 216;

  // Classic chunky 5x7 pixel-matrix VCR bitmap glyphs (upscaled crisp 2x on 384x216 grid!)
  const GLYPHS = {
    "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
    "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    "2": ["01110", "10001", "00001", "00110", "01000", "10000", "11111"],
    "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
    "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
    "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
    "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
    "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
    "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
    "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
    "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    "B": ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
    "C": ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
    "D": ["11100", "10010", "10001", "10001", "10001", "10010", "11100"],
    "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    "F": ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
    "G": ["01110", "10001", "10000", "10111", "10001", "10001", "01110"],
    "H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    "I": ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
    "K": ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
    "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    "N": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    "U": ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
    "V": ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
    "W": ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
    "Y": ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
    ":": ["00000", "00100", "00100", "00000", "00100", "00100", "00000"],
    ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
    "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
    "[": ["01110", "01000", "01000", "01000", "01000", "01000", "01110"],
    "]": ["01110", "00010", "00010", "00010", "00010", "00010", "01110"],
    "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
    "(": ["00010", "00100", "01000", "01000", "01000", "00100", "00010"],
    ")": ["01000", "00100", "00010", "00010", "00010", "00100", "01000"],
    ",": ["00000", "00000", "00000", "00000", "00110", "00100", "01000"],
    "А": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    "Б": ["11111", "10000", "10000", "11110", "10001", "10001", "11110"],
    "В": ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
    "Г": ["11111", "10000", "10000", "10000", "10000", "10000", "10000"],
    "Д": ["00110", "01010", "01010", "01010", "01010", "11111", "10001"],
    "Е": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    "Ё": ["01010", "11111", "10000", "11110", "10000", "10000", "11111"],
    "Ж": ["10101", "10101", "01110", "00100", "01110", "10101", "10101"],
    "З": ["01110", "10001", "00001", "00110", "00001", "10001", "01110"],
    "И": ["10001", "10001", "10011", "10101", "11001", "10001", "10001"],
    "Й": ["01110", "00000", "10001", "10011", "10101", "11001", "10001"],
    "К": ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
    "Л": ["00111", "01001", "01001", "01001", "01001", "01001", "10001"],
    "М": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    "Н": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    "О": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    "П": ["11111", "10001", "10001", "10001", "10001", "10001", "10001"],
    "Р": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    "С": ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
    "Т": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    "У": ["10001", "10001", "10001", "01111", "00001", "10001", "01110"],
    "Ф": ["00100", "01110", "10101", "10101", "01110", "00100", "00100"],
    "Х": ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
    "Ц": ["10010", "10010", "10010", "10010", "10010", "11111", "00001"],
    "Ч": ["10001", "10001", "10001", "01111", "00001", "00001", "00001"],
    "Ш": ["10101", "10101", "10101", "10101", "10101", "10101", "11111"],
    "Щ": ["10101", "10101", "10101", "10101", "10101", "11111", "00001"],
    "Ъ": ["11000", "01000", "01000", "01110", "01001", "01001", "01110"],
    "Ы": ["10001", "10001", "10001", "11101", "10011", "10011", "11101"],
    "Ь": ["10000", "10000", "10000", "11110", "10001", "10001", "11110"],
    "Э": ["01110", "10001", "00001", "00111", "00001", "10001", "01110"],
    "Ю": ["10010", "10101", "10101", "11101", "10101", "10101", "10010"],
    "Я": ["01111", "10001", "10001", "01111", "00101", "01001", "10001"],
    " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"]
  };

  class VcrOsdRenderer {
    constructor() {
      this.canvas = document.createElement("canvas");
      this.canvas.width = OSD_W;
      this.canvas.height = OSD_H;
      this.ctx = this.canvas.getContext("2d");
      this.ctx.imageSmoothingEnabled = false;

      this.texture = new THREE.CanvasTexture(this.canvas);
      this.texture.minFilter = THREE.NearestFilter;
      this.texture.magFilter = THREE.NearestFilter;
      this.texture.generateMipmaps = false;

      this.lastKey = "";
    }

    drawText(str, x, y, scaleX, scaleY, color = "#ebebdf") {
      const ctx = this.ctx;
      const upper = str.toUpperCase();
      let curX = Math.floor(x);
      const baseY = Math.floor(y);

      for (let c = 0; c < upper.length; c++) {
        const ch = upper[c];
        const rows = GLYPHS[ch] || GLYPHS[" "];
        if (ch !== " ") {
          // Authentic 1990s VCR black character shadow-border (1px right & down + outline)
          ctx.fillStyle = "rgba(8, 10, 8, 0.92)";
          for (let r = 0; r < 7; r++) {
            const row = rows[r];
            for (let col = 0; col < 5; col++) {
              if (row[col] === "1") {
                ctx.fillRect(
                  curX + col * scaleX - 1,
                  baseY + r * scaleY - 1,
                  scaleX + 2,
                  scaleY + 2
                );
              }
            }
          }
          // Bright NTSC luma glyph body
          ctx.fillStyle = color;
          for (let r = 0; r < 7; r++) {
            const row = rows[r];
            for (let col = 0; col < 5; col++) {
              if (row[col] === "1") {
                ctx.fillRect(
                  curX + col * scaleX,
                  baseY + r * scaleY,
                  scaleX,
                  scaleY
                );
              }
            }
          }
        }
        curX += 6 * scaleX;
      }
    }

    update(runClock, battery, distanceMeters, afHunting, nightVisionOn = true) {
      const safeClock = Math.max(0, runClock);
      const recOn = safeClock % 1.08 < 0.64;
      const totalSec = 2 * 3600 + 17 * 60 + 8 + Math.floor(safeClock);
      let hh = Math.floor(totalSec / 3600) % 12;
      if (hh === 0) hh = 12;
      const mm = Math.floor(totalSec / 60) % 60;
      const ss = totalSec % 60;

      const tcMin = Math.floor(safeClock / 60) % 60;
      const tcSec = Math.floor(safeClock) % 60;
      const bars = battery <= 0.001 ? 0 : Math.ceil(battery * 4);
      const lowBlink = battery <= 0.25 && safeClock % 0.54 < 0.30;
      const afShow = afHunting > 0.22 && safeClock % 0.28 < 0.18;
      const distBucket = Math.max(0, Math.floor(distanceMeters));
      const nvFlag = nightVisionOn ? 1 : 0;

      // Re-rasterize only when visible state changes (~4-6 times/sec — super fast!)
      const stateKey = `${recOn ? 1 : 0}_${hh}_${mm}_${ss}_${tcSec}_${bars}_${lowBlink ? 1 : 0}_${afShow ? 1 : 0}_${distBucket}_${nvFlag}`;
      if (stateKey === this.lastKey) return;
      this.lastKey = stateKey;

      const ctx = this.ctx;
      ctx.clearRect(0, 0, OSD_W, OSD_H);

      // 1. TOP-LEFT: Pixelated Camcorder Battery Outline + NIGHTSHOT
      const bx = 18, by = 14;
      ctx.fillStyle = "rgba(8,10,8,0.9)";
      ctx.fillRect(bx - 1, by - 1, 34, 15);
      ctx.fillStyle = lowBlink ? "#eb3828" : "#e8e8dc";
      ctx.fillRect(bx, by, 30, 2);
      ctx.fillRect(bx, by + 11, 30, 2);
      ctx.fillRect(bx, by, 2, 13);
      ctx.fillRect(bx + 28, by, 2, 13);
      ctx.fillRect(bx + 30, by + 3, 3, 7); // Battery terminal nub

      for (let i = 0; i < bars; i++) {
        ctx.fillRect(bx + 3 + i * 6, by + 3, 5, 7);
      }
      if (nightVisionOn) {
        this.drawText("NIGHTSHOT", 18, 32, 1, 1, "#d8e6d4");
      } else {
        this.drawText("NIGHTSHOT OFF", 18, 32, 1, 1, "#9a8a86");
      }
      if (lowBlink) {
        this.drawText("LOW BATT", 18, 43, 1, 2, "#f03c2e");
      }

      // 2. TOP-RIGHT: Blinking Red Pixel Circle + Chunky "REC" + Tape Counter "SP 0:00:14"
      if (recOn) {
        const rx = 310, ry = 15;
        ctx.fillStyle = "rgba(10,4,4,0.9)";
        ctx.fillRect(rx - 1, ry + 1, 12, 10);
        ctx.fillRect(rx + 1, ry - 1, 8, 14);
        ctx.fillStyle = "#f2261b";
        ctx.fillRect(rx + 2, ry, 6, 12);
        ctx.fillRect(rx, ry + 2, 10, 8);
      }
      this.drawText("REC", 326, 14, 2, 2, "#ecece0");
      const tcStr = `SP 0:${String(tcMin).padStart(2, "0")}:${String(tcSec).padStart(2, "0")}`;
      this.drawText(tcStr, 304, 33, 1, 1, "#dcdcd0");

      // 3. CENTER VIEWFINDER BRACKETS + [AF] AUTOFOCUS HUNTING INDICATOR
      ctx.fillStyle = "rgba(225, 232, 220, 0.42)";
      // Subtle center crosshair ticks
      ctx.fillRect(OSD_W / 2 - 5, OSD_H / 2, 4, 1);
      ctx.fillRect(OSD_W / 2 + 2, OSD_H / 2, 4, 1);
      ctx.fillRect(OSD_W / 2, OSD_H / 2 - 4, 1, 3);
      ctx.fillRect(OSD_W / 2, OSD_H / 2 + 2, 1, 3);

      if (afShow) {
        this.drawText("[AF]", 180, 122, 1, 1, "#e8e8dc");
      }

      // 4. BOTTOM-LEFT: Authentic Tall VCR Camcorder Time & Date Stamp (Classic 1x2 / 2x2 stretched VCR font!)
      const timeStr = `AM ${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
      this.drawText(timeStr, 18, 166, 2, 2, "#ecece0");
      this.drawText("NOV.14 1998", 18, 185, 2, 2, "#ecece0");

      // 5. BOTTOM-CENTER: Authentic 1998 VCR Pixel Route / Extraction Line (0m -> 3000m Goal!)
      const goalMeters = 3000;
      const prog = Math.max(0, Math.min(1, distanceMeters / goalMeters));
      const barX = 160;
      const barY = 197;
      const barW = 136;

      // Dark VCR outline backdrop behind the route track
      ctx.fillStyle = "rgba(8, 10, 8, 0.88)";
      ctx.fillRect(barX - 2, barY - 3, barW + 4, 7);

      // Unfilled dashed pixel route ahead
      ctx.fillStyle = "rgba(180, 192, 178, 0.45)";
      for (let px = 0; px < barW; px += 4) {
        ctx.fillRect(barX + px, barY, 2, 1);
      }

      // Kilometer tick marks (0km, 1km, 2km, 3km)
      for (let km = 0; km <= 3; km++) {
        const tx = barX + Math.round((km / 3) * barW);
        const passed = prog >= (km / 3) - 0.001;
        ctx.fillStyle = passed ? "#e6ebe0" : "rgba(185, 196, 182, 0.58)";
        const tickH = (km === 0 || km === 3) ? 5 : 3;
        ctx.fillRect(tx, barY - Math.floor(tickH / 2), 1, tickH);
      }

      // Solid phosphor progress trail covered so far
      const fillW = Math.round(prog * barW);
      if (fillW > 0) {
        ctx.fillStyle = "#dce6d6";
        ctx.fillRect(barX, barY, fillW, 2);
      }

      // Blinking pixel runner marker on the route line
      const runnerX = barX + fillW;
      ctx.fillStyle = "rgba(8, 10, 8, 0.95)";
      ctx.fillRect(runnerX - 2, barY - 4, 5, 9);
      ctx.fillStyle = (safeClock % 0.50 < 0.34) ? "#f4f6ec" : "#b8cab4";
      ctx.fillRect(runnerX - 1, barY - 3, 3, 7);

      // Compact "3KM" extraction label right above the end tick
      this.drawText("3KM", barX + barW - 16, barY - 12, 1, 1, "#cfd8c8");

      // 6. BOTTOM-RIGHT: Subtle Tape Distance Meter
      const dStr = `${String(distBucket).padStart(4, "0")}M`;
      this.drawText(dStr, 332, 191, 1, 2, "#cfcfc2");

      this.texture.needsUpdate = true;
    }
  }

  function renderOsdLines(canvas, lines) {
    if (!canvas || !lines || !lines.length) return;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const line of lines) {
      const upper = String(line.text || "").toUpperCase();
      const sx = line.scaleX || 1;
      const sy = line.scaleY || 2;
      const step = 6 * sx;
      const totalW = Math.max(0, upper.length * step - sx);
      let curX = Math.floor((canvas.width - totalW) * 0.5);
      const baseY = Math.floor(line.y || 0);
      const fg = line.color || "#ecece0";

      for (let c = 0; c < upper.length; c++) {
        const ch = upper[c];
        const rows = GLYPHS[ch] || GLYPHS[" "];
        if (ch !== " ") {
          for (let r = 0; r < 7; r++) {
            const row = rows[r];
            for (let col = 0; col < 5; col++) {
              if (row[col] === "1") {
                const px = curX + col * sx;
                const py = baseY + r * sy;
                ctx.fillStyle = "rgba(4, 6, 4, 0.92)";
                ctx.fillRect(px + sx, py + sy, sx, sy);
                ctx.fillStyle = fg;
                ctx.fillRect(px, py, sx, sy);
              }
            }
          }
        }
        curX += step;
      }
    }
  }

  return { VcrOsdRenderer, renderOsdLines };
})();
