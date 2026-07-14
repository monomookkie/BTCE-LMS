-- ต้องเก็บ mimeType ของไฟล์ประกาศ เพื่อให้ getSignedUrl() รู้ resource_type ที่ถูกต้อง (image ไม่ใช่ raw)
-- ไม่งั้น signed URL ของรูปภาพจะพัง (Cloudinary ปฏิเสธ signature ที่ resource_type ไม่ตรง)
ALTER TABLE `Announcement` ADD COLUMN `fileMimeType` VARCHAR(191) NULL;
