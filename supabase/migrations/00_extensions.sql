-- pgcrypto provides gen_random_uuid() for every table's primary key default.
create extension if not exists pgcrypto;
