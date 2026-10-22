#!/usr/bin/env node

import http from 'node:http';
import https from 'node:https';
import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { pathToFileURL } from 'node:url';
import { createBrotliDecompress, createUnzip } from 'node:zlib';

export const HELPER_VERSION = 2;
const PORT = 4318;
const MAX_BODY_BYTES = 16 * 1024;
const MAX_ARTICLE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_BYTES = 40 * 1024 * 1024;
const blocked = new BlockList();
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
blocked.addSubnet('2001::', 32, 'ipv6');
blocked.addSubnet('2001:db8::', 32, 'ipv6');
blocked.addSubnet('2002::', 16, 'ipv6');
for (const [address, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]]) blocked.addSubnet(address, prefix, 'ipv4');

export function isPublicAddress(value) {
  const family = isIP(value);
  if (family === 4) return !blocked.check(value, 'ipv4');
  // Only ordinary IPv6 global unicast; exclude tunnel and documentation ranges.
  if (family === 6) return globalV6.check(value, 'ipv6') && !blocked.check(value, 'ipv6');
  return false;
}

export function publicUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('请输入完整的公开网页链接'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || (url.port && !['80','443'].includes(url.port))) throw new Error('仅支持普通 HTTP / HTTPS 公开链接');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (hostname === 'localhost' || /\.(?:localhost|local|internal)$/i.test(hostname) || (isIP(hostname) && !isPublicAddress(hostname))) throw new Error('不能读取本机或内网地址');
  url.hash = '';
  return url;
}

function corsHeaders(contentType = 'application/json; charset=utf-8') {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Private-Network': 'true',
    'Vary': 'Origin, Access-Control-Request-Private-Network',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Type': contentType
  };
}

function sendJson(response, status, payload) {
  if (response.destroyed || response.headersSent) return;
  response.writeHead(status, corsHeaders());
  response.end(JSON.stringify(payload));
}

// Check every DNS answer and redirect, then pin requests to a checked address.
export async function fetchPublicResource(value, { kind = 'article', referrer = '', redirects = 0, lookup = dnsLookup, request = null } = {}) {
  if (redirects > 5) throw new Error('网页重定向次数过多');
  const url = publicUrl(value);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  let dnsTimer;
  let addresses;
  try {
    addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await Promise.race([
      lookup(hostname, { all: true, verbatim: true }),
      new Promise((_, reject) => { dnsTimer = setTimeout(() => reject(new Error('域名解析超时')), 7000); })
    ]);
  } finally { clearTimeout(dnsTimer); }
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw new Error('不能读取本机或内网地址');
  const address = addresses.find(item => item.family === 4) || addresses[0];
  const headers = {
    'Accept': kind === 'image' ? 'image/avif,image/webp,image/*,*/*;q=0.8' : 'text/html,application/xhtml+xml',
    'Accept-Encoding': 'identity',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36'
  };
  if (kind === 'image') {
    let parent;
    try { parent = publicUrl(referrer); } catch { /* Fall back to the image origin. */ }
    headers.Referer = /(^|\.)qpic\.cn$|(^|\.)qlogo\.cn$/i.test(hostname) ? 'https://mp.weixin.qq.com/' : (parent?.href || `${url.origin}/`);
  }
  const limit = kind === 'image' ? MAX_IMAGE_BYTES : MAX_ARTICLE_BYTES;
  const transport = request || (url.protocol === 'https:' ? https.request : http.request);
  const result = await new Promise((resolve, reject) => {
    let settled = false;
    let incoming, stream, outbound;
    const fail = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      incoming?.destroy();
      stream?.destroy();
      outbound?.destroy();
      reject(error);
    };
    const timer = setTimeout(() => fail(new Error('读取超时，请稍后重试')), kind === 'image' ? 20000 : 25000);
    outbound = transport(url, {
      method: 'GET', headers,
      lookup: (_name, options, callback) => options?.all ? callback(null, [address]) : callback(null, address.address, address.family)
    }, response => {
      incoming = response;
      const status = response.statusCode || 500;
      if ([301,302,303,307,308].includes(status) && response.headers.location) {
        response.resume();
        settled = true;
        clearTimeout(timer);
        resolve({ redirect: new URL(response.headers.location, url).href });
        return;
      }
      if (status < 200 || status >= 300) { fail(new Error(`源站读取失败（${status}）`)); return; }
      const encoding = response.headers['content-encoding'];
      stream = /^(gzip|deflate)$/i.test(encoding || '') ? response.pipe(createUnzip()) : /^br$/i.test(encoding || '') ? response.pipe(createBrotliDecompress()) : response;
      const chunks = [];
      let size = 0;
      stream.on('data', chunk => {
        size += chunk.length;
        if (size > limit) { fail(new Error(kind === 'image' ? '单张图片超过 40MB，请单独保存后补入' : '网页内容过大，请复制正文后粘贴')); return; }
        chunks.push(chunk);
      });
      stream.on('error', fail);
      response.on('error', fail);
      response.on('aborted', () => fail(new Error('源站中断了读取，请重试')));
      stream.on('end', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ bytes: Buffer.concat(chunks), contentType: response.headers['content-type'] || '', sourceUrl: url.href });
      });
    });
    outbound.on('error', fail);
    outbound.end();
  });
  if (result.redirect) return fetchPublicResource(result.redirect, { kind, referrer, redirects: redirects + 1, lookup, request });
  return result;
}

