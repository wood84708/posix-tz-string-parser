/**
 * POSIX TZ String Parser — public entry point.
 *
 * Re-exports the parse function and the shape definitions documented in the README.
 * The entry point is intentionally thin so consumers import from one place.
 */

import { parsePosixTz } from './core.js';

export { parsePosixTz };
export {
  isPosixRule,
  isDstRule,
  isTransitionRule
} from './core.js';
