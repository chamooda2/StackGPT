import assert from 'node:assert/strict';
import { test } from 'node:test';
import { genAttempts, merge, type Attempt } from '../src/evidence.ts';

const tally = (a: Attempt[]) => ({
  worked: a.filter(x => x.outcome === 'worked').length,
  partial: a.filter(x => x.outcome === 'partial').length,
  failed: a.filter(x => x.outcome === 'failed').length,
});

test('same key gives identical attempts', () => {
  const a = genAttempts('s1', { profile: 'verified' }, {}, 1000, 40);
  const b = genAttempts('s1', { profile: 'verified' }, {}, 1000, 40);
  assert.deepEqual(a, b);
});

test('verified: 19 worked, 1 partial, distinct users, recent', () => {
  const a = genAttempts('s2', { profile: 'verified' }, { os: 'windows' }, 1000, 40);
  assert.deepEqual(tally(a), { worked: 19, partial: 1, failed: 0 });
  assert.equal(new Set(a.map(x => x.user)).size, 20);
  assert.ok(a.every(x => x.daysAgo >= 3 && x.daysAgo <= 180 && x.env.os === 'windows'));
});

test('days are clamped to solution age', () => {
  const a = genAttempts('s3', { profile: 'verified' }, {}, 30, 40);
  assert.ok(a.every(x => x.daysAgo >= 3 && x.daysAgo <= 29));
});

test('conflicting: outcomes split by env segment', () => {
  const ev = { profile: 'conflicting' as const, works: { device: 'S24' }, fails: { device: 'A14' } };
  const a = genAttempts('s4', ev, { os: 'android' }, 1000, 40);
  assert.deepEqual(tally(a.filter(x => x.env.device === 'S24')), { worked: 9, partial: 0, failed: 1 });
  assert.deepEqual(tally(a.filter(x => x.env.device === 'A14')), { worked: 1, partial: 1, failed: 8 });
  assert.ok(a.every(x => x.env.os === 'android'));
});

test('outdated: old successes, recent failures', () => {
  const a = genAttempts('s5', { profile: 'outdated' }, {}, 2000, 40);
  const recent = a.filter(x => x.daysAgo <= 90);
  assert.deepEqual(tally(recent), { worked: 0, partial: 1, failed: 6 });
  assert.ok(a.filter(x => x.outcome === 'worked').every(x => x.daysAgo >= 400));
});

test('outdated on a young solution throws', () => {
  assert.throws(() => genAttempts('s6', { profile: 'outdated' }, {}, 200, 40), /needs attempts 400d ago/);
});

test('conflicting without envs throws', () => {
  assert.throws(() => genAttempts('s7', { profile: 'conflicting' }, {}, 1000, 40), /works and fails/);
});

test('pool too small throws', () => {
  assert.throws(() => genAttempts('s8', { profile: 'verified' }, {}, 1000, 10), /pool has 10/);
});

test('merge is one level deep for nested objects', () => {
  assert.deepEqual(merge({ os: 'linux', pkg: { numpy: '1.26', pandas: '2.2' } }, { pkg: { numpy: '2.0' } }), {
    os: 'linux',
    pkg: { numpy: '2.0', pandas: '2.2' },
  });
});
