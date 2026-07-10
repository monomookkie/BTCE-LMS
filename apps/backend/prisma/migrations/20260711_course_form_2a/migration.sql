-- AlterTable
ALTER TABLE `Course` DROP COLUMN `durationMin`,
    DROP COLUMN `passScore`,
    ADD COLUMN `enrollmentCloseAt` DATETIME(3) NULL,
    ADD COLUMN `paperSavingSheets` INTEGER NULL;

-- AlterTable
ALTER TABLE `Quiz` ADD COLUMN `passScore` INTEGER NOT NULL DEFAULT 80;

