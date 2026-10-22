-- pgvector is created here instead of through the schema so the first
-- migration works the same on a fresh database and on the shadow database.
CREATE EXTENSION IF NOT EXISTS vector;
