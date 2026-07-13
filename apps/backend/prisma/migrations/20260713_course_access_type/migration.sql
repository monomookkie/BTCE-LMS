-- AlterTable
-- allowSelfEnroll -> accessType (default PUBLIC). Not a lossy backfill: PUBLIC
-- is the correct new-model default for every existing course regardless of
-- its old allowSelfEnroll value (dev-only DB, no production data affected).
ALTER TABLE `Course` DROP COLUMN `allowSelfEnroll`,
    ADD COLUMN `accessType` ENUM('POSITION_BASED', 'PUBLIC') NOT NULL DEFAULT 'PUBLIC';

-- CreateTable
CREATE TABLE `CoursePosition` (
    `id` VARCHAR(191) NOT NULL,
    `courseId` VARCHAR(191) NOT NULL,
    `positionId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CoursePosition_positionId_idx`(`positionId`),
    UNIQUE INDEX `CoursePosition_courseId_positionId_key`(`courseId`, `positionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CoursePosition` ADD CONSTRAINT `CoursePosition_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `Course`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CoursePosition` ADD CONSTRAINT `CoursePosition_positionId_fkey` FOREIGN KEY (`positionId`) REFERENCES `Position`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
