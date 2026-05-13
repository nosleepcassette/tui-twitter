import type { CliRenderer } from "@opentui/core";

export interface InlineImageAsset {
  cacheKey: string;
  width: number;
  height: number;
  pngData: Buffer;
}

export interface InlineImagePlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  pixelWidth: number;
  pixelHeight: number;
}

export interface InlineImageRequest {
  imageId: string;
  imageKey: string;
  asset: InlineImageAsset;
  placement: InlineImagePlacement;
}

export interface InlineImageBackend {
  readonly name: "kitty";
  isAvailable(renderer: CliRenderer): boolean;
  show(request: InlineImageRequest): Promise<void>;
  update(request: InlineImageRequest): Promise<void>;
  hide(imageId: string): Promise<void>;
  clearAll(): Promise<void>;
}
