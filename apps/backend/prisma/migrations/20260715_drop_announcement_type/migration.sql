-- ประเภทประกาศ (INFO/WARNING/URGENT) ไม่มีผลต่อ logic หรือการแสดงผลใดๆ ในระบบ — เป็นแค่ label
-- ให้ admin จัดหมวดหมู่เองเท่านั้น ไม่มี trigger/styling ต่างกันตาม type จริง ลบทิ้งตามคำขอ
ALTER TABLE `Announcement` DROP COLUMN `type`;
