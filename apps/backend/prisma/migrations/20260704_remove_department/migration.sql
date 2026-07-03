-- REFACTOR-1: single-department deployment — drop Department entirely.
-- Dev/test only, no production data affected.

ALTER TABLE `User` DROP FOREIGN KEY `User_departmentId_fkey`;
ALTER TABLE `User` DROP COLUMN `departmentId`;
DROP TABLE `Department`;
