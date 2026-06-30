-- Migration: Certificate.courseTitleEn/Th — snapshot ณ วันออกใบ
-- ชื่อ course ที่แสดงในใบรับรองต้องตรึงไว้ ณ วันออก ไม่เปลี่ยนตามการแก้ course ภายหลัง

-- Step 1: เพิ่ม column แบบ nullable ก่อน (safe สำหรับตารางที่มี row อยู่แล้ว)
ALTER TABLE `Certificate`
  ADD COLUMN `courseTitleEn` VARCHAR(500) NULL,
  ADD COLUMN `courseTitleTh` VARCHAR(500) NULL;

-- Step 2: Backfill cert เดิมจาก course ปัจจุบัน
UPDATE `Certificate` c
  INNER JOIN `Course` co ON c.courseId = co.id
  SET c.courseTitleEn = co.titleEn,
      c.courseTitleTh = co.titleTh;

-- Step 3: ทำให้ courseTitleEn เป็น NOT NULL (backfill ครบแล้ว)
--         courseTitleTh คงไว้ nullable ตาม bilingual pattern (En required, Th optional)
ALTER TABLE `Certificate` MODIFY COLUMN `courseTitleEn` VARCHAR(500) NOT NULL;
