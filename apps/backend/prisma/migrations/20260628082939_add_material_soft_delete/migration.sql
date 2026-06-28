-- AlterTable
ALTER TABLE `Material` ADD COLUMN `deletedAt` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `Material_courseId_deletedAt_idx` ON `Material`(`courseId`, `deletedAt`);
