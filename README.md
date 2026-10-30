# posix-tz-parse

Parses POSIX timezone specification strings like `EST5EDT,M3.2.0,M11.1.0` into a structured object describing the standard and DST abbreviations, offsets, and transition rules. Does not compute transition datetimes for a given year — it gives you the rule shape so you can.

```js
import { parsePosixTz } from './src/index.js';

const rule = parsePosixTz('EST5EDT,M3.2.0,M11.1.0');
// {
//   stdAbbreviation: 'EST',
//   stdOffsetMinutes: 300,        // POSIX-sign (west-positive)
//   stdUtcOffsetMinutes: -300,     // ISO-sign (east-positive)
//   dst: {
//     abbreviation: 'EDT',
//     offsetMinutes: 240, utcOffsetMinutes: -240,
//     start: { type: 'M', month: 3, week: 2, weekday: 0, time: { hours: 2, minutes: 0, seconds: 0 } },
//     end:   { type: 'M', month: 11, week: 1, weekday: 0, time: { hours: 2, minutes: 0, seconds: 0 } }
//   },
//   raw: 'EST5EDT,M3.2.0,M11.1.0'
// }
```

Exported names: `parsePosixTz(input: string)`, plus the type guards `isPosixRule`, `isDstRule`, `isTransitionRule`.

## Why

tzdata ships both a geographic database and a per-zone `POSIX TZ` string used as a fallback when the database is unavailable (e.g. embedded systems, some build-time constants). Parsing that string correctly — with its inverted offset sign and `M`/`J`/`N` rule variants — is fiddly and easy to get wrong. This library does just that parsing and nothing else.

The deliberate trade-off: the library returns the *rule*, not a *computed transition date*. Computing the date requires picking a year and handling leap years and weekday arithmetic, which belongs in a date library. Keeping this layer rule-only makes it testable without touching wall-clock time.

## The awkward edge

POSIX TZ offsets are **west-positive**, the opposite of ISO 8601. `EST5` means UTC-5. Every parsed rule carries both `offsetMinutes` (raw POSIX sign) and `utcOffsetMinutes` (ISO sign) so you can pick the convention you need without re-deriving it. Sub-minute offset seconds are rejected rather than silently truncated, because a consumer computing transitions from a truncated value would get the wrong answer. DST offsets that are omitted default to one hour ahead of standard time per POSIX.

## Performance

The window keeps a bounded buffer, so `push` is constant time and memory does not
grow with the length of the stream. `peak` and `trough` are linear in the window
size, which is the trade that keeps `push` cheap.

