import type { LogoBackground } from "./rules";

/**
 * The ground that fits a logo, from its pixels (RGBA, as a canvas gives them): a light logo on a see-through ground
 * (a white logo, say) needs the dark one; everything else sits on the light one. "See-through" means at least a tenth
 * of the image, "light" the average brightness of the visible pixels.
 */
export function groundForPixels(rgba: ArrayLike<number>): LogoBackground {
  let visible = 0;
  let clear = 0;
  let light = 0;
  for (let index = 0; index + 3 < rgba.length; index += 4) {
    if (rgba[index + 3] < 40) { clear++; continue; }
    visible++;
    light += (0.2126 * rgba[index] + 0.7152 * rgba[index + 1] + 0.0722 * rgba[index + 2]) / 255;
  }
  return visible > 0 && clear / (visible + clear) > 0.1 && light / visible > 0.72 ? "dark" : "light";
}

/** The fitting ground of an image in the browser; null when it cannot be read (a link without CORS, say). */
export function detectLogoGround(url: string): Promise<LogoBackground | null> {
  return new Promise((resolve) => {
    const image = new Image();
    if (!url.startsWith("blob:") && !url.startsWith("data:")) image.crossOrigin = "anonymous";
    image.onload = () => {
      try {
        const size = 48;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext("2d");
        if (!context) { resolve(null); return; }
        context.drawImage(image, 0, 0, size, size);
        resolve(groundForPixels(context.getImageData(0, 0, size, size).data));
      } catch {
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = url;
  });
}
