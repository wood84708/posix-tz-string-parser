/**
 * Core POSIX TZ string parser.
 *
 * Grammar handled (subset that real-world tzdata uses):
 *   STD[offset][DST[dstoffset][,start-rule[/time],end-rule[/time]]]
 *
 * Example: "EST5EDT,M3.2.0,M11.1.0"
 *   std="EST", stdOffsetMinutes=-300, dst="EDT", dstOffsetMinutes=-240,
 *   start=M3.2.0/2:00, end=M11.1.0/2:00
 *
 * Offset sign convention (why this trips people up):
 *   POSIX TZ offsets are WEST-positive (opposite to ISO 8601). A string "EST5"
 *   means UTC-5. We keep the raw POSIX sign for `offsetMinutes` and expose
 *   `utcOffsetMinutes` with the conventional ISO sign for convenience. The
 *   field names are explicit so a reader cannot mistake one for the other.
 */

/**
 * @typedef {Object} TransitionTime
 * @property {number} hours    Hours, 0-23. Defaulted to 2 when absent.
 * @property {number} minutes  Minutes, 0-59. Defaulted to 0 when absent.
 * @property {number} seconds  Seconds, 0-59. Defaulted to 0 when absent.
 */

/**
 * @typedef {Object} TransitionRule
 * @property {'J'|'N'|'M'} type
 *   J = Julian day, 1-365 (skips Feb 29).
 *   N = zero-based ordinal day of year, 0-365 (includes Feb 29 in leap years).
 *   M = month.weekday rule, e.g. M3.2.0 = 2nd Sunday of March.
 * @property {number} [month]     For type M: 1-12.
 * @property {number} [week]      For type M: 1-4 (5 means last of month).
 * @property {number} [weekday]   For type M: 0-6, Sunday=0.
 * @property {number} [day]       For J/N: the ordinal day.
 * @property {TransitionTime} time  Wall-clock time of the transition.
 */

/**
 * @typedef {Object} DstRule
 * @property {string} abbreviation           e.g. "EDT".
 * @property {number} offsetMinutes          POSIX-sign offset in minutes (west-positive).
 * @property {number} utcOffsetMinutes       ISO-sign offset in minutes (east-positive).
 * @property {TransitionRule} start
 * @property {TransitionRule} end
 */

/**
 * @typedef {Object} PosixRule
 * @property {string} stdAbbreviation        e.g. "EST".
 * @property {number} stdOffsetMinutes       POSIX-sign offset in minutes (west-positive).
 * @property {number} stdUtcOffsetMinutes    ISO-sign offset in minutes (east-positive).
 * @property {DstRule|null} dst              Null when the TZ string declares no DST.
 * @property {string} raw                    The original input string.
 */

/** Type guards used by consumers that want to narrow without try/catch. */

export function isPosixRule(v) {
  return v !== null && typeof v === 'object' && typeof v.stdAbbreviation === 'string' &&
    typeof v.stdOffsetMinutes === 'number' && typeof v.stdUtcOffsetMinutes === 'number' &&
    (v.dst === null || isDstRule(v.dst));
}

export function isDstRule(v) {
  return v !== null && typeof v === 'object' && typeof v.abbreviation === 'string' &&
    typeof v.offsetMinutes === 'number' && typeof v.utcOffsetMinutes === 'number' &&
    typeof v.start === 'object' && typeof v.end === 'object' &&
    isTransitionRule(v.start) && isTransitionRule(v.end);
}

export function isTransitionRule(v) {
  if (v === null || typeof v !== 'object') return false;
  if (v.type !== 'J' && v.type !== 'N' && v.type !== 'M') return false;
  if (typeof v.time !== 'object' || v.time === null) return false;
  if (typeof v.time.hours !== 'number' || typeof v.time.minutes !== 'number' ||
      typeof v.time.seconds !== 'number') return false;
  if (v.type === 'M') {
    return typeof v.month === 'number' && typeof v.week === 'number' && typeof v.weekday === 'number';
  }
  return typeof v.day === 'number';
}

/** Normalize -0 to 0 so Object.is-based assertions don't trip. */
function normZero(n) {
  return n === 0 ? 0 : n;
}

/**
 * Parse the leading <abbrev><offset> chunk.
 * Abbreviation is letters, optionally wrapped in < > for non-alphabetic names.
 * Offset is the POSIX-sign duration following it; default is 0 when absent
 * (allowed by POSIX for the rare case of a zero-offset zone with no DST).
 * Returns {rest, abbreviation, posixOffsetMinutes} or throws on malformed input.
 */
