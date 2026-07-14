-- QuizAttempt.correctCount / totalQuestions — snapshot ตอนสอบจริง เพื่อโชว์ "ตอบถูกกี่ข้อ/เต็มกี่ข้อ"
-- แทนโชว์แค่ % เดิม — nullable เพราะ attempt เก่าก่อน migration นี้ไม่มีค่า (ไม่ backfill เดา)
ALTER TABLE `QuizAttempt` ADD COLUMN `correctCount` INT NULL;
ALTER TABLE `QuizAttempt` ADD COLUMN `totalQuestions` INT NULL;
