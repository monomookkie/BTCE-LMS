// รองรับ URL รูปแบบที่ admin อาจวางตอนเพิ่ม VIDEO material:
//   https://www.youtube.com/watch?v=ID
//   https://youtu.be/ID
//   https://www.youtube.com/embed/ID
//   https://www.youtube.com/shorts/ID
// คืนค่า null ถ้า parse ไม่ได้ (เช่นเป็นลิงก์วิดีโอที่ไม่ใช่ YouTube) — ผู้เรียกต้อง fallback เป็นลิงก์เปิดในแท็บใหม่แทน
export function extractYoutubeId(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }

  const host = parsed.hostname.replace(/^www\./, '')

  if (host === 'youtu.be') {
    const id = parsed.pathname.slice(1).split('/')[0]
    return id != null && id !== '' ? id : null
  }

  if (host === 'youtube.com' || host === 'm.youtube.com') {
    if (parsed.pathname === '/watch') {
      return parsed.searchParams.get('v')
    }
    const embedMatch = /^\/(embed|shorts)\/([^/]+)/.exec(parsed.pathname)
    if (embedMatch?.[2] != null) return embedMatch[2]
  }

  return null
}
