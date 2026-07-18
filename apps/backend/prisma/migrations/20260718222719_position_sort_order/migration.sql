-- ลำดับแสดงผล Position ใน dropdown — ต่ำไปสูง, default 0 ไม่กระทบแถวเดิม (orderBy เดิมใช้ nameEn asc)
ALTER TABLE `Position` ADD COLUMN `sortOrder` INTEGER NOT NULL DEFAULT 0;
