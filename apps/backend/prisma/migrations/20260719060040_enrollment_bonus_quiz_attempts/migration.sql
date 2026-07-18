-- จำนวนครั้งสอบ quiz พิเศษที่ ADMIN ให้เพิ่มเฉพาะ enrollment นี้ — บวกเพิ่มจาก quiz.maxAttempts
-- default 0 ไม่กระทบ enrollment เดิม (พฤติกรรมเดิมทุกอย่างเหมือนเดิมจนกว่า admin จะกดให้สิทธิ์เพิ่ม)
ALTER TABLE `Enrollment` ADD COLUMN `bonusQuizAttempts` INTEGER NOT NULL DEFAULT 0;
