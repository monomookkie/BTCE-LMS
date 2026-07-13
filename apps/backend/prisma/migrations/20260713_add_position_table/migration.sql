-- AlterTable
ALTER TABLE `User` ADD COLUMN `positionId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `Position` (
    `id` VARCHAR(191) NOT NULL,
    `nameEn` VARCHAR(191) NOT NULL,
    `nameTh` VARCHAR(191) NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Position_deletedAt_idx`(`deletedAt`),
    UNIQUE INDEX `Position_nameEn_key`(`nameEn`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `User_positionId_idx` ON `User`(`positionId`);

-- Data backfill: 1 Position row per distinct existing free-text User.position value
-- (dedup is exact-string only — near-duplicates like "นักเทคนิค" vs "นักเทคนิคการแพทย์"
-- become separate rows on purpose; admin merges them later via the Manage Positions UI in 2C-5)
INSERT INTO `Position` (`id`, `nameEn`, `createdAt`, `updatedAt`)
SELECT CONCAT('c', REPLACE(UUID(), '-', '')), `position`, NOW(3), NOW(3)
FROM (
    SELECT DISTINCT TRIM(`position`) AS `position`
    FROM `User`
    WHERE `position` IS NOT NULL AND TRIM(`position`) != ''
) AS distinct_positions;

-- Data backfill: point every User.positionId at its matching Position row
UPDATE `User` u
JOIN `Position` p ON TRIM(u.`position`) = p.`nameEn`
SET u.`positionId` = p.`id`
WHERE u.`position` IS NOT NULL AND TRIM(u.`position`) != '';

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_positionId_fkey` FOREIGN KEY (`positionId`) REFERENCES `Position`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
