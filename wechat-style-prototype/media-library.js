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

    async add(blob, sources = []) {
      if (!blob?.size) throw new Error('图片数据为空');
      const bytes = await blob.arrayBuffer();
      const hash = globalThis.crypto?.subtle
        ? [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('')
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const id = `image-${hash}`;
      if (this.assets.has(id)) {
        const asset = this.assets.get(id);
        sources.filter(Boolean).forEach(source => { asset.sources.add(source); this.bySource.set(source, id); });
        return asset;
      }
      const asset = { id, original: blob, originalUrl: URL.createObjectURL(blob), previewUrl: '', previewBytes: 0, sources: new Set(sources.filter(Boolean)) };
      // The editor initially shows a tiny placeholder while a single preview job runs.
      asset.previewUrl = blob.size < 180000 || /image\/(gif|svg\+xml)/i.test(blob.type) ? asset.originalUrl : PLACEHOLDER;
      this.assets.set(id, asset);
      this.bySource.set(asset.originalUrl, id);
      asset.sources.forEach(source => this.bySource.set(source, id));
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

    fromSource(source) { return this.assets.get(this.bySource.get(source)); }

    bind(image, asset) {
      if (image.hasAttribute('data-image-missing')) { image.alt = '文章图片'; image.removeAttribute('title'); }
      image.dataset.imageId = asset.id;
      image.src = asset.previewUrl;
      image.loading = 'lazy';
      image.decoding = 'async';
      image.removeAttribute('srcset');
      image.removeAttribute('data-src');
      image.removeAttribute('data-image-missing');
      image.removeAttribute('data-image-source');
      image.removeAttribute('data-image-referrer');
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
        asset.sources.forEach(source => { if (this.bySource.get(source) === id) this.bySource.delete(source); });
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

  function imageSources(image, baseUrl) {
    const resolve = value => {
      if (!value) return '';
      value = value.trim();
      if (/^(data:image\/|blob:|https?:\/\/)/i.test(value)) return value;
      if (value.startsWith('//')) return 'https:' + value;
      try { return baseUrl ? new URL(value, baseUrl).href : value; } catch { return ''; }
    };
    const largest = value => {
      if (!value || value.trim().startsWith('data:')) return '';
      return value.split(',').map(item => {
        const [url, descriptor = '1x'] = item.trim().split(/\s+/);
        return { url, size: parseFloat(descriptor) || 1 };
      }).sort((a,b) => b.size - a.size)[0]?.url || '';
    };
    const candidates = ['data-src','data-original','data-lazy-src','data-actualsrc','data-url','_src','data-croporisrc'].map(name => image.getAttribute(name));
    candidates.push(largest(image.getAttribute('data-srcset') || image.getAttribute('srcset')));
    image.closest('picture')?.querySelectorAll('source[srcset]').forEach(source => candidates.push(largest(source.getAttribute('srcset'))));
    candidates.push(image.getAttribute('src'));
    const resolved = [...new Set(candidates.map(resolve).filter(Boolean))];
    // Lazy-loaded pages often keep a 1px data GIF in src. It is not a fallback original.
    const hasRemote = resolved.some(source => /^https?:/i.test(source));
    return hasRemote && resolved.length > 1 ? resolved.filter(source => !/^(?:data:|blob:)/i.test(source) && !/(?:^|\/)(?:loading|spacer|blank|placeholder|transparent|1x1)[^/]*\.(?:gif|png|svg)(?:\?|$)/i.test(source)) : resolved;
  }

  function sanitizeArticle(html, { baseUrl = '' } = {}) {
    const template = document.createElement('template');
    template.innerHTML = html;
    baseUrl ||= /(?:^|\n)SourceURL:\s*(https?:\/\/\S+)/i.exec(html)?.[1] || template.content.querySelector('meta[property="og:url"],base[href]')?.getAttribute('content') || template.content.querySelector('base[href]')?.getAttribute('href') || '';
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
      localSources.set(String(index), imageSources(image, baseUrl));
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
      const sources = localSources.get(image.dataset.pasteImage) || [];
      image.removeAttribute('data-paste-image');
      image.removeAttribute('src');
      // Keep the source off the live DOM until the importer resolves its bytes.
      image._pasteSource = sources[0] || '';
      image._pasteSources = sources;
      image._pasteReferrer = baseUrl;
    });
    return clean;
  }

  function articleFragment(html, sourceUrl, title = '') {
    const template = document.createElement('template');
    template.innerHTML = html;
    const wechat = template.content.querySelector('#js_content');
    const candidates = [...template.content.querySelectorAll('article, main, [role="main"], [itemprop="articleBody"], .entry-content, .post-content, #page-content')];
    const root = wechat || candidates.sort((a,b) => (b.textContent.length + b.querySelectorAll('img').length * 150) - (a.textContent.length + a.querySelectorAll('img').length * 150))[0] || template.content;
    root.querySelectorAll('script,style,noscript,iframe,object,embed,form,nav,footer,aside,head,button,input,[hidden],[aria-hidden="true"]').forEach(node => node.remove());
    // Published WeChat HTML can contain repeated, completely empty img residues.
    // Drop only identity-less empty markup here, never Word/clipboard image slots.
    let emptyImages = 0;
    if (wechat) root.querySelectorAll('img').forEach(image => {
      if (imageSources(image, sourceUrl).length) return;
      if ([...image.attributes].some(attribute => !['class','style'].includes(attribute.name) && attribute.value.trim())) return;
      image.remove();
      emptyImages++;
    });
    const fragment = sanitizeArticle(root.innerHTML ?? [...root.childNodes].map(node => node.outerHTML || node.textContent).join(''), { baseUrl: sourceUrl });
    fragment._emptyImageCount = emptyImages;
    if (!fragment.textContent.trim() && !fragment.querySelector('img')) throw new Error('网页没有可读取的正文，请打开文章后复制全文粘贴');
    const firstText = fragment.firstElementChild?.textContent.trim() || '';
    if (title && firstText !== title.trim()) {
      const heading = document.createElement('h1');
      heading.dataset.wechatRole = 'article-title';
      heading.textContent = title;
      fragment.prepend(heading);
    }
    return fragment;
  }

  async function mapConcurrent(items, work, limit = 3) {
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) { const index = next++; await work(items[index], index); }
    }));
  }

  const helperHint = '图片读取服务暂不可用，请稍后点“重试补图”；电脑也可双击项目中的“启动公众号操作台”';
  class LinkClient {
    constructor() {
      this.helperBase = '';
      this.probe = null;
      this.unavailableUntil = 0;
      this.inFlight = new Map();
    }

    async request(url, options = {}, timeout = 23000) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', ...options, signal: controller.signal });
        const reader = response.body?.getReader();
        const chunks = [];
        let size = 0;
        if (reader) while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 40 * 1024 * 1024) { await reader.cancel(); throw new Error('读取内容超过 40MB，请拆分后再粘贴'); }
          chunks.push(value);
        }
        const buffered = new Response(new Blob(chunks), { status: response.status, statusText: response.statusText, headers: response.headers });
        Object.defineProperty(buffered, 'url', { value: response.url });
        return buffered;
      }
      finally { clearTimeout(timer); }
    }

    async helper() {
      if (this.helperBase) return this.helperBase;
      if (Date.now() < this.unavailableUntil) throw new Error(helperHint);
      if (!this.probe) this.probe = (async () => {
        for (const base of this.bases()) {
          try {
            const response = await this.request(base + '/api/health', {}, 3500);
            const health = await response.json();
            if (response.ok && health.service === 'wechat-style-link-helper' && health.version >= 2) { this.helperBase = base.replace(/\/$/, ''); return this.helperBase; }
          } catch { /* Try the next configured endpoint. */ }
        }
        this.unavailableUntil = Date.now() + 5000;
        throw new Error(helperHint);
      })().finally(() => { this.probe = null; });
      return this.probe;
    }

    bases() {
      if (window.WORKBENCH_HELPER_URL) return [window.WORKBENCH_HELPER_URL.replace(/\/$/, '')];
      const localPage = location.protocol === 'file:' || ['localhost','127.0.0.1'].includes(location.hostname);
      return [localPage ? 'http://127.0.0.1:4318' : '', 'https://mp.togma.online'].filter(Boolean);
    }

    async proxyRequest(path, payload) {
      const primary = await this.helper();
      let lastError;
      for (const base of [...new Set([primary, ...this.bases()])]) {
        try {
          const response = await this.request(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, 30000);
          if (!response.ok) {
            const detail = await response.json().catch(() => ({}));
            throw new Error(detail.error || '读取暂未完成，请重试补图');
          }
          this.helperBase = base;
          return response;
        } catch (error) { lastError = error; }
      }
      throw lastError || new Error(helperHint);
    }

    async readArticle(url) {
      try {
        const payload = await (await this.proxyRequest('/api/read-article', { url })).json();
        if (!payload.html && !payload.imageUrl) throw new Error(payload.error || '没有读取到文章正文');
        return payload;
      } catch (error) {
        try {
          const response = await this.request(url);
          if (!response.ok || !/text\/html|application\/xhtml/i.test(response.headers.get('content-type') || '')) throw new Error();
          return { html: await response.text(), sourceUrl: response.url, title: '' };
        } catch { throw error; }
      }
    }

    fetchImage(source, referrer = '') {
      const key = source + '\n' + referrer;
      if (this.inFlight.has(key)) return this.inFlight.get(key);
      const job = this.readImage(source, referrer).finally(() => this.inFlight.delete(key));
      this.inFlight.set(key, job);
      return job;
    }

    async readImage(source, referrer) {
      if (!/^(data:image\/|blob:|https?:\/\/)/i.test(source)) throw new Error('浏览器未提供图片文件');
      let remoteError;
      if (/^https?:/i.test(source)) {
        try {
          const response = await this.proxyRequest('/api/fetch-image', { url: source, referrer });
          return await response.blob();
        } catch (error) { remoteError = error; }
      }
      try {
        const response = await this.request(source, {}, 7000);
        if (!response.ok) throw new Error('图片读取失败');
        const blob = await response.blob();
        if (!blob.size || !blob.type.startsWith('image/')) throw new Error('源站未返回图片数据');
        if (blob.size > 40 * 1024 * 1024) throw new Error('单张图片超过 40MB，请单独补入');
        return blob;
      } catch (error) { throw remoteError || error; }
    }
  }

  window.WorkbenchMedia = { ImageLibrary, LinkClient, rtfPictures, sanitizeArticle, articleFragment, mapConcurrent, dataUrl, PLACEHOLDER, nextFrame };
})();
