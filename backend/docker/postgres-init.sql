-- Runs once, on the first start of an empty data volume.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE DATABASE codebook_test;
\connect codebook_test
CREATE EXTENSION IF NOT EXISTS vector;
