-- Course.expiryMonths ลบทิ้ง (CERT-REMOVE cleanup) — เดิมเป็น "อายุใบรับรอง" แต่ไม่มีระบบออก
-- certificate ภายในแล้ว (ยืนยันแล้วว่าไม่ออก cert = ไม่มี recert) ไม่มีที่ใดในระบบอ้างอิงค่านี้
-- นอกจาก course display/config เอง (ยืนยันด้วย grep ก่อนลบ)
ALTER TABLE `Course` DROP COLUMN `expiryMonths`;
