-- Who submitted user-contributed problems and solutions (null for seeded/curated content).
-- Needed for moderation and for removing a user's contributions.
alter table problems add column user_id bigint references users (id) on delete set null;
alter table solutions add column user_id bigint references users (id) on delete set null;
create index problems_user_idx on problems (user_id) where user_id is not null;
create index solutions_user_idx on solutions (user_id) where user_id is not null;