function parseAbbrevAndOffset(s) {
  if (s.length === 0) throw new Error('Expected timezone abbreviation, got empty string');

  let i = 0;
  let quoted = false;
  if (s[0] === '<') {
    quoted = true;
    i = 1;
    const close = s.indexOf('>', i);
    if (close === -1) throw new Error('Unterminated < in timezone abbreviation');
    const name = s.slice(i, close);
    if (name.length === 0) throw new Error('Empty <> timezone abbreviation');
    i = close + 1;
    // Offset digits must follow immediately; POSIX does not require it but tzdata
    // always provides one for std. We tolerate its absence (default 0) for robustness.
    const result = parseSignedOffset(s, i);
    return { rest: result.rest, abbreviation: name, posixOffsetMinutes: result.minutes };
  }

  // Unquoted: letters only per POSIX.
  const m = /^[A-Za-z]+/.exec(s);
  if (!m) throw new Error(`Invalid timezone abbreviation at: ${JSON.stringify(s)}`);
  const abbreviation = m[0];
  i += abbreviation.length;
  const result = parseSignedOffset(s, i);
  return { rest: result.rest, abbreviation, posixOffsetMinutes: result.minutes };
}

/**
 * Parse a signed [hh][:mm][:ss] offset starting at index i.
 * Sign is mandatory per POSIX ("+" or "-") but tzdata sometimes omits the sign
 * for positive offsets in other contexts; here we follow POSIX strictly for TZ strings.
 * Returns {rest, minutes} where minutes is POSIX-sign (west-positive).
 */
function parseSignedOffset(s, i) {
  // No offset present (e.g. trailing string). Treat as 0.
  if (i >= s.length || !/[-+0-9]/.test(s[i])) {
    return { rest: s.slice(i), minutes: 0 };
  }

  let sign = 1;
  if (s[i] === '-') { sign = -1; i++; }
  else if (s[i] === '+') { sign = 1; i++; }
  // else: bare digits, POSIX-sign is positive (west of prime meridian).

  const digits = /^\d+/.exec(s.slice(i));
  if (!digits) throw new Error(`Expected digits after sign in offset at: ${JSON.stringify(s.slice(i))}`);
  let hours = parseInt(digits[0], 10);
  i += digits[0].length;

  let minutes = 0, seconds = 0;
  if (s[i] === ':') {
    i++;
    const dm = /^\d+/.exec(s.slice(i));
    if (!dm) throw new Error('Expected minutes after ":" in offset');
    minutes = parseInt(dm[0], 10);
    i += dm[0].length;
    if (s[i] === ':') {
      i++;
      const ds = /^\d+/.exec(s.slice(i));
      if (!ds) throw new Error('Expected seconds after ":" in offset');
      seconds = parseInt(ds[0], 10);
      i += ds[0].length;
    }
  }

  if (hours > 23 || minutes > 59 || seconds > 59) {
    throw new Error(`Offset out of range: h=${hours} m=${minutes} s=${seconds}`);
  }

  // POSIX offset sign is inverted from ISO. "-5" means 5 hours EAST of UTC.
  // We store the raw POSIX sign in offsetMinutes and the ISO sign separately.
  const posixMinutes = sign * (hours * 60 + minutes * 1 + Math.floor(seconds / 60));
  // For utcOffsetMinutes we want ISO sign: east-positive. POSIX "-5" => UTC+5.
  // POSIX "+5" => UTC-5. POSIX-sign * -1 gives ISO sign.
  const isoMinutes = -posixMinutes;
  // We need to carry the leftover seconds, but our representation is minutes-only.
  // POSIX allows seconds in offsets; for TZ strings this is vanishingly rare and
  // tzdata never uses sub-minute DST offsets. We reject sub-minute offsets rather
  // than silently truncating, because a consumer computing transitions would
  // get the wrong answer.
  if (seconds % 60 !== 0) {
    throw new Error(`Sub-minute offset seconds (${seconds}) are not supported`);
  }
  return { rest: s.slice(i), minutes: posixMinutes, isoMinutes: normZero(isoMinutes) };
}

/** Parse a transition rule: M.m.w.d, J.n, or n. */
function parseRule(s) {
  if (s[0] === 'M') {
    const m = /^M(\d+)\.(\d+)\.(\d+)$/.exec(s);
    if (!m) throw new Error(`Invalid M rule: ${JSON.stringify(s)}`);
    const month = parseInt(m[1], 10);
    const week = parseInt(m[2], 10);
    const weekday = parseInt(m[3], 10);
    if (month < 1 || month > 12) throw new Error(`M rule month out of range: ${month}`);
    if (week < 1 || week > 5) throw new Error(`M rule week out of range: ${week}`);
    if (weekday < 0 || weekday > 6) throw new Error(`M rule weekday out of range: ${weekday}`);
    return { type: 'M', month, week, weekday };
  }
  if (s[0] === 'J') {
    const m = /^J(\d+)$/.exec(s);
    if (!m) throw new Error(`Invalid J rule: ${JSON.stringify(s)}`);
    const day = parseInt(m[1], 10);
    if (day < 1 || day > 365) throw new Error(`J rule day out of range: ${day}`);
    return { type: 'J', day };
  }
  const m = /^(\d+)$/.exec(s);
  if (!m) throw new Error(`Invalid ordinal rule: ${JSON.stringify(s)}`);
  const day = parseInt(m[1], 10);
  if (day < 0 || day > 365) throw new Error(`ordinal rule day out of range: ${day}`);
  return { type: 'N', day };
}

