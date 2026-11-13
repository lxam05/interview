/**
 * The numbers behind the evidence labels, in one place.
 * Changing one changes what students are told, so each has a test.
 */

/** Reports older than this are "historical". */
export const HISTORICAL_AFTER_MONTHS = 24;

/** This many separate firsthand reports make "multiple independent reports". */
export const MIN_INDEPENDENT_REPORTS = 2;

/** A published brief is flagged for another look after this long. */
export const STALE_BRIEF_AFTER_DAYS = 180;

/** Search results for the same query are reused for this long. */
export const QUERY_CACHE_DAYS = 14;

/** A run with no heartbeat for this long is marked failed. */
export const RUN_STALE_AFTER_MINUTES = 10;

/** Documents sent to the model at the same time. */
export const EXTRACTION_CONCURRENCY = 3;
