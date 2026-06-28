-- Phase 4: Certificate & Compliance
-- Add CertificateCounter for race-safe atomic certNumber generation
-- Add ExternalCertificate for user-uploaded external certs

-- ─── CertificateCounter ─────────────────────────────────────────────────────
-- ใช้ LAST_INSERT_ID trick ใน INSERT ON DUPLICATE KEY UPDATE เพื่อ atomic increment
CREATE TABLE `certificate_counter` (
  `year`     INT NOT NULL,
  `last_seq` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`year`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─── ExternalCertificate ────────────────────────────────────────────────────
CREATE TABLE `ExternalCertificate` (
  `id`        VARCHAR(191) NOT NULL,
  `userId`    VARCHAR(191) NOT NULL,
  `title`     VARCHAR(191) NOT NULL,
  `issuer`    VARCHAR(191) NOT NULL,
  `issuedAt`  DATETIME(3)  NOT NULL,
  `expiresAt` DATETIME(3)  NULL,
  `fileKey`   VARCHAR(191) NULL,
  `createdAt` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3)  NOT NULL,
  `deletedAt` DATETIME(3)  NULL,

  INDEX `ExternalCertificate_userId_deletedAt_idx`(`userId`, `deletedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ExternalCertificate`
  ADD CONSTRAINT `ExternalCertificate_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `User`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;
