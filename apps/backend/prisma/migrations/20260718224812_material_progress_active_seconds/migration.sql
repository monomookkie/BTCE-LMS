-- เวลาที่อยู่หน้าจริงสะสม (วินาที) สำหรับ time-gate — แทน wall-clock diff จาก openedAt
-- default 0 ไม่กระทบแถวเดิม (เพิ่มจากศูนย์ ผู้ใช้ที่เปิดสื่อไปก่อนหน้านี้ต้องเปิดหน้าใหม่เพื่อสะสมเวลาต่อ)
ALTER TABLE `MaterialProgress` ADD COLUMN `activeSeconds` INTEGER NOT NULL DEFAULT 0;
