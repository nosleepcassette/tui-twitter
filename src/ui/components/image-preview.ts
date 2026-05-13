import { FrameBufferRenderable, RGBA, h, type FrameBufferOptions } from "@opentui/core";
import type { OptimizedBuffer, RenderContext } from "@opentui/core";

export interface ImagePreviewData {
  width: number;
  height: number;
  pixels: Uint8Array;
}

interface ImagePreviewRenderableOptions extends FrameBufferOptions {
  image: ImagePreviewData;
}

class ImagePreviewRenderable extends FrameBufferRenderable {
  private readonly image: ImagePreviewData;
  private drawn = false;

  public constructor(ctx: RenderContext, options: ImagePreviewRenderableOptions) {
    super(ctx, options);
    this.image = options.image;
  }

  protected override onResize(width: number, height: number): void {
    super.onResize(width, height);
    this.drawn = false;
  }

  protected override renderSelf(buffer: OptimizedBuffer): void {
    this.ensureImageDrawn();
    super.renderSelf(buffer);
  }

  private ensureImageDrawn(): void {
    if (this.drawn) {
      return;
    }

    this.frameBuffer.clear(RGBA.fromInts(0, 0, 0, 0));

    const { width, height, pixels } = this.image;
    const maxY = Math.min(height, this.frameBuffer.height);
    const maxX = Math.min(width, this.frameBuffer.width);

    for (let y = 0; y < maxY; y += 1) {
      for (let x = 0; x < maxX; x += 1) {
        const offset = (y * width + x) * 4;
        const color = RGBA.fromInts(
          pixels[offset] ?? 0,
          pixels[offset + 1] ?? 0,
          pixels[offset + 2] ?? 0,
          pixels[offset + 3] ?? 255,
        );
        this.frameBuffer.setCell(x, y, " ", color, color);
      }
    }

    this.drawn = true;
  }
}

export function renderImagePreview(
  image: ImagePreviewData,
  options: Omit<FrameBufferOptions, "width" | "height"> = {},
) {
  return h(ImagePreviewRenderable, {
    ...options,
    width: image.width,
    height: image.height,
    respectAlpha: true,
    image,
  });
}
