/* images.js — uploaded banner artwork.

   Images are downscaled before storage: a 4 MB phone photo becomes roughly
   60 kB, which matters because everything here lives in localStorage and the
   whole experiment has to fit in a few megabytes. They are kept under their own
   key so a storage failure on artwork can never corrupt the experiment itself. */

const KEY = 'shopperlab.images.v1';
const MAX_W = 1000;
const MAX_H = 640;
const QUALITY = 0.78;

function readAll() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

function writeAll(map) {
  localStorage.setItem(KEY, JSON.stringify(map));
}

export function getImage(id) {
  if (!id) return null;
  return readAll()[id] || null;
}

export function allImages() {
  return readAll();
}

export function deleteImage(id) {
  const map = readAll();
  delete map[id];
  try { writeAll(map); } catch { /* nothing we can do, and nothing breaks */ }
}

/* Reads a File, shrinks it to fit inside MAX_W × MAX_H, stores it, returns the id. */
export function saveImage(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('That file is not an image.'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The file could not be read.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That image could not be decoded.'));
      img.onload = () => {
        const scale = Math.min(1, MAX_W / img.width, MAX_H / img.height);
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const g = canvas.getContext('2d');
        g.drawImage(img, 0, 0, w, h);

        // PNG only when the source might have transparency, otherwise JPEG
        const wantsAlpha = /png|webp|gif|svg/i.test(file.type);
        const dataUrl = wantsAlpha
          ? canvas.toDataURL('image/png')
          : canvas.toDataURL('image/jpeg', QUALITY);

        const id = 'img-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const map = readAll();
        map[id] = dataUrl;
        try {
          writeAll(map);
        } catch {
          reject(new Error('Browser storage is full. Delete a few uploaded images and try again.'));
          return;
        }
        resolve({ id, dataUrl, width: w, height: h, bytes: dataUrl.length });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export function storageUsedKb() {
  const raw = localStorage.getItem(KEY) || '';
  return Math.round(raw.length / 1024);
}

/* Included in experiment exports so a shared file carries its artwork. */
export function exportImages(ids) {
  const all = readAll();
  const out = {};
  for (const id of ids) if (all[id]) out[id] = all[id];
  return out;
}

export function importImages(map) {
  if (!map || typeof map !== 'object') return;
  const all = readAll();
  Object.assign(all, map);
  try { writeAll(all); } catch { /* artwork is optional */ }
}
