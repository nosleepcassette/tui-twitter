# maps · cassette.help · MIT
# BUILDSHEET: tui-twitter — Image Rendering Backends v1
# Target: Codex
# Date: 2026-05-13
# Status: READY FOR IMPLEMENTATION

---

## Context

The TUI already has a working Kitty Graphics Protocol backend
(`src/ui/media/kitty-backend.ts`) and a clean `InlineImageBackend` interface
(`src/ui/media/inline-image-backend.ts`). The `InlineImageManager` resolves
to `"kitty" | "off"` — anything that isn't Kitty gets nothing.

This buildsheet adds two new backends in priority order:

1. **iTerm2 inline image protocol** (P0) — covers iTerm2, VS Code terminal, Warp
2. **Unicode half-block fallback** (P1) — covers all truecolor terminals; renders
   images as colored `▀`/`▄` block characters, no graphics protocol required

Sixel is explicitly out of scope for this build.

---

## Files to Modify

- `src/ui/media/inline-image-backend.ts` — expand `name` union
- `src/ui/media/inline-image-manager.ts` — add backends, expand mode type, update `resolveMode()`
- `src/config.ts` — expand `XImageMode`

## Files to Create

- `src/ui/media/iterm2-backend.ts` — iTerm2 inline image backend
- `src/ui/media/halfblock-backend.ts` — Unicode half-block backend

---

## Part 1: `inline-image-backend.ts` — expand name union

Change:
```typescript
readonly name: "kitty";
```
To:
```typescript
readonly name: "kitty" | "iterm2" | "halfblock";
```

No other changes to this file.

---

## Part 2: `src/ui/media/iterm2-backend.ts` — new file

iTerm2 inline image protocol. One escape sequence per image, no streaming,
no image IDs. Simpler than Kitty.

Protocol:
```
ESC ] 1337 ; File=inline=1;width=<W>px;height=<H>px;preserveAspectRatio=1:<base64> BEL
```

Full implementation:

