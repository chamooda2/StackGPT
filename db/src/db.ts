import pg from 'pg';

const e = process.env;

export const client = () =>
  new pg.Client({
    host: e.PGHOST ?? 'localhost',
    port: Number(e.DB_PORT ?? 5433),
    database: e.POSTGRES_DB ?? 'stackgpt',
    user: e.POSTGRES_USER ?? 'stackgpt',
    password: e.POSTGRES_PASSWORD ?? 'stackgpt',
  });