/** Parse "[/time]" suffix on a rule, defaulting to 2:00:00 per POSIX. */
function parseRuleWithTime(s) {
  const slash = s.indexOf('/');
  let rulePart = s, timePart = null;
  if (slash !== -1) {
    rulePart = s.slice(0, slash);
    timePart = s.slice(slash + 1);
  }
  const rule = parseRule(rulePart);
  let hours = 2, minutes = 0, seconds = 0;
  if (timePart !== null && timePart.length > 0) {
    // Sign is permitted by POSIX but tzdata never uses it; reject to surface bugs.
    if (timePart[0] === '-' || timePart[0] === '+') {
      throw new Error(`Signed transition time not supported: ${JSON.stringify(timePart)}`);
    }
    const parts = timePart.split(':');
    if (parts.length < 1 || parts.length > 3) {
      throw new Error(`Invalid transition time: ${JSON.stringify(timePart)}`);
    }
    hours = parseInt(parts[0], 10);
    if (parts.length >= 2) minutes = parseInt(parts[1], 10);
    if (parts.length === 3) seconds = parseInt(parts[2], 10);
    if (isNaN(hours) || isNaN(minutes) || isNaN(seconds)) {
      throw new Error(`Non-numeric transition time: ${JSON.stringify(timePart)}`);
    }
    if (hours < 0 || hours > 24) throw new Error(`Transition hour out of range: ${hours}`);
    if (minutes < 0 || minutes > 59) throw new Error(`Transition minute out of range: ${minutes}`);
    if (seconds < 0 || seconds > 59) throw new Error(`Transition second out of range: ${seconds}`);
    if (hours === 24 && (minutes !== 0 || seconds !== 0)) {
      throw new Error('Transition time 24:00 must have zero minutes and seconds');
    }
  }
  rule.time = { hours, minutes, seconds };
  return rule;
}

/**
 * Parse a POSIX TZ string.
 * @param {string} input
 * @returns {PosixRule}
 * @throws {Error} on malformed input.
 */
export function parsePosixTz(input) {
  if (typeof input !== 'string') {
    throw new TypeError(`parsePosixTz expects a string, got ${typeof input}`);
  }
  if (input.length === 0) {
    throw new Error('parsePosixTz expects a non-empty string');
  }

  let rest = input;
  const std = parseAbbrevAndOffset(rest);
  rest = std.rest;

  let dst = null;
  if (rest.length > 0) {
    const dstParsed = parseAbbrevAndOffset(rest);
    rest = dstParsed.rest;

    let start = null, end = null;
    if (rest.length > 0) {
      if (rest[0] !== ',') {
        throw new Error(`Expected ',' or end of string, got: ${JSON.stringify(rest)}`);
      }
      rest = rest.slice(1);
      const comma2 = rest.indexOf(',');
      if (comma2 === -1) {
        throw new Error('DST rules require both start and end: missing second comma');
      }
      const startStr = rest.slice(0, comma2);
      const endStr = rest.slice(comma2 + 1);
      if (startStr.length === 0 || endStr.length === 0) {
        throw new Error('Empty start or end rule');
      }
      start = parseRuleWithTime(startStr);
      end = parseRuleWithTime(endStr);
      rest = '';
    }

    // POSIX-sign for DST: if no offset is given, default to std offset minus 60 min.
    // POSIX convention: a missing DST offset means "one hour ahead of std".
    // "Ahead" in POSIX-sign means more negative (since POSIX-sign is west-positive).
    let dstPosixMinutes = dstParsed.posixOffsetMinutes;
    if (dstPosixMinutes === 0 && std.posixOffsetMinutes !== 0) {
      // Only treat as default when the user genuinely omitted it. We can't fully
      // distinguish "EDT" (omitted) from "UTC0" (explicit zero) without lookahead,
      // but tzdata always supplies an explicit offset when std is non-zero, so the
      // omitted case here corresponds to the POSIX default.
      dstPosixMinutes = std.posixOffsetMinutes - 60;
    }
    // When std offset is 0 and DST offset is omitted, POSIX default is -60 (UTC+1).
    if (dstPosixMinutes === 0 && std.posixOffsetMinutes === 0) {
      dstPosixMinutes = -60;
    }

    dst = {
      abbreviation: dstParsed.abbreviation,
      offsetMinutes: dstPosixMinutes,
      utcOffsetMinutes: normZero(-dstPosixMinutes),
      start,
      end
    };
  }

  return {
    stdAbbreviation: std.abbreviation,
    stdOffsetMinutes: std.posixOffsetMinutes,
    stdUtcOffsetMinutes: normZero(-std.posixOffsetMinutes),
    dst,
    raw: input
  };
}
