-- TrainingLog/TrainingAttendee เป็น model จากแผน Phase แรกที่ไม่เคยถูก build จริง —
-- ไม่มีโค้ดส่วนไหนใน backend อ้างถึงเลย (ไม่มี route/service/test) ตารางว่างเปล่าตลอด
-- ลบ child (TrainingAttendee มี FK ชี้ TrainingLog) ก่อน parent
ALTER TABLE `TrainingAttendee` DROP FOREIGN KEY `TrainingAttendee_trainingId_fkey`;
DROP TABLE `TrainingAttendee`;
DROP TABLE `TrainingLog`;
