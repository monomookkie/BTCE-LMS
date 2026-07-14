-- Notification feature ถูกลบทิ้ง — build ไว้ครบ (model + API + UI bell) แต่ไม่มีจุดไหนในระบบ
-- เคยสร้าง Notification row จริงเลย (ไม่มี cron/hook เรียก) ตารางว่างเปล่าตลอด ไม่ได้ใช้งานจริง
ALTER TABLE `Notification` DROP FOREIGN KEY `Notification_userId_fkey`;
DROP TABLE `Notification`;
