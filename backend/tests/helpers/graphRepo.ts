// A small TypeScript service with a known call chain, for the code graph tests:
//   routes/auth.ts loginHandler → AuthService.login → UserRepository.findByEmail → db.ts query
// plus a cycle (a → b → a), an inheritance pair (UserRepository extends BaseRepository),
// an interface, a barrel file and calls into packages that stay unresolved.
export const GRAPH_FILES: Record<string, string> = {
  'src/db.ts': `import { Pool } from 'pg';

const pool = new Pool();

export async function query(sql: string, params: unknown[]) {
  const result = await pool.query(sql, params);
  return result.rows;
}
`,
  'src/repositories/baseRepository.ts': `export class BaseRepository {
  first<T>(rows: T[]): T | undefined {
    return rows[0];
  }
}
`,
  'src/repositories/userRepository.ts': `import * as db from '../db.js';
import { BaseRepository } from './baseRepository.js';

export class UserRepository extends BaseRepository {
  async findByEmail(email: string) {
    const rows = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    return this.first(rows);
  }
}
`,
  'src/repositories/index.ts': `export * from './userRepository.js';
export { BaseRepository } from './baseRepository.js';
`,
  'src/types.ts': `export interface Authenticator {
  login(email: string, password: string): Promise<boolean>;
}
`,
  'src/services/authService.ts': `import bcrypt from 'bcrypt';
import { UserRepository } from '../repositories/index.js';
import type { Authenticator } from '../types.js';

export class AuthService implements Authenticator {
  constructor(private readonly users: UserRepository) {}

  async login(email: string, password: string) {
    const user = await this.users.findByEmail(email);
    if (!user) return false;
    return bcrypt.compare(password, user.passwordHash);
  }
}
`,
  'src/routes/auth.ts': `import { UserRepository } from '../repositories/userRepository.js';
import { AuthService } from '../services/authService.js';

const service = new AuthService(new UserRepository());

export async function loginHandler(req: { body: { email: string; password: string } }) {
  const ok = await service.login(req.body.email, req.body.password);
  return { ok };
}
`,
  'src/cycle/a.ts': `import { b } from './b.js';

export function a(n: number): number {
  return n > 0 ? b(n - 1) : 0;
}
`,
  'src/cycle/b.ts': `import { a } from './a.js';

export function b(n: number): number {
  return n > 0 ? a(n - 1) : 0;
}
`,
};
