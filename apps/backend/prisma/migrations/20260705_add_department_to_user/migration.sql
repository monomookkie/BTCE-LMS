-- Adds a free-text `department` field to User, reintroduced only for
-- self-registration (apps/backend/src/modules/auth). Not the relational
-- Department model removed in REFACTOR-1 — nullable here since ADMIN-created
-- users (CreateUserInput/CSV import) never set it.

ALTER TABLE `User` ADD COLUMN `department` VARCHAR(191) NULL;
