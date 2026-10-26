import dataSource from '../database/data-source.js';
import { UserRole, UserStatus } from '../common/enums.js';
import { normalizeUaeMobile } from '../common/phone.js';

/**
 * Provisions an admin account: `npm run admin:create -- 050 123 4567 "Full Name"`.
 * Admins sign in with the normal SMS code but can never be created by signing in.
 */
async function main() {
  // The number may arrive split by spaces ("050 123 4567"): use the shortest prefix that parses.
  const args = process.argv.slice(2);
  let phone: string | null = null;
  let nameParts: string[] = [];
  for (let i = 1; i <= args.length && !phone; i++) {
    phone = normalizeUaeMobile(args.slice(0, i).join(''));
    nameParts = args.slice(i);
  }
  if (!phone) {
    console.error('Usage: npm run admin:create -- <UAE mobile> [full name]');
    process.exit(1);
  }
  await dataSource.initialize();
  try {
    const existing: { role: UserRole }[] = await dataSource.query(
      'SELECT role FROM users WHERE phone = $1',
      [phone],
    );
    if (existing.length && existing[0].role !== UserRole.Admin) {
      console.error(
        `${phone} already belongs to a ${existing[0].role} account; use another number.`,
      );
      process.exit(1);
    }
    await dataSource.query(
      `INSERT INTO users (phone, role, status, full_name) VALUES ($1, $2, $3, $4)
       ON CONFLICT (phone) DO UPDATE SET status = EXCLUDED.status,
         full_name = COALESCE(EXCLUDED.full_name, users.full_name)`,
      [phone, UserRole.Admin, UserStatus.Active, nameParts.join(' ') || null],
    );
    console.log(`Admin ready: ${phone}`);
  } finally {
    await dataSource.destroy();
  }
}

void main();
