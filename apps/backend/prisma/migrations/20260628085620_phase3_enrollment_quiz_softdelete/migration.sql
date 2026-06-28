-- AlterTable
ALTER TABLE `Course` ADD COLUMN `allowSelfEnroll` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `Question` ADD COLUMN `deletedAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `Quiz` ADD COLUMN `deletedAt` DATETIME(3) NULL;
