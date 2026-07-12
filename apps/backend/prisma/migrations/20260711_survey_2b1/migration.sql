-- CreateTable
CREATE TABLE `Survey` (
    `id` VARCHAR(191) NOT NULL,
    `courseId` VARCHAR(191) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `Survey_courseId_key`(`courseId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SurveyQuestion` (
    `id` VARCHAR(191) NOT NULL,
    `surveyId` VARCHAR(191) NOT NULL,
    `type` ENUM('RATING', 'TEXT') NOT NULL,
    `textEn` TEXT NOT NULL,
    `textTh` TEXT NULL,
    `order` INTEGER NOT NULL DEFAULT 0,
    `deletedAt` DATETIME(3) NULL,

    INDEX `SurveyQuestion_surveyId_order_idx`(`surveyId`, `order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SurveyResponse` (
    `id` VARCHAR(191) NOT NULL,
    `surveyId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `answers` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `SurveyResponse_surveyId_userId_key`(`surveyId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Survey` ADD CONSTRAINT `Survey_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `Course`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SurveyQuestion` ADD CONSTRAINT `SurveyQuestion_surveyId_fkey` FOREIGN KEY (`surveyId`) REFERENCES `Survey`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SurveyResponse` ADD CONSTRAINT `SurveyResponse_surveyId_fkey` FOREIGN KEY (`surveyId`) REFERENCES `Survey`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

