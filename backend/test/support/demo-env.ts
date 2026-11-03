/**
 * Turns demo login on for one e2e file. Import it FIRST: the API reads its configuration as soon
 * as the app module is loaded (test-app.ts loads it). Test-only numbers and code.
 */
const rand = () => String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0');
export const DEMO = {
  code: '482917',
  customer: `+97158${rand()}`,
  driver: `+97158${rand()}`,
};
process.env.DEMO_LOGIN_PHONES = `${DEMO.customer},${DEMO.driver}`;
process.env.DEMO_LOGIN_CODE = DEMO.code;
