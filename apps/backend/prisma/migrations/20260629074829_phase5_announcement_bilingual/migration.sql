-- Phase 5: Migrate Announcement to bilingual fields
-- Safe path: add nullable → backfill from old columns → set NOT NULL → drop old columns

-- Step 1: Add new nullable bilingual columns + status/publishing/audit fields
ALTER TABLE `Announcement`
  ADD COLUMN `titleEn`     VARCHAR(191)              NULL,
  ADD COLUMN `titleTh`     VARCHAR(191)              NULL,
  ADD COLUMN `contentEn`   TEXT                      NULL,
  ADD COLUMN `contentTh`   TEXT                      NULL,
  ADD COLUMN `status`      ENUM('DRAFT','PUBLISHED') NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN `publishedAt` DATETIME(3)               NULL,
  ADD COLUMN `createdById` VARCHAR(191)              NULL,
  ADD COLUMN `updatedAt`   DATETIME(3)               NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3);

-- Step 2: Backfill bilingual En fields from existing monolingual columns
UPDATE `Announcement` SET `titleEn` = `title`, `contentEn` = `content`;

-- Step 3: Set En fields NOT NULL (safe after backfill)
ALTER TABLE `Announcement`
  MODIFY COLUMN `titleEn`   VARCHAR(191) NOT NULL,
  MODIFY COLUMN `contentEn` TEXT         NOT NULL;

-- Step 4: Drop old monolingual columns
ALTER TABLE `Announcement`
  DROP COLUMN `title`,
  DROP COLUMN `content`;

-- Step 5: Drop default on updatedAt (Prisma manages this at application level)
ALTER TABLE `Announcement` ALTER COLUMN `updatedAt` DROP DEFAULT;

-- Step 6: Replace old index with new composite index
DROP INDEX `Announcement_deletedAt_createdAt_idx` ON `Announcement`;
CREATE INDEX `Announcement_status_deletedAt_createdAt_idx` ON `Announcement`(`status`, `deletedAt`, `createdAt`);
