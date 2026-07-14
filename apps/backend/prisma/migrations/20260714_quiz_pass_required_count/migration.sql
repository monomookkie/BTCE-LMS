-- Quiz.passRequiredCount แทนที่ passScore% เดิม — เกณฑ์ผ่านเป็นจำนวนข้อที่ต้องตอบถูก
-- (ง่ายต่อ admin ตั้งค่า + grading logic ไม่ต้องปัดเศษ %)

-- 1. เพิ่ม column ใหม่ (default 1 ชั่วคราว รอ backfill ด้านล่าง)
ALTER TABLE `Quiz` ADD COLUMN `passRequiredCount` INT NOT NULL DEFAULT 1;

-- 2. Backfill จาก passScore% เดิม × จำนวนข้อปัจจุบันของแต่ละ quiz (CEIL กันเข้มกว่า % เดิมเล็กน้อย
--    ไม่ใช่หลวมกว่า — ตัวอย่าง 7 ข้อ @ 80% เดิม = 5.6 ปัดขึ้นเป็น 6 ข้อ ไม่ใช่ 5 เพราะ 5/7=71.4% < 80%)
UPDATE `Quiz` q
SET q.passRequiredCount = CEIL(q.passScore / 100.0 * (
  SELECT COUNT(*) FROM `Question` qq WHERE qq.quizId = q.id AND qq.deletedAt IS NULL
))
WHERE (SELECT COUNT(*) FROM `Question` qq WHERE qq.quizId = q.id AND qq.deletedAt IS NULL) > 0;

-- 3. ลบ column เดิม
ALTER TABLE `Quiz` DROP COLUMN `passScore`;
