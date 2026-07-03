-- REFACTOR-2: remove MANAGER role — ADMIN + USER only.
-- MANAGER behaved identically to ADMIN after REFACTOR-1 (no scoping left),
-- so existing MANAGER rows are reassigned to ADMIN to preserve access
-- (not USER, which would be a permission cliff).

UPDATE `User` SET `role` = 'ADMIN' WHERE `role` = 'MANAGER';

ALTER TABLE `User` MODIFY COLUMN `role` ENUM('ADMIN', 'USER') NOT NULL DEFAULT 'USER';
