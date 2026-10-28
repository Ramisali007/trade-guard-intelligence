import { hashPassword } from '../src/services/account-directory';

/**
 * Print a password hash for an AUTH_USERS entry:
 *   npm run hash-password -- 'correct horse battery staple'
 */
const password = process.argv[2];
if (!password || password.length < 12) {
  console.error('Usage: npm run hash-password -- <password of at least 12 characters>');
  process.exit(1);
}
console.log(hashPassword(password));