export function imageContentType(bytes) {
  if (bytes.length < 12) return '';
  if (bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (/^GIF8[79]a/.test(bytes.subarray(0,6).toString())) return 'image/gif';
  if (bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP') return 'image/webp';
  if (bytes.subarray(4,8).toString() === 'ftyp' && /avif|avis/.test(bytes.subarray(8,128).toString())) return 'image/avif';
  if (bytes.subarray(0,2).toString() === 'BM') return 'image/bmp';
  if (/^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE\s+svg\b[^>]*>\s*)?<svg[\s>]/i.test(bytes.subarray(0,4096).toString('utf8'))) return 'image/svg+xml';
  return '';
}

function decodeTitle(value = '') {
  return value.replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
}

function extractMetaContent(html, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const first = new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, 'i');
  const second = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, 'i');
  return decodeTitle(first.exec(html)?.[1] || second.exec(html)?.[1] || '');
}

export async function readArticle(source, fetchResource = fetchPublicResource) {
  const result = await fetchResource(source, { kind: 'article' });
  if (imageContentType(result.bytes)) return { imageUrl: result.sourceUrl, sourceUrl: result.sourceUrl, title: '' };
  if (!/text\/(?:html|plain)|application\/xhtml\+xml/i.test(result.contentType)) throw new Error('这个链接不是可读取的文章网页');
  const charset = /charset\s*=\s*["']?([\w-]+)/i.exec(result.contentType)?.[1] || /<meta\b[^>]*charset\s*=\s*["']?([\w-]+)/i.exec(result.bytes.subarray(0,4096).toString())?.[1] || 'utf-8';
  let html;
  try { html = new TextDecoder(charset).decode(result.bytes); } catch { html = result.bytes.toString('utf8'); }
  if (new URL(result.sourceUrl).hostname === 'mp.weixin.qq.com' && !/\bid\s*=\s*["']js_content["']/i.test(html)) throw new Error('微信返回了验证页或文章已失效，请在浏览器打开后复制正文粘贴');
  const title = extractMetaContent(html, 'og:title') || extractMetaContent(html, 'twitter:title') || decodeTitle(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '');
  // Keep images. The browser extracts and sanitizes the detached article.
  return { html, title, sourceUrl: result.sourceUrl };
}

async function readRequestJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('请求内容过大');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

export function createLinkHelper({ fetchResource = fetchPublicResource } = {}) {
  let active = 0;
  const server = http.createServer(async (request, response) => {
    const origin = request.headers.origin;
    if (origin && origin !== 'null' && !/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin) && !['https://mp.togma.online','https://lw8346860-gif.github.io'].includes(origin)) {
      response.writeHead(403); response.end('Origin not allowed'); return;
    }
    if (request.method === 'OPTIONS') { response.writeHead(204, corsHeaders()); response.end(); return; }
    if (request.method === 'GET' && ['/health','/api/health'].includes(request.url)) { sendJson(response, 200, { ok: true, service: 'wechat-style-link-helper', version: HELPER_VERSION }); return; }
    if (request.method !== 'POST' || !['/api/read-article','/api/learn-wechat-style','/api/fetch-image'].includes(request.url)) { sendJson(response, 404, { error: 'Not found' }); return; }
    if (active >= 6) { request.resume(); sendJson(response, 429, { error: '图片读取繁忙，请稍后重试补图' }); return; }
    active++;
    let jobFinished = false, responseFinished = false, released = false;
    const release = () => { if (jobFinished && responseFinished && !released) { released = true; active--; } };
    response.once('close', () => { responseFinished = true; release(); });
    try {
      const payload = await readRequestJson(request);
      publicUrl(String(payload.url || ''));
      if (request.url === '/api/fetch-image') {
        const result = await fetchResource(payload.url, { kind: 'image', referrer: String(payload.referrer || '') });
        const type = imageContentType(result.bytes);
        if (!type) throw new Error('源站没有返回有效图片，可能需要登录或验证');
        response.writeHead(200, { ...corsHeaders(type), 'Content-Length': result.bytes.length });
        response.end(result.bytes);
      } else sendJson(response, 200, await readArticle(payload.url, fetchResource));
    } catch (error) {
      sendJson(response, 400, { error: error.message || '读取失败' });
    } finally { jobFinished = true; release(); }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--self-test')) {
    if (isPublicAddress('127.0.0.1') || isPublicAddress('::1') || !isPublicAddress('8.8.8.8')) throw new Error('地址检查自检失败');
    console.log('wechat-link-helper self-test passed');
  } else createLinkHelper().listen(PORT, '127.0.0.1', () => console.log(`WeChat article/image helper v${HELPER_VERSION} listening on http://127.0.0.1:${PORT}`));
}
