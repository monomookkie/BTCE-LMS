-- Announcement redesign: board/popup แสดงรูปภาพเป็นหลัก, content กลายเป็น "ข้อความเพิ่มเติม" แบบไม่บังคับ
ALTER TABLE `Announcement` MODIFY `contentEn` TEXT NULL;
