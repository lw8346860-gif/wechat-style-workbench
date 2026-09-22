/* Original image bytes live here, never in editor/history HTML. No uploads or persistence. */
(() => {
  'use strict';
  const PLACEHOLDER = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="480" height="100"%3E%3Crect width="480" height="100" fill="%23eeeeee"/%3E%3C/svg%3E';
  const nextFrame = () => new Promise(resolve => setTimeout(resolve, 0));
  const dataUrl = blob => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

  class ImageLibrary {
    constructor(onPreview) {
      this.assets = new Map();
      this.bySource = new Map();
      this.onPreview = onPreview;
      this.previewQueue = Promise.resolve();
      this.pending = 0;
    }

    async add(blob) {
      if (!blob?.size) throw new Error('图片数据为空');
      const bytes = await blob.arrayBuffer();
      const hash = globalThis.crypto?.subtle
        ? [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('')
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const id = `image-${hash}`;
      if (this.assets.has(id)) return this.assets.get(id);
      const asset = { id, original: blob, originalUrl: URL.createObjectURL(blob), previewUrl: '', previewBytes: 0 };
      // The editor initially shows a tiny placeholder while a single preview job runs.
      asset.previewUrl = blob.size < 180000 || /image\/(gif|svg\+xml)/i.test(blob.type) ? asset.originalUrl : PLACEHOLDER;
      this.assets.set(id, asset);
      this.bySource.set(asset.originalUrl, id);
      this.pending += 1;
      this.previewQueue = this.previewQueue.then(async () => {
        try {
          await nextFrame();
          if (this.assets.get(id) !== asset) return;
          if (/image\/(gif|svg\+xml)/i.test(blob.type)) return;
          let bitmap;
          if (typeof createImageBitmap === 'function') {
            bitmap = await createImageBitmap(blob, { resizeWidth: 1000, resizeQuality: 'medium' });
          } else {
            bitmap = new Image();
            bitmap.src = asset.originalUrl;
            await bitmap.decode();
          }
          try {
            const scale = Math.min(1, 1000 / bitmap.width, 1600 / bitmap.height);
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(bitmap.width * scale));
            canvas.height = Math.max(1, Math.round(bitmap.height * scale));
            canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            const preview = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.8));
            canvas.width = canvas.height = 1;
            if (this.assets.get(id) !== asset) return;
            if (preview && preview.size < blob.size) {
              asset.previewUrl = URL.createObjectURL(preview);
              asset.previewBytes = preview.size;
              this.bySource.set(asset.previewUrl, id);
            } else asset.previewUrl = asset.originalUrl;
          } finally { bitmap.close?.(); }
        } catch {
          asset.previewUrl = asset.originalUrl;
        } finally {
          this.pending -= 1;
          if (this.assets.get(id) === asset) this.onPreview?.(asset);
        }
      });
      return asset;
    }

    get(image) {
      return this.assets.get(image.dataset.imageId) || this.assets.get(this.bySource.get(image.getAttribute('src')));
    }

    bind(image, asset) {
      image.dataset.imageId = asset.id;
      image.src = asset.previewUrl;
      image.loading = 'lazy';
      image.decoding = 'async';
      image.removeAttribute('srcset');
      image.removeAttribute('data-src');
      image.removeAttribute('data-image-missing');
    }

    restore(root) {
      root.querySelectorAll('img[data-image-id]').forEach(image => {
        const asset = this.get(image);
        if (asset) this.bind(image, asset);
      });
    }

    collect(referencedHtml) {
      const keep = new Set();
      for (const html of referencedHtml) {
        for (const match of html.matchAll(/data-image-id="([^"]+)"/g)) keep.add(match[1]);
      }
      for (const [id, asset] of this.assets) {
        if (keep.has(id)) continue;
        URL.revokeObjectURL(asset.originalUrl);
        if (asset.previewUrl !== asset.originalUrl && asset.previewUrl !== PLACEHOLDER) URL.revokeObjectURL(asset.previewUrl);
        this.bySource.delete(asset.originalUrl);
        this.bySource.delete(asset.previewUrl);
        this.assets.delete(id);
      }
    }

    stats() {
      return { count: this.assets.size, originalBytes: [...this.assets.values()].reduce((n, a) => n + a.original.size, 0), previewBytes: [...this.assets.values()].reduce((n, a) => n + a.previewBytes, 0), pending: this.pending };
    }
  }

  // Read only PNG/JPEG pict destinations. Skip the alternate nonshppict rendering.
  // Browsers do not always expose text/rtf; absence is reported by the importer.
  async function rtfPictures(rtf) {
    if (!rtf) return [];
    const stack = [];
    const pictures = [];
    let group = { skip: false, picture: null };
    for (let i = 0; i < rtf.length;) {
      if (i && i % 65536 === 0) await nextFrame();
      const c = rtf[i++];
      if (c === '{') { stack.push(group); group = { skip: group.skip, picture: group.picture }; continue; }
      if (c === '}') { group = stack.pop() || { skip: false, picture: null }; continue; }
      if (c === '\\') {
        const match = /^([a-z]+)(-?\d+)? ?/i.exec(rtf.slice(i, i + 80));
        if (!match) { if (rtf[i] === "'") i += 3; else i += 1; continue; }
        i += match[0].length;
        const word = match[1].toLowerCase();
        if (word === 'nonshppict') group.skip = true;
        if (word === 'pict' && !group.skip) {
          group.picture = { type: '', hex: [], binary: [] };
          pictures.push(group.picture);
        }
        if (group.picture && !group.skip) {
          if (word === 'pngblip') group.picture.type = 'image/png';
          if (word === 'jpegblip') group.picture.type = 'image/jpeg';
          if (word === 'blipuid' || word === 'picprop') group.skip = true;
        }
        if (word === 'bin') {
          const length = Math.max(0, Number(match[2]) || 0);
          if (group.picture && !group.skip) group.picture.binary.push(Uint8Array.from(rtf.slice(i, i + length), ch => ch.charCodeAt(0) & 255));
          i += length;
        }
        continue;
      }
      if (group.picture && !group.skip && /[0-9a-f]/i.test(c)) {
        const chunk = /^[0-9a-f\s]+/i.exec(rtf.slice(i - 1, i + 65535))[0];
        group.picture.hex.push(chunk.replace(/\s/g, ''));
        i += chunk.length - 1;
        if (chunk.length > 16000) await nextFrame();
      }
    }
    const blobs = [];
    for (const picture of pictures) {
      if (!picture.type) { blobs.push(null); continue; }
      const hex = picture.hex.join('');
      if (hex.length % 2) { blobs.push(null); continue; }
      const bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
        if (i && i % 131072 === 0) await nextFrame();
      }
      const parts = picture.binary.length ? picture.binary : [bytes];
      const blob = new Blob(parts, { type: picture.type });
      blobs.push(blob.size ? blob : null);
    }
    return blobs;
  }

  function sanitizeArticle(html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    // Word's VML image reference sometimes lives in an Office conditional comment.
    const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_COMMENT);
    const comments = [];
    while (walker.nextNode()) comments.push(walker.currentNode);
    for (const comment of comments) {
      const parentHasImage = comment.parentElement?.querySelector('img');
      const sources = [...comment.data.matchAll(/<(?:v:)?imagedata\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)];
      if (!parentHasImage) sources.forEach(match => {
        const image = document.createElement('img');
        image.setAttribute('src', match[1]);
        comment.before(image);
      });
    }
    template.content.querySelectorAll('*').forEach(node => {
      if (node.localName === 'v:imagedata') {
        const image = document.createElement('img');
        image.setAttribute('src', node.getAttribute('src') || '');
        node.replaceWith(image);
      }
    });
    const localSources = new Map();
    template.content.querySelectorAll('img').forEach((image, index) => {
      localSources.set(String(index), image.getAttribute('src') || image.getAttribute('data-src') || '');
      image.dataset.pasteImage = String(index);
    });
    const clean = DOMPurify.sanitize(template.innerHTML, {
      RETURN_DOM_FRAGMENT: true,
      ALLOWED_TAGS: ['p','div','section','article','span','br','h1','h2','h3','h4','h5','h6','strong','b','em','i','u','s','sup','sub','a','img','blockquote','ul','ol','li','table','tbody','thead','tr','th','td','figure','figcaption','hr','font'],
      ALLOWED_ATTR: ['style','href','src','alt','width','height','colspan','rowspan','face','size','color','start','value','data-paste-image','data-image-id','data-wechat-role','data-wechat-title-part','data-title-base','data-title-original'],
      ALLOW_DATA_ATTR: false
    });
    clean.querySelectorAll('[style]').forEach(node => {
      const style = node.style;
      for (const name of [...style]) {
        if (!/^(font(-size|-family|-weight|-style)?|line-height|letter-spacing|color|background-color|text-align|text-decoration(-line)?|margin(-left|-right|-top|-bottom)?|padding(-left|-right|-top|-bottom)?|border(-left|-right|-top|-bottom)?|width|max-width|height|display)$/.test(name) || /url\s*\(|expression\s*\(/i.test(style.getPropertyValue(name))) style.removeProperty(name);
      }
      if (['none'].includes(style.display)) style.removeProperty('display');
    });
    clean.querySelectorAll('img').forEach(image => {
      const source = localSources.get(image.dataset.pasteImage) || '';
      image.removeAttribute('data-paste-image');
      image.removeAttribute('src');
      // Keep the source off the live DOM until the importer resolves its bytes.
      image._pasteSource = source;
    });
    return clean;
  }

  window.WorkbenchMedia = { ImageLibrary, rtfPictures, sanitizeArticle, dataUrl, PLACEHOLDER, nextFrame };
})();
