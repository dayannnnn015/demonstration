/**
 * Preparing a profile photo in the browser.
 *
 * The picture never leaves the machine as it was taken. It is decoded,
 * cropped to a square and drawn onto a canvas, and only that canvas is
 * encoded and sent: a canvas carries no EXIF, so the phone's GPS position,
 * its make and serial, and the time it was taken are gone before upload. The
 * API checks the result again and strips anything that slipped through.
 */

/** Where the square sits on the picture: its centre, as a fraction of each side, and how far it is zoomed in. */
export type Crop = { x: number; y: number; zoom: number };
export const centred: Crop = { x: 0.5, y: 0.5, zoom: 1 };
export const maxZoom = 4;

export const sizes = { image: 384, thumb: 96 } as const;
// Under the API's limits (140 KB and 20 KB), with room for base64 to stay inside the request.
const budgets = { image: 135_000, thumb: 19_000 } as const;
const largestFile = 25 * 1024 * 1024;
export const smallestSide = 128;

export class PhotoProblem extends Error {}

/** Opens a chosen file as a picture, or says in words why it cannot be one. */
export async function openPicture(file: File): Promise<ImageBitmap> {
  if (file.size > largestFile) throw new PhotoProblem('That file is over 25 MB, too large to open here. Choose a smaller copy of the photo.');
  const heic = /\.(heic|heif)$/i.test(file.name) || /heic|heif/i.test(file.type);
  if (file.type && !file.type.startsWith('image/') && !heic) throw new PhotoProblem('That file is not a picture. Choose a photo saved as JPEG or PNG.');
  if (typeof createImageBitmap !== 'function') throw new PhotoProblem('This browser cannot prepare a photo. Use a current version of Chrome, Edge, Firefox or Safari.');
  let bitmap: ImageBitmap;
  try {
    // The orientation a phone records is applied here, so a portrait photo is not turned on its side.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new PhotoProblem(heic
      ? 'This browser cannot open an iPhone HEIC photo. On the iPhone, share the photo as a JPEG (or take a screenshot of it) and choose that instead.'
      : 'That file could not be opened as a picture. It may be damaged, or saved in a format this browser does not read. Try a JPEG or PNG copy.');
  }
  if (Math.min(bitmap.width, bitmap.height) < smallestSide) {
    bitmap.close();
    throw new PhotoProblem(`That picture is too small to use (${bitmap.width} by ${bitmap.height} pixels). Choose one at least ${smallestSide} pixels on each side.`);
  }
  return bitmap;
}

/** The square, in the picture's own pixels, that a crop selects. Always inside the picture. */
export function cropSquare(width: number, height: number, crop: Crop) {
  const side = Math.min(width, height) / Math.min(maxZoom, Math.max(1, crop.zoom));
  const left = Math.min(width - side, Math.max(0, crop.x * width - side / 2));
  const top = Math.min(height - side, Math.max(0, crop.y * height - side / 2));
  return { left, top, side };
}

/** Moves a crop's centre so the square stays wholly on the picture. */
export function clampCrop(width: number, height: number, crop: Crop): Crop {
  const { left, top, side } = cropSquare(width, height, crop);
  return { zoom: Math.min(maxZoom, Math.max(1, crop.zoom)), x: (left + side / 2) / width, y: (top + side / 2) / height };
}

/** A quarter turn, for a photo saved on its side with no orientation recorded. */
export async function turned(bitmap: ImageBitmap): Promise<ImageBitmap> {
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.height;
  canvas.height = bitmap.width;
  const context = canvas.getContext('2d')!;
  context.translate(canvas.width, 0);
  context.rotate(Math.PI / 2);
  context.drawImage(bitmap, 0, 0);
  return createImageBitmap(canvas);
}

/** Draws the cropped square onto a canvas of the given side, on white: a transparent PNG would otherwise turn black as a JPEG. */
export function drawCrop(canvas: HTMLCanvasElement, bitmap: ImageBitmap, crop: Crop, side: number) {
  canvas.width = side;
  canvas.height = side;
  const context = canvas.getContext('2d');
  if (!context) return;
  const square = cropSquare(bitmap.width, bitmap.height, crop);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, side, side);
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, square.left, square.top, square.side, square.side, 0, 0, side, side);
}

const blobOf = (canvas: HTMLCanvasElement, quality: number) => new Promise<Blob>((resolve, reject) =>
  canvas.toBlob(blob => (blob ? resolve(blob) : reject(new PhotoProblem('The photo could not be prepared. Try again.'))), 'image/jpeg', quality));

async function base64Of(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = '';
  for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(text);
}

/** Encodes one size, stepping the quality down until it fits its budget. */
async function encode(bitmap: ImageBitmap, crop: Crop, which: keyof typeof sizes) {
  const canvas = document.createElement('canvas');
  drawCrop(canvas, bitmap, crop, sizes[which]);
  for (const quality of [0.88, 0.8, 0.7, 0.6, 0.5, 0.4]) {
    const blob = await blobOf(canvas, quality);
    if (blob.size <= budgets[which]) return base64Of(blob);
  }
  throw new PhotoProblem('This photo has too much fine detail to fit. Zoom in on your face and try again.');
}

/** Both sizes the API keeps, ready to send. */
export async function preparePhoto(bitmap: ImageBitmap, crop: Crop) {
  return { image: await encode(bitmap, crop, 'image'), thumb: await encode(bitmap, crop, 'thumb') };
}
