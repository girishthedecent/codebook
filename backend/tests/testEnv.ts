import 'dotenv/config';

function databaseName(url: string) {
  return new URL(url).pathname.slice(1);
}

/** Points the app at the test database. Runs before anything imports src/config. */
export function useTestEnv() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL must be set to run tests');

  // resetDb() truncates every table, so never let it near a real database. Checked against
  // the original values only: global setup and each test file both call this function.
  if (!process.env.CODEBOOK_TEST_ENV) {
    const name = databaseName(url);
    const devUrl = process.env.DATABASE_URL;
    if (!name.endsWith('_test') || (devUrl && databaseName(devUrl) === name)) {
      throw new Error(`Refusing to run tests against "${name}": use a separate *_test database`);
    }
    process.env.CODEBOOK_TEST_ENV = '1';
  }

  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = url;
  process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL ?? 'silent';
  process.env.LIVE_TESTS ??= '0';

  // Pin settings that tests assert on, whatever the local .env says.
  process.env.TRUST_PROXY = 'false';
  process.env.APP_URL = 'http://localhost:4000';
  process.env.BETTER_AUTH_URL = 'http://localhost:4000';
  process.env.TRUSTED_ORIGINS = 'http://localhost:3000';
  process.env.LOG_TO_FILE = 'false';
  // Created by docker compose next to the dev bucket; tests delete what they upload.
  process.env.S3_BUCKET = 'codebook-test';
  // Tests spy on inngest.send; dev mode keeps the client from wanting an event key. The base
  // URL goes nowhere, so a test that forgets the spy fails instead of queueing real jobs.
  process.env.INNGEST_DEV = '1';
  process.env.INNGEST_BASE_URL = 'http://127.0.0.1:9';
}
