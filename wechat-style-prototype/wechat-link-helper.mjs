#!/usr/bin/env node

import http from 'node:http';

const PORT = 4318;
const MAX_BODY_BYTES = 16 * 1024;
const MAX_ARTICLE_BYTES = 4 * 1024 * 1024;

function corsHeaders(contentType = 'application/json; charset=utf-8') {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Private-Network': 'true',
    'Vary': 'Origin, Access-Control-Request-Private-Network',
    'Cache-Control': 'no-store',
    'Content-Type': contentType
  };
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, corsHeaders());
  response.end(JSON.stringify(payload));
}

function decodeTitle(value = '') {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractMetaContent(html, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const propertyFirst = new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, 'i');
  const contentFirst = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, 'i');
  return decodeTitle(propertyFirst.exec(html)?.[1] || contentFirst.exec(html)?.[1] || '');
}

function extractElementInnerHtml(html, id) {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const openingPattern = new RegExp(`<([a-z][\\w:-]*)\\b(?=[^>]*\\bid\\s*=\\s*["']${escapedId}["'])[^>]*>`, 'i');
  const opening = openingPattern.exec(html);
  if (!opening) return '';

  const tagName = opening[1];
  const tagPattern = new RegExp(`<\\/?${tagName}\\b[^>]*>`, 'gi');
  tagPattern.lastIndex = opening.index;
  let depth = 0;
  let token;
  while ((token = tagPattern.exec(html))) {
    const isClosing = /^<\//.test(token[0]);
    const isSelfClosing = /\/>$/.test(token[0]);
    if (isClosing) depth -= 1;
    else if (!isSelfClosing) depth += 1;
    if (depth === 0) {
      const contentStart = opening.index + opening[0].length;
      return html.slice(contentStart, token.index);
    }
  }
  return '';
}

function sanitizeArticleHtml(value) {
  return value
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|iframe|object|embed|form|input|button)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(script|style|noscript|iframe|object|embed|form|input|button)\b[^>]*\/?>/gi, '')
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+(?:id|contenteditable)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+href\s*=\s*(["'])\s*javascript:[\s\S]*?\1/gi, '')
    .trim();
}

function validateWechatUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'mp.weixin.qq.com') {
    throw new Error('仅支持 https://mp.weixin.qq.com 的已发布公开文章');
  }
  return url;
}

async function fetchWechatArticle(sourceUrl) {
  const url = validateWechatUrl(sourceUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let response;
  try {
    response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36'
      }
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new Error(`微信文章读取失败（${response.status}）`);
  const finalUrl = validateWechatUrl(response.url);
  const html = await response.text();
  if (Buffer.byteLength(html) > MAX_ARTICLE_BYTES) throw new Error('文章页面过大，暂时无法读取');

  const article = extractElementInnerHtml(html, 'js_content') || extractElementInnerHtml(html, 'page-content');
  if (!article) throw new Error('没有找到公开文章正文，链接可能已失效或需要验证');
  const cleanHtml = sanitizeArticleHtml(article);
  if (!cleanHtml) throw new Error('文章正文为空');
  const title = extractMetaContent(html, 'og:title') || extractMetaContent(html, 'twitter:title');
  return { html: cleanHtml, title, sourceUrl: finalUrl.toString() };
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

function selfTest() {
  const sample = '<html><head><meta property="og:title" content="测试文章"></head><body><div id="js_content"><section style="font-size:16px"><p>正文</p><div><p>嵌套</p></div></section></div></body></html>';
  const article = sanitizeArticleHtml(extractElementInnerHtml(sample, 'js_content'));
  if (!article.includes('font-size:16px') || !article.includes('嵌套')) throw new Error('文章正文提取自检失败');
  if (extractMetaContent(sample, 'og:title') !== '测试文章') throw new Error('文章标题提取自检失败');
  console.log('wechat-link-helper self-test passed');
}

if (process.argv.includes('--self-test')) {
  selfTest();
  process.exit(0);
}

const server = http.createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, corsHeaders());
    response.end();
    return;
  }
  if (request.method === 'GET' && request.url === '/health') {
    sendJson(response, 200, { ok: true, service: 'wechat-style-link-helper' });
    return;
  }
  if (request.method !== 'POST' || request.url !== '/api/learn-wechat-style') {
    sendJson(response, 404, { error: 'Not found' });
    return;
  }

  try {
    const payload = await readRequestJson(request);
    const result = await fetchWechatArticle(String(payload.url || ''));
    sendJson(response, 200, result);
  } catch (error) {
    const message = error?.name === 'AbortError' ? '读取超时，请稍后重试' : error.message;
    sendJson(response, 400, { error: message || '读取失败' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`WeChat style link helper listening on http://127.0.0.1:${PORT}`);
});
