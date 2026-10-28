import './test-env';

// The fake endpoint's slow mode answers after 7 s; the provider must give up first (minimum allowed: 5 s).
process.env['AI_TIMEOUT_MS'] = '5000';
process.env['AI_LONG_TIMEOUT_MS'] = '5000';
// No pacing against a local stand-in: it has no rate limit.
process.env['AI_MIN_GAP_MS'] = '0';
