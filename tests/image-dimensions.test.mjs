// Pure header/layout metadata tests. No browser, user profile, or native clipboard is used.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const source = fs.readFileSync(new URL('../wechat-style-prototype/media-library.js', import.meta.url), 'utf8');

function harness() {
  const sizes = new WeakMap();
  const urls = new Map();
  const bitmapCalls = [];
  class ImageURL extends URL {
    static createObjectURL(blob) { const url = URL.createObjectURL(blob); urls.set(url, blob); return url; }
    static revokeObjectURL(url) { urls.delete(url); URL.revokeObjectURL(url); }
  }
  class MetadataImage {
    async decode() {
      const size = sizes.get(urls.get(this.src));
      if (!size) throw new Error('No mocked image metadata');
      this.naturalWidth = this.width = size.width;
      this.naturalHeight = this.height = size.height;
    }
  }
  const sandbox = {
    window: {}, Blob, URL: ImageURL, Image: MetadataImage, crypto: webcrypto, TextDecoder,
    setTimeout, clearTimeout,
    createImageBitmap: async (blob, options) => {
      bitmapCalls.push(options);
      const original = sizes.get(blob);
      if (!original) throw new Error('No mocked bitmap size');
      return { width: options.resizeWidth || original.width, height: options.resizeHeight || original.height, close() {} };
    },
    document: { createElement: type => {
      assert.equal(type, 'canvas');
      return { width: 0, height: 0, getContext: () => ({ drawImage() {} }), toBlob: resolve => resolve(new Blob(['preview'], { type: 'image/webp' })) };
    } }
  };
  vm.runInNewContext(source, sandbox);
  const library = new sandbox.window.WorkbenchMedia.ImageLibrary();
  return { library, sizes, bitmapCalls, release: () => { for (const url of urls.keys()) ImageURL.revokeObjectURL(url); } };
}

function imageStub() {
  const attributes = new Map();
  return { dataset: {}, setAttribute: (name,value) => attributes.set(name,value), getAttribute: name => attributes.get(name) || null, hasAttribute: name => attributes.has(name), removeAttribute: name => attributes.delete(name) };
}

function png(width,height) {
  const bytes = Buffer.alloc(24);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);
  bytes.write('IHDR', 12);
  bytes.writeUInt32BE(width,16); bytes.writeUInt32BE(height,20);
  return bytes;
}

function tiff(orientation) {
  const bytes = Buffer.alloc(26);
  bytes.write('II'); bytes.writeUInt16LE(42,2); bytes.writeUInt32LE(8,4);
  bytes.writeUInt16LE(1,8); bytes.writeUInt16LE(0x0112,10); bytes.writeUInt16LE(3,12);
  bytes.writeUInt32LE(1,14); bytes.writeUInt16LE(orientation,18);
  return bytes;
}

function jpeg(width,height,orientation=1) {
  const exif = Buffer.concat([Buffer.from('Exif\0\0'),tiff(orientation)]);
  const app1 = Buffer.alloc(4); app1[0]=255; app1[1]=225; app1.writeUInt16BE(exif.length+2,2);
  const sof = Buffer.alloc(19); sof[0]=255; sof[1]=192; sof.writeUInt16BE(17,2); sof[4]=8; sof.writeUInt16BE(height,5); sof.writeUInt16BE(width,7); sof[9]=3;
  return Buffer.concat([Buffer.from([255,216]),app1,exif,sof,Buffer.from([255,218])]);
}

function chunk(name,data) {
  const header=Buffer.alloc(8);header.write(name);header.writeUInt32LE(data.length,4);
  return Buffer.concat([header,data,data.length%2?Buffer.alloc(1):Buffer.alloc(0)]);
}

function webp(width,height,kind='VP8X',orientation=1) {
  let data;
  if(kind==='VP8X') { data=Buffer.alloc(10);data.writeUIntLE(width-1,4,3);data.writeUIntLE(height-1,7,3); }
  else if(kind==='VP8L') { data=Buffer.alloc(5);data[0]=47;data.writeUInt32LE(((width-1)|((height-1)<<14))>>>0,1); }
  else { data=Buffer.alloc(10);data[3]=157;data[4]=1;data[5]=42;data.writeUInt16LE(width,6);data.writeUInt16LE(height,8); }
  const body=Buffer.concat([chunk(kind,data),...(orientation===1?[]:[chunk('EXIF',tiff(orientation))])]);
  const riff=Buffer.alloc(12);riff.write('RIFF');riff.writeUInt32LE(body.length+4,4);riff.write('WEBP',8);
  return Buffer.concat([riff,body]);
}

