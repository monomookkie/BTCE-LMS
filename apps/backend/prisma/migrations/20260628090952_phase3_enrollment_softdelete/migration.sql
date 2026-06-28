-- Phase 3: Enrollment soft delete + index reorder
-- CREATE new indexes FIRST so FK constraint on courseId is always covered

-- Step 1: Add deletedAt column
ALTER TABLE `Enrollment` ADD COLUMN `deletedAt` DATETIME(3) NULL;

-- Step 2: Create new indexes (covers courseId FK before dropping old index)
CREATE INDEX `Enrollment_userId_courseId_idx` ON `Enrollment`(`userId`, `courseId`);
CREATE INDEX `Enrollment_userId_status_deletedAt_idx` ON `Enrollment`(`userId`, `status`, `deletedAt`);
CREATE INDEX `Enrollment_courseId_status_deletedAt_idx` ON `Enrollment`(`courseId`, `status`, `deletedAt`);

-- Step 3: Drop old indexes AFTER new ones exist
DROP INDEX `Enrollment_userId_status_idx` ON `Enrollment`;
DROP INDEX `Enrollment_courseId_status_idx` ON `Enrollment`;

-- Step 4: Drop old unique constraint (replaced by app-level check)
ALTER TABLE `Enrollment` DROP INDEX `Enrollment_userId_courseId_key`;
