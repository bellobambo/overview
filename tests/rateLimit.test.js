const test = require('node:test');
const assert = require('node:assert/strict');
const { rateLimit } = require('../dist/middleware/rateLimit');

function response() {
  return {
    headers: {},
    statusCode: 200,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('rate limiter allows up to the limit and returns 429 after it', () => {
  const limit = rateLimit({ name: 'test', windowMs: 60_000, max: 2 });
  const req = { ip: '192.0.2.1', socket: {} };
  const first = response();
  const second = response();
  const third = response();
  let passed = 0;
  limit(req, first, () => passed++);
  limit(req, second, () => passed++);
  limit(req, third, () => passed++);
  assert.equal(passed, 2);
  assert.equal(third.statusCode, 429);
  assert.ok(Number(third.headers['Retry-After']) > 0);
});

test('rate limiter separates identities', () => {
  const limit = rateLimit({ name: 'identities', windowMs: 60_000, max: 1 });
  let passed = 0;
  limit({ ip: '192.0.2.1', socket: {} }, response(), () => passed++);
  limit({ ip: '192.0.2.2', socket: {} }, response(), () => passed++);
  assert.equal(passed, 2);
});
