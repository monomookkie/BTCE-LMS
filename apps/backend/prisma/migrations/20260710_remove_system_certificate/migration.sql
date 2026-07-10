-- DropForeignKey
ALTER TABLE `Certificate` DROP FOREIGN KEY `Certificate_enrollmentId_fkey`;

-- DropForeignKey
ALTER TABLE `Certificate` DROP FOREIGN KEY `Certificate_userId_fkey`;

-- DropTable
DROP TABLE `Certificate`;

-- DropTable
DROP TABLE `certificate_counter`;

