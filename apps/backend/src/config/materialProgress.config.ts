// Tier 2/3 anti-cheat gate ก่อนอนุญาต mark-material-complete
// ปรับค่าที่นี่ที่เดียว — ห้าม hardcode ซ้ำที่อื่น (ดู enrollments.service.ts)
export const MIN_READ_SECONDS = 300 // PDF/LINK/IMAGE/DOC: ต้องเปิดมาแล้วอย่างน้อยกี่วินาที
export const MIN_WATCHED_PERCENT = 90 // VIDEO: ต้องดูถึงกี่ % ของวิดีโอ
