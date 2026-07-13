-- AlterTable
-- Snapshot flag for compliance reporting (2C-3): true = enrollment was created
-- while the course was POSITION_BASED (mandatory), false = PUBLIC (optional).
-- No backfill needed — existing enrollments predate accessType and default to
-- false (dev-only DB, no production data affected).
ALTER TABLE `Enrollment` ADD COLUMN `isMandatory` BOOLEAN NOT NULL DEFAULT false;
