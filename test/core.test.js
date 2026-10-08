import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parsePosixTz,
  isPosixRule,
  isDstRule,
  isTransitionRule
} from '../src/index.js';

test('parses a basic std-only TZ string', () => {
  const r = parsePosixTz('UTC0');
  assert.equal(r.stdAbbreviation, 'UTC');
  assert.equal(r.stdOffsetMinutes, 0);
  assert.equal(r.stdUtcOffsetMinutes, 0);
  assert.equal(r.dst, null);
  assert.equal(r.raw, 'UTC0');
});

test('parses EST5EDT with full M rules and default transition times', () => {
  const r = parsePosixTz('EST5EDT,M3.2.0,M11.1.0');
  assert.equal(r.stdAbbreviation, 'EST');
  assert.equal(r.stdOffsetMinutes, 5 * 60);   // POSIX-sign: west-positive
  assert.equal(r.stdUtcOffsetMinutes, -5 * 60); // ISO-sign
  assert.equal(r.dst.abbreviation, 'EDT');
  assert.equal(r.dst.offsetMinutes, 4 * 60);   // defaulted: std(5*60) - 60min = 4*60
  assert.equal(r.dst.utcOffsetMinutes, -4 * 60);
  assert.equal(r.dst.start.type, 'M');
  assert.equal(r.dst.start.month, 3);
  assert.equal(r.dst.start.week, 2);
  assert.equal(r.dst.start.weekday, 0);
  assert.equal(r.dst.start.time.hours, 2);
  assert.equal(r.dst.start.time.minutes, 0);
  assert.equal(r.dst.start.time.seconds, 0);
  assert.equal(r.dst.end.type, 'M');
  assert.equal(r.dst.end.month, 11);
  assert.equal(r.dst.end.week, 1);
});

test('parses an explicit DST offset and explicit transition times', () => {
  const r = parsePosixTz('NST3:30NDT2:30,M3.2.0/2:00,M11.1.0/2:00');
  assert.equal(r.stdAbbreviation, 'NST');
  assert.equal(r.stdOffsetMinutes, 3 * 60 + 30);
  assert.equal(r.stdUtcOffsetMinutes, -(3 * 60 + 30));
  assert.equal(r.dst.abbreviation, 'NDT');
  assert.equal(r.dst.offsetMinutes, 2 * 60 + 30);
  assert.equal(r.dst.utcOffsetMinutes, -(2 * 60 + 30));
  assert.equal(r.dst.start.time.hours, 2);
  assert.equal(r.dst.end.time.hours, 2);
});

test('parses a negative std offset (east of UTC) with sign', () => {
  // POSIX "-8" means UTC+8. Used for Asia/Singapore-style zones in tzdata history.
  const r = parsePosixTz('<+08>-8');
  assert.equal(r.stdAbbreviation, '+08');
  assert.equal(r.stdOffsetMinutes, -8 * 60);
  assert.equal(r.stdUtcOffsetMinutes, 8 * 60);
});

test('parses Julian (J) and ordinal (N) rules', () => {
  const r = parsePosixTz('EST5EDT,J60,J365');
  assert.equal(r.dst.start.type, 'J');
  assert.equal(r.dst.start.day, 60);
  assert.equal(r.dst.end.type, 'J');
  assert.equal(r.dst.end.day, 365);
});

test('parses ordinal (zero-based N) rules including day 0', () => {
  const r = parsePosixTz('EST5EDT,0,365');
  assert.equal(r.dst.start.type, 'N');
  assert.equal(r.dst.start.day, 0);
  assert.equal(r.dst.end.type, 'N');
  assert.equal(r.dst.end.day, 365);
});

test('parses M week=5 meaning "last of month"', () => {
  const r = parsePosixTz('EST5EDT,M10.5.0,M3.5.0');
  assert.equal(r.dst.start.month, 10);
  assert.equal(r.dst.start.week, 5);
  assert.equal(r.dst.start.weekday, 0);
});

test('parses transition time with seconds', () => {
  const r = parsePosixTz('EST5EDT,M3.2.0/2:30:15,M11.1.0/2:00');
  assert.equal(r.dst.start.time.hours, 2);
  assert.equal(r.dst.start.time.minutes, 30);
  assert.equal(r.dst.start.time.seconds, 15);
});

test('type guards accept a valid rule and reject junk', () => {
  const r = parsePosixTz('EST5EDT,M3.2.0,M11.1.0');
  assert.equal(isPosixRule(r), true);
  assert.equal(isDstRule(r.dst), true);
  assert.equal(isTransitionRule(r.dst.start), true);
  assert.equal(isPosixRule({}), false);
  assert.equal(isDstRule(null), false);
  assert.equal(isTransitionRule({ type: 'X' }), false);
});

test('throws on empty input', () => {
  assert.throws(() => parsePosixTz(''), /non-empty/);
});

test('throws on non-string input', () => {
  assert.throws(() => parsePosixTz(42), TypeError);
});

test('throws on unterminated quoted abbreviation', () => {
  assert.throws(() => parsePosixTz('<+08-8'), /Unterminated/);
});

test('throws on missing second rule after comma', () => {
  assert.throws(() => parsePosixTz('EST5EDT,M3.2.0'), /missing second comma/);
});

test('throws on out-of-range M weekday', () => {
  assert.throws(() => parsePosixTz('EST5EDT,M3.2.7,M11.1.0'), /weekday out of range/);
});

test('throws on sub-minute offset seconds', () => {
  assert.throws(() => parsePosixTz('EST5:0:30EDT,M3.2.0,M11.1.0'), /Sub-minute/);
});
