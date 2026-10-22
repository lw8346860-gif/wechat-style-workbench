import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { createLinkHelper, fetchPublicResource, publicUrl, isPublicAddress, readArticle } from '../wechat-style-prototype/wechat-link-helper.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
function transport(replies, calls = []) {
  return (url, options, callback) => {
    calls.push({ url: url.href, options });
    const request = new EventEmitter();
    request.destroy = () => {};
    request.end = () => setImmediate(() => {
      const reply = replies.shift();
      const response = Readable.from(reply.chunks || [reply.body || Buffer.from('body')]);
      response.headers = reply.headers || {};
      response.statusCode = reply.status || 200;
      callback(response);
    });
    return request;
  };
}

test('blocks local, private, mapped and reserved addresses in literals and DNS', async () => {
  for (const value of ['127.0.0.1','10.1.2.3','172.31.2.3','192.168.0.1','169.254.169.254','0.0.0.0','100.100.100.100','::1','::ffff:127.0.0.1','fc00::1','2001:0db8::1','2002:7f00:1::']) assert.equal(isPublicAddress(value), false, value);
  for (const value of ['8.8.8.8','93.184.216.34','2606:4700:4700::1111']) assert.equal(isPublicAddress(value), true, value);
  for (const url of ['file:///etc/passwd','http://127.1','http://2130706433','http://[::ffff:7f00:1]','http://localhost','https://a.local','http://a.test:8000','https://user:pass@a.test']) assert.throws(() => publicUrl(url), url);
  await assert.rejects(fetchPublicResource('https://dns.test/', { lookup: async () => [{ address: '127.0.0.1', family: 4 }] }), /内网/);
});

test('revalidates redirect destinations and pins public DNS answers', async () => {
  const calls = [];
  await assert.rejects(fetchPublicResource('https://public.test/', { lookup: publicLookup, request: transport([{ status: 302, headers: { location: 'http://169.254.169.254/metadata' } }], calls) }), /内网/);
  assert.equal(calls.length, 1);
  const checked = await new Promise((resolve, reject) => calls[0].options.lookup('public.test', {}, (error, address, family) => error ? reject(error) : resolve({ address, family })));
  assert.deepEqual(checked, { address: '93.184.216.34', family: 4 });
});

test('limits decompressed body size and keeps original image bytes/referrer', async () => {
  const calls = [];
  const result = await fetchPublicResource('https://mmbiz.qpic.cn/test.png', { kind: 'image', lookup: publicLookup, request: transport([{ body: gzipSync(png), headers: { 'content-encoding': 'gzip' } }], calls) });
  assert.deepEqual(result.bytes, png);
  assert.equal(calls[0].options.headers.Referer, 'https://mp.weixin.qq.com/');
  await assert.rejects(fetchPublicResource('https://public.test/article', { lookup: publicLookup, request: transport([{ body: Buffer.alloc(8 * 1024 * 1024 + 1) }]) }), /过大/);
});

test('public article/image APIs preserve img and reject non-image responses', async () => {
  const html = '<html><head><meta property="og:title" content="完整图文"></head><body><article><p>正文</p><img data-src="/original.png" src="placeholder.gif"></article></body></html>';
  const fetchResource = async url => ({ bytes: url.endsWith('.png') ? png : Buffer.from(html), sourceUrl: url, contentType: url.endsWith('.png') ? 'application/octet-stream' : 'text/html; charset=utf-8' });
  const article = await readArticle('https://public.test/article', fetchResource);
  assert.equal(article.title, '完整图文');
  assert.match(article.html, /<img data-src/);
  const server = createLinkHelper({ fetchResource });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, url, extra = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...extra }, body: JSON.stringify({ url }) });
  try {
    const response = await post('/api/fetch-image', 'https://public.test/original.png');
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
    assert.equal((await post('/api/fetch-image', 'https://public.test/article')).status, 400);
    assert.equal((await post('/api/read-article', 'http://127.0.0.1')).status, 400);
    assert.equal((await post('/api/read-article', 'https://public.test/article', { Origin: 'https://unrelated.test' })).status, 403);
    const payload = await (await post('/api/read-article', 'https://public.test/article')).json();
    assert.match(payload.html, /original.png/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