```typescript
import type { CliRenderer } from "@opentui/core";
import type { InlineImageBackend, InlineImageRequest } from "./inline-image-backend.js";

const OSC = "\u001b]";
const BEL = "\u0007";

export class ITerm2InlineImageBackend implements InlineImageBackend {
  public readonly name = "iterm2" as const;

  public isAvailable(_renderer: CliRenderer): boolean {
    if (!process.stdout.isTTY) {
      return false;
    }
    const termProgram = (process.env.TERM_PROGRAM ?? "").toLowerCase();
    // iTerm2, VS Code integrated terminal, Warp also supports this protocol.
    // Allow passthrough in tmux (unlike Kitty, iTerm2 protocol works via tmux passthrough).
    if (termProgram.includes("iterm") || termProgram === "vscode") {
      return true;
    }
    // Warp and Tabby also implement the protocol.
    if (termProgram.includes("warp") || termProgram.includes("tabby")) {
      return true;
    }
    return false;
  }

  public async show(request: InlineImageRequest): Promise<void> {
    this.render(request);
  }

  public async update(request: InlineImageRequest): Promise<void> {
    // iTerm2 protocol has no update concept — just re-render in place.
    this.render(request);
  }

  public async hide(_imageId: string): Promise<void> {
    // No delete command in iTerm2 protocol. The InlineImageManager's
    // anchor-based layout handles clearing by not re-rendering.
  }

  public async clearAll(): Promise<void> {
    // No global clear available. No-op; manager stops re-rendering.
  }

  private render(request: InlineImageRequest): void {
    const { placement, asset } = request;
    const b64 = asset.pngData.toString("base64");
    const row = placement.y + 1;
    const col = placement.x + 1;

    const save = "\u001b7";
    const restore = "\u001b8";
    const move = `\u001b[${row};${col}H`;

    // Wrap in tmux passthrough if inside tmux.
    const write = Boolean(process.env.TMUX)
      ? (s: string) => process.stdout.write(`\u001bPtmux;\u001b${s}\u001b\\`)
      : (s: string) => process.stdout.write(s);

    process.stdout.write(save);
    process.stdout.write(move);
    write(
      `${OSC}1337;File=inline=1` +
        `;width=${asset.width}px` +
        `;height=${asset.height}px` +
        `;preserveAspectRatio=1` +
        `:${b64}${BEL}`,
    );
    process.stdout.write(restore);
  }
}
```

---

## Part 3: `src/ui/media/halfblock-backend.ts` — new file

Unicode half-block renderer. Uses `▀` (U+2580) and space with foreground +
background ANSI 24-bit color to render 2 vertical pixels per terminal cell.
No graphics protocol required — works in any truecolor terminal.

Each cell row represents 2 pixel rows: upper pixel → foreground color of `▀`,
lower pixel → background color of `▀`.

Full implementation:

```typescript
import type { CliRenderer } from "@opentui/core";
import type { InlineImageBackend, InlineImageRequest } from "./inline-image-backend.js";

const RESET = "\u001b[0m";
const UPPER_HALF = "▀";

export class HalfblockInlineImageBackend implements InlineImageBackend {
  public readonly name = "halfblock" as const;

  public isAvailable(_renderer: CliRenderer): boolean {
    if (!process.stdout.isTTY) {
      return false;
    }
    // Require truecolor support. COLORTERM=truecolor or 24bit is the standard indicator.
    const colorterm = (process.env.COLORTERM ?? "").toLowerCase();
    if (colorterm === "truecolor" || colorterm === "24bit") {
      return true;
    }
    // Also check TERM for known truecolor-capable values.
    const term = (process.env.TERM ?? "").toLowerCase();
    return term.includes("256color") || term.includes("kitty") || term.includes("xterm-direct");
  }

  public async show(request: InlineImageRequest): Promise<void> {
    await this.render(request);
  }

  public async update(request: InlineImageRequest): Promise<void> {
    await this.render(request);
  }

  public async hide(_imageId: string): Promise<void> {
    // Half-block rendering is stateless — nothing to clean up.
  }

  public async clearAll(): Promise<void> {
    // Stateless — no-op.
  }

  private async render(request: InlineImageRequest): Promise<void> {
    const { placement, asset } = request;

    // Resize the PNG to exactly (placement.width × 2, placement.height × 2) pixels
    // so each cell maps to exactly 2 pixel rows.
    const targetW = placement.width;
    const targetH = placement.height * 2;
    const pixels = await resizeToRgba(asset.pngData, targetW, targetH);

    const row = placement.y + 1;
    const col = placement.x + 1;
    const save = "\u001b7";
    const restore = "\u001b8";

    let out = save;
    for (let cellRow = 0; cellRow < placement.height; cellRow++) {
      const upperPixelRow = cellRow * 2;
      const lowerPixelRow = upperPixelRow + 1;
      out += `\u001b[${row + cellRow};${col}H`;
      for (let cellCol = 0; cellCol < placement.width; cellCol++) {
        const upper = getPixel(pixels, targetW, cellCol, upperPixelRow);
        const lower =
          lowerPixelRow < targetH
            ? getPixel(pixels, targetW, cellCol, lowerPixelRow)
            : { r: 0, g: 0, b: 0, a: 0 };

        // Skip fully transparent cells.
        if (upper.a < 16 && lower.a < 16) {
          out += " ";
          continue;
        }

        const fg = rgbAnsi(upper, true);
        const bg = rgbAnsi(lower, false);
        out += `${fg}${bg}${UPPER_HALF}`;
      }
      out += RESET;
    }
    out += restore;
    process.stdout.write(out);
  }
}

interface Pixel {
  r: number;
  g: number;
  b: number;
  a: number;
}

function getPixel(rgba: Uint8ClampedArray, width: number, x: number, y: number): Pixel {
  const offset = (y * width + x) * 4;
  return {
    r: rgba[offset] ?? 0,
    g: rgba[offset + 1] ?? 0,
    b: rgba[offset + 2] ?? 0,
    a: rgba[offset + 3] ?? 0,
  };
}

function rgbAnsi(pixel: Pixel, isForeground: boolean): string {
  const { r, g, b } = pixel;
  return isForeground
    ? `\u001b[38;2;${r};${g};${b}m`
    : `\u001b[48;2;${r};${g};${b}m`;
}

/**
 * Resize a PNG buffer to the target dimensions and return raw RGBA pixels.
 *
 * Uses the `sharp` package if available. Falls back to a nearest-neighbor
 * resize implemented against the raw PNG data via the `pngjs` package, which
 * is already used in post-image-preview.ts. If neither is present, returns a
 * zero-filled buffer (image will render as black blocks, better than crashing).
 */
async function resizeToRgba(
  pngData: Buffer,
  targetW: number,
  targetH: number,
): Promise<Uint8ClampedArray> {
  // Try sharp first (optional dep, much faster).
  try {
    const sharp = (await import("sharp")).default;
    const raw = await sharp(pngData)
      .resize(targetW, targetH, { fit: "fill" })
      .raw()
      .toBuffer({ resolveWithObject: true });
    return new Uint8ClampedArray(raw.data.buffer);
  } catch {
    // sharp not available — fall through
  }

  // Fall back to pngjs nearest-neighbor resize.
  try {
    const { PNG } = await import("pngjs");
    const src = PNG.sync.read(pngData);
    const out = new Uint8ClampedArray(targetW * targetH * 4);
    const xRatio = src.width / targetW;
    const yRatio = src.height / targetH;
    for (let y = 0; y < targetH; y++) {
      for (let x = 0; x < targetW; x++) {
        const srcX = Math.min(src.width - 1, Math.floor(x * xRatio));
        const srcY = Math.min(src.height - 1, Math.floor(y * yRatio));
        const srcOff = (srcY * src.width + srcX) * 4;
        const dstOff = (y * targetW + x) * 4;
        out[dstOff] = src.data[srcOff] ?? 0;
        out[dstOff + 1] = src.data[srcOff + 1] ?? 0;
        out[dstOff + 2] = src.data[srcOff + 2] ?? 0;
        out[dstOff + 3] = src.data[srcOff + 3] ?? 255;
      }
    }
    return out;
  } catch {
    // Neither sharp nor pngjs — return black.
    return new Uint8ClampedArray(targetW * targetH * 4);
  }
}
```

**Note for Codex:** Check whether `pngjs` is already a transitive dependency before
adding it explicitly. If `post-image-preview.ts` uses it, it's already present.
If not, add `pngjs` to `package.json` dependencies and run `bun install`.

---

## Part 4: `src/config.ts` — expand XImageMode

Change:
```typescript
export type XImageMode = "auto" | "kitty" | "off";
```
To:
```typescript
export type XImageMode = "auto" | "kitty" | "iterm2" | "halfblock" | "off";
```

Update `parseImageMode()`:
```typescript
function parseImageMode(value: string | undefined): XImageMode {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "auto") return "auto";
  if (normalized === "kitty" || normalized === "iterm2" || normalized === "halfblock" || normalized === "off") {
    return normalized;
  }
  throw new Error(`Invalid X_IMAGE_MODE value "${value}". Expected: auto | kitty | iterm2 | halfblock | off.`);
}
```

---

## Part 5: `src/ui/media/inline-image-manager.ts` — wire up new backends

### 5a. Expand ResolvedImageMode

```typescript
type ResolvedImageMode = "kitty" | "iterm2" | "halfblock" | "off";
```

### 5b. Import new backends

```typescript
import { ITerm2InlineImageBackend } from "./iterm2-backend.js";
import { HalfblockInlineImageBackend } from "./halfblock-backend.js";
```

### 5c. Instantiate in InlineImageManager

```typescript
export class InlineImageManager {
  private readonly kittyBackend = new KittyInlineImageBackend();
  private readonly iterm2Backend = new ITerm2InlineImageBackend();
  private readonly halfblockBackend = new HalfblockInlineImageBackend();
  // ... rest unchanged
```

### 5d. Replace resolveMode()

```typescript
private resolveMode(): ResolvedImageMode {
  if (this.configuredMode === "off") return "off";
  if (this.configuredMode === "kitty") {
    return this.kittyBackend.isAvailable(this.renderer) ? "kitty" : "off";
  }
  if (this.configuredMode === "iterm2") {
    return this.iterm2Backend.isAvailable(this.renderer) ? "iterm2" : "off";
  }
  if (this.configuredMode === "halfblock") {
    return this.halfblockBackend.isAvailable(this.renderer) ? "halfblock" : "off";
  }
  // auto: probe in priority order
  if (this.kittyBackend.isAvailable(this.renderer)) return "kitty";
  if (this.iterm2Backend.isAvailable(this.renderer)) return "iterm2";
  if (this.halfblockBackend.isAvailable(this.renderer)) return "halfblock";

  if (!this.warnedUnavailable) {
    this.warnedUnavailable = true;
    this.setStatus("No supported image rendering backend detected (set X_IMAGE_MODE=off to suppress).");
  }
  return "off";
}
```

### 5e. Thread backend dispatch through reconcileMany()

`reconcileMany()` currently assumes Kitty throughout. Add a `getActiveBackend()`
helper and replace direct `kittyBackend` calls:

```typescript
private getActiveBackend(mode: ResolvedImageMode): InlineImageBackend | null {
  if (mode === "kitty") return this.kittyBackend;
  if (mode === "iterm2") return this.iterm2Backend;
  if (mode === "halfblock") return this.halfblockBackend;
  return null;
}
```

In `reconcileMany()`, replace:
```typescript
const mode = this.resolveMode();
if (mode !== this.kittyBackend.name) {
```
With:
```typescript
const mode = this.resolveMode();
const backend = this.getActiveBackend(mode);
if (!backend) {
```

Replace all subsequent `this.kittyBackend.show/update/hide/clearAll` calls with
`backend.show/update/hide/clearAll`.

The `activeKittyImages` map can stay as-is (rename is cosmetic). The map tracks
active placements regardless of which backend drew them, so it remains correct.

---

## Part 6: `.env.example` — document new values

Add to the `X_IMAGE_MODE` comment:

```bash
# X_IMAGE_MODE=auto     # auto-detect: kitty > iterm2 > halfblock (default)
# X_IMAGE_MODE=kitty    # force Kitty Graphics Protocol
# X_IMAGE_MODE=iterm2   # force iTerm2 inline image protocol
# X_IMAGE_MODE=halfblock # force Unicode half-block fallback (works everywhere)
# X_IMAGE_MODE=off      # disable inline images entirely
```

---

## Implementation Order

1. `inline-image-backend.ts` — expand name union (30 sec)
2. `src/ui/media/iterm2-backend.ts` — new file
3. `src/ui/media/halfblock-backend.ts` — new file
4. `src/config.ts` — expand XImageMode + parseImageMode
5. `inline-image-manager.ts` — import, instantiate, resolveMode, getActiveBackend, thread dispatch
6. `.env.example` — update comment
7. `bun run typecheck` — should pass with no errors

---

## Non-Goals (v1)

- No sixel backend
- No capability query via DA1 escape (auto-detect uses env vars only)
- No tmux integration for Kitty (already explicitly blocked in kitty-backend.ts)
- No image caching changes (existing cache in post-image-preview.ts is sufficient)
