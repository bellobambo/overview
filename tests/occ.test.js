const test = require('node:test');
const assert = require('node:assert/strict');

function validateOccVersion(clientVersion, dbVersion) {
  const currentDbVersion = dbVersion ?? 0;
  if (clientVersion !== undefined && clientVersion !== null) {
    if (!Number.isInteger(clientVersion) || clientVersion < 0) {
      return { valid: false, status: 400, error: 'submission_version must be a non-negative integer.' };
    }
    if (clientVersion !== currentDbVersion) {
      return { 
        valid: false, 
        status: 409, 
        error: 'Conflict detected', 
        details: { server_version: currentDbVersion, client_version: clientVersion } 
      };
    }
  }
  return { valid: true, nextVersion: currentDbVersion + 1 };
}

test('OCC: matching client and DB versions increment properly', () => {
  const result = validateOccVersion(0, 0);
  assert.equal(result.valid, true);
  assert.equal(result.nextVersion, 1);

  const result5 = validateOccVersion(5, 5);
  assert.equal(result5.valid, true);
  assert.equal(result5.nextVersion, 6);
});

test('OCC: optional/omitted client version defaults to DB version', () => {
  const result = validateOccVersion(undefined, 3);
  assert.equal(result.valid, true);
  assert.equal(result.nextVersion, 4);

  const resultNull = validateOccVersion(null, 3);
  assert.equal(resultNull.valid, true);
  assert.equal(resultNull.nextVersion, 4);
});

test('OCC: mismatched version triggers 409 Conflict', () => {
  const result = validateOccVersion(1, 2);
  assert.equal(result.valid, false);
  assert.equal(result.status, 409);
  assert.deepEqual(result.details, { server_version: 2, client_version: 1 });
});

test('OCC: negative or non-integer version triggers 400 Bad Request', () => {
  const resultNeg = validateOccVersion(-1, 0);
  assert.equal(resultNeg.valid, false);
  assert.equal(resultNeg.status, 400);

  const resultFloat = validateOccVersion(1.5, 0);
  assert.equal(resultFloat.valid, false);
  assert.equal(resultFloat.status, 400);
});
