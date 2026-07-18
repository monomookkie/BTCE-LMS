// Tier 2/3 anti-cheat gate ก่อนอนุญาต mark-material-complete
// ค่าเดียวใช้ร่วมกันทั้ง backend (server-side gate) และ frontend (UI disabled-state/threshold)
// ปรับค่าที่นี่ที่เดียว — ห้าม hardcode ซ้ำที่อื่น
export const MIN_READ_SECONDS = 300 // PDF/LINK/IMAGE/DOC: ต้องเปิดมาแล้วอย่างน้อยกี่วินาที
export const MIN_WATCHED_PERCENT = 90 // VIDEO: ต้องดูถึงกี่ % ของวิดีโอ

// Server-side sanity check บน POST /progress — กัน client ยิง watchedPercent ปลอมทะลุโดยไม่ผ่านเวลาจริง
// สูตร: maxReasonablePercent = (เวลาที่ผ่านจริงตั้งแต่ openedAt / durationSeconds) * 100 + buffer
// durationSeconds เป็นค่าที่ client รายงานมาครั้งแรก (lock ไว้ ไม่ให้เปลี่ยนภายหลัง) — ถ้ายังไม่มี ใช้ค่าประมาณขั้นต่ำแทน
export const PROGRESS_CEILING_BUFFER_PERCENT = 10 // เผื่อ jitter/buffering — ไม่ใช่ช่องให้กรอ (คิดจากเวลาจริงเท่านั้น)
export const MIN_ASSUMED_VIDEO_DURATION_SECONDS = 30 // fallback เมื่อยังไม่รู้ duration จริง (เช่นยิง /progress ตรงโดยไม่ผ่าน player)

// เวลาที่ "อยู่บนหน้าจริง" (active time) สำหรับ time-gate — นับเฉพาะตอน mount + tab visible เท่านั้น
// ต่างจาก openedAt เดิมที่เป็น wall-clock (นับต่อแม้ออกจากหน้าไปแล้ว) — ผู้ใช้ต้องอยู่หน้าจริงถึงจะครบเกณฑ์
export const HEARTBEAT_INTERVAL_SECONDS = 5 // client ส่ง heartbeat ทุกกี่วินาทีระหว่างอยู่หน้า+visible
// เพดานรับ delta ต่อ heartbeat หนึ่งครั้ง — เผื่อ timer drift/tab throttling เล็กน้อย แต่กัน client ยิง delta ปลอมโตๆ
export const HEARTBEAT_MAX_DELTA_SECONDS = 10
