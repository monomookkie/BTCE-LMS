-- Step 1: Add nullable En/Th columns to all tables
-- Step 2: Backfill En columns from existing single-language columns
-- Step 3: Set En columns NOT NULL
-- Step 4: Drop old unique constraints where applicable
-- Step 5: Drop old single-language columns
-- Step 6: Add new unique indexes where applicable

-- ─── Department: name → nameEn (unique) + nameTh ───────────────────────────
ALTER TABLE `Department` ADD COLUMN `nameEn` VARCHAR(191) NULL;
ALTER TABLE `Department` ADD COLUMN `nameTh` VARCHAR(191) NULL;
UPDATE `Department` SET `nameEn` = `name`;
ALTER TABLE `Department` MODIFY COLUMN `nameEn` VARCHAR(191) NOT NULL;
DROP INDEX `Department_name_key` ON `Department`;
ALTER TABLE `Department` DROP COLUMN `name`;
CREATE UNIQUE INDEX `Department_nameEn_key` ON `Department`(`nameEn`);

-- ─── Course: title/category/description → En/Th pairs ──────────────────────
ALTER TABLE `Course` ADD COLUMN `titleEn` VARCHAR(191) NULL;
ALTER TABLE `Course` ADD COLUMN `titleTh` VARCHAR(191) NULL;
ALTER TABLE `Course` ADD COLUMN `categoryEn` VARCHAR(191) NULL;
ALTER TABLE `Course` ADD COLUMN `categoryTh` VARCHAR(191) NULL;
ALTER TABLE `Course` ADD COLUMN `descriptionEn` TEXT NULL;
ALTER TABLE `Course` ADD COLUMN `descriptionTh` TEXT NULL;
UPDATE `Course` SET `titleEn` = `title`, `categoryEn` = `category`, `descriptionEn` = `description`;
ALTER TABLE `Course` MODIFY COLUMN `titleEn` VARCHAR(191) NOT NULL;
ALTER TABLE `Course` MODIFY COLUMN `categoryEn` VARCHAR(191) NOT NULL;
ALTER TABLE `Course` DROP COLUMN `title`;
ALTER TABLE `Course` DROP COLUMN `category`;
ALTER TABLE `Course` DROP COLUMN `description`;

-- ─── Material: title → titleEn + titleTh ────────────────────────────────────
ALTER TABLE `Material` ADD COLUMN `titleEn` VARCHAR(191) NULL;
ALTER TABLE `Material` ADD COLUMN `titleTh` VARCHAR(191) NULL;
UPDATE `Material` SET `titleEn` = `title`;
ALTER TABLE `Material` MODIFY COLUMN `titleEn` VARCHAR(191) NOT NULL;
ALTER TABLE `Material` DROP COLUMN `title`;

-- ─── Quiz: title → titleEn + titleTh ────────────────────────────────────────
ALTER TABLE `Quiz` ADD COLUMN `titleEn` VARCHAR(191) NULL;
ALTER TABLE `Quiz` ADD COLUMN `titleTh` VARCHAR(191) NULL;
UPDATE `Quiz` SET `titleEn` = `title`;
ALTER TABLE `Quiz` MODIFY COLUMN `titleEn` VARCHAR(191) NOT NULL;
ALTER TABLE `Quiz` DROP COLUMN `title`;

-- ─── Question: text → textEn + textTh ───────────────────────────────────────
ALTER TABLE `Question` ADD COLUMN `textEn` TEXT NULL;
ALTER TABLE `Question` ADD COLUMN `textTh` TEXT NULL;
UPDATE `Question` SET `textEn` = `text`;
ALTER TABLE `Question` MODIFY COLUMN `textEn` TEXT NOT NULL;
ALTER TABLE `Question` DROP COLUMN `text`;

-- ─── Option: text → textEn + textTh ─────────────────────────────────────────
ALTER TABLE `Option` ADD COLUMN `textEn` VARCHAR(191) NULL;
ALTER TABLE `Option` ADD COLUMN `textTh` VARCHAR(191) NULL;
UPDATE `Option` SET `textEn` = `text`;
ALTER TABLE `Option` MODIFY COLUMN `textEn` VARCHAR(191) NOT NULL;
ALTER TABLE `Option` DROP COLUMN `text`;
