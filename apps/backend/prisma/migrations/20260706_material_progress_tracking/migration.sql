-- CreateTable
CREATE TABLE `MaterialProgress` (
    `id` VARCHAR(191) NOT NULL,
    `enrollmentId` VARCHAR(191) NOT NULL,
    `materialId` VARCHAR(191) NOT NULL,
    `openedAt` DATETIME(3) NULL,
    `watchedPercent` INTEGER NOT NULL DEFAULT 0,
    `lastProgressAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `MaterialProgress_enrollmentId_materialId_key`(`enrollmentId`, `materialId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `MaterialProgress` ADD CONSTRAINT `MaterialProgress_enrollmentId_fkey` FOREIGN KEY (`enrollmentId`) REFERENCES `Enrollment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