async function check(bytes,type,width,height,expectedPreview) {
  const h=harness();
  try {
    const blob=new Blob([bytes],{type});h.sizes.set(blob,{width,height});
    const asset=await h.library.add(blob);
    assert.equal(asset.width,width);assert.equal(asset.height,height);
    const image=imageStub();h.library.bind(image,asset);
    assert.equal(image.getAttribute('width'),String(width));assert.equal(image.getAttribute('height'),String(height));
    assert.equal(image.loading,'lazy');
    await h.library.previewQueue;
    assert.deepEqual(Buffer.from(await asset.original.arrayBuffer()),bytes);
    if(expectedPreview) {
      assert.equal(h.bitmapCalls.length,1);
      assert.equal(h.bitmapCalls[0].resizeWidth,expectedPreview[0]);assert.equal(h.bitmapCalls[0].resizeHeight,expectedPreview[1]);
    }
    h.library.bind(image,asset);
    assert.equal(image.getAttribute('width'),String(width));assert.equal(image.getAttribute('height'),String(height));
  } finally { h.release(); }
}

test('PNG reserves original dimensions immediately and does not upscale small images', async () => {
  await check(png(96,40),'image/png',96,40,[96,40]);
  await check(png(6000,9000),'image/png',6000,9000,[1000,1500]);
});

test('JPEG dimensions honor EXIF rotation without decoding a huge original twice', async () => {
  await check(jpeg(4096,2048,6),'image/jpeg',2048,4096,[800,1600]);
  await check(jpeg(96,40),'image/jpeg',96,40,[96,40]);
});

test('GIF dimensions preserve native animation without thumbnail decoding', async () => {
  const bytes=Buffer.alloc(13);bytes.write('GIF89a');bytes.writeUInt16LE(96,6);bytes.writeUInt16LE(40,8);
  const h=harness();
  try { const blob=new Blob([bytes],{type:'image/gif'});const asset=await h.library.add(blob);await h.library.previewQueue;assert.equal(asset.width,96);assert.equal(asset.height,40);assert.equal(h.bitmapCalls.length,0);assert.equal(asset.previewUrl,asset.originalUrl); }
  finally { h.release(); }
});

test('WebP VP8, VP8L, VP8X and rotated EXIF retain original dimensions', async () => {
  await check(webp(128,64,'VP8 '),'image/webp',128,64,[128,64]);
  await check(webp(300,200,'VP8L'),'image/webp',300,200,[300,200]);
  await check(webp(8000,6000),'image/webp',8000,6000,[1000,750]);
  await check(webp(4096,2048,'VP8X',8),'image/webp',2048,4096,[800,1600]);
});

test('BMP top-down and small explicit SVG sizes remain native-sized', async () => {
  const bmp=Buffer.alloc(54);bmp.write('BM');bmp.writeUInt32LE(40,14);bmp.writeInt32LE(96,18);bmp.writeInt32LE(-40,22);
  await check(bmp,'image/bmp',96,40,[96,40]);
  await check(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" stroke-width="999" width="24px" height="12"><rect width="24" height="12"/></svg>'),'image/svg+xml',24,12);
});

test('unknown formats use original bitmap metadata, not resized preview dimensions', async () => {
  const h=harness();
  try {
    const bytes=Buffer.from('not-a-known-header');const blob=new Blob([bytes],{type:'image/avif'});h.sizes.set(blob,{width:5000,height:6000});
    const asset=await h.library.add(blob);await h.library.previewQueue;
    assert.equal(h.bitmapCalls.length,1);assert.equal(h.bitmapCalls[0].resizeWidth,undefined);
    assert.equal(asset.width,5000);assert.equal(asset.height,6000);
    const image=imageStub();h.library.bind(image,asset);assert.equal(image.getAttribute('width'),'5000');assert.equal(image.getAttribute('height'),'6000');
    assert.deepEqual(Buffer.from(await asset.original.arrayBuffer()),bytes);
  } finally { h.release(); }
});
