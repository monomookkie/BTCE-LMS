-- Position.isSystemOnly — สงวนตำแหน่งงานบางรายการ (เช่น "Administrator") ไว้เฉพาะ ADMIN assign เอง
-- ไม่ให้ขึ้นในหน้า self-register สาธารณะ (GET /positions filter isSystemOnly=false)
ALTER TABLE `Position` ADD COLUMN `isSystemOnly` BOOLEAN NOT NULL DEFAULT false;
