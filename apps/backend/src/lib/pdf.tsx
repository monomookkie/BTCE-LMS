import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { Document, Page, Text, View, Image, Font, renderToBuffer, StyleSheet } from '@react-pdf/renderer'
import QRCode from 'qrcode'

// ─── Font registration ───────────────────────────────────────────────────────
// Sarabun ครอบคลุมทั้ง Latin + Thai ทำให้ PDF bilingual ได้โดยไม่ต้องสลับ font
const __dir = dirname(fileURLToPath(import.meta.url))
Font.register({
  family: 'Sarabun',
  src: join(__dir, 'fonts', 'Sarabun-Regular.ttf'),
})
// ปิด hyphenation — ป้องกัน @react-pdf ตัดคำผิดสำหรับภาษาไทย
Font.registerHyphenationCallback((word) => [word])

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CertPdfData {
  holderName: string
  courseTitle: string  // already localized by caller via localizeField
  certNumber: string
  score: number
  issuedAt: Date
  expiresAt: Date | null
  verifyUrl: string    // full URL for QR code: APP_URL/verify/{verifyHash}
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Sarabun',
    padding: 56,
    backgroundColor: '#FFFFFF',
    fontSize: 11,
    color: '#1F2937',
  },
  border: {
    border: '3px solid #B91C1C',
    padding: 40,
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
  },
  orgName: {
    fontSize: 12,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 4,
  },
  headline: {
    fontSize: 24,
    fontFamily: 'Sarabun',
    color: '#B91C1C',
    textAlign: 'center',
    marginBottom: 4,
    letterSpacing: 1,
  },
  subHeadline: {
    fontSize: 14,
    textAlign: 'center',
    color: '#374151',
    marginBottom: 28,
  },
  label: {
    fontSize: 10,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 4,
  },
  holderName: {
    fontSize: 22,
    textAlign: 'center',
    color: '#111827',
    marginBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#D1D5DB',
    paddingBottom: 12,
    width: '80%',
  },
  courseTitle: {
    fontSize: 15,
    textAlign: 'center',
    color: '#1F2937',
    marginBottom: 24,
    fontFamily: 'Sarabun',
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 32,
    marginBottom: 28,
  },
  metaItem: {
    alignItems: 'center',
  },
  metaLabel: {
    fontSize: 9,
    color: '#9CA3AF',
    marginBottom: 2,
  },
  metaValue: {
    fontSize: 11,
    color: '#374151',
  },
  certNumber: {
    fontSize: 10,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 20,
    fontFamily: 'Sarabun',
  },
  qr: {
    width: 72,
    height: 72,
  },
  qrLabel: {
    fontSize: 8,
    color: '#9CA3AF',
    textAlign: 'center',
    marginTop: 4,
  },
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ─── PDF Component ───────────────────────────────────────────────────────────

function CertificateDocument({ data, qrDataUrl }: { data: CertPdfData; qrDataUrl: string }) {
  return (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <View style={styles.border}>
          {/* Header */}
          <Text style={styles.orgName}>
            National Blood Centre, Thai Red Cross Society
          </Text>
          <Text style={styles.orgName}>
            ศูนย์บริการโลหิตแห่งชาติ สภากาชาดไทย
          </Text>

          <Text style={{ ...styles.headline, marginTop: 20 }}>
            CERTIFICATE OF COMPLETION
          </Text>
          <Text style={styles.subHeadline}>ใบรับรองการผ่านการอบรม</Text>

          {/* Holder */}
          <Text style={styles.label}>This certifies that / ขอรับรองว่า</Text>
          <Text style={styles.holderName}>{data.holderName}</Text>

          {/* Course */}
          <Text style={styles.label}>has successfully completed / ได้ผ่านการอบรมหลักสูตร</Text>
          <Text style={styles.courseTitle}>{data.courseTitle}</Text>

          {/* Meta */}
          <View style={styles.metaRow}>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>SCORE / คะแนน</Text>
              <Text style={styles.metaValue}>{data.score}%</Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>DATE / วันที่</Text>
              <Text style={styles.metaValue}>{formatDate(data.issuedAt)}</Text>
            </View>
            {data.expiresAt != null && (
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>VALID UNTIL / หมดอายุ</Text>
                <Text style={styles.metaValue}>{formatDate(data.expiresAt)}</Text>
              </View>
            )}
          </View>

          {/* Cert number */}
          <Text style={styles.certNumber}>Certificate No. {data.certNumber}</Text>

          {/* QR code */}
          <Image src={qrDataUrl} style={styles.qr} />
          <Text style={styles.qrLabel}>Scan to verify / สแกนเพื่อตรวจสอบ</Text>
        </View>
      </Page>
    </Document>
  )
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function generateCertificatePdf(data: CertPdfData): Promise<Buffer> {
  const qrDataUrl = await QRCode.toDataURL(data.verifyUrl, {
    margin: 1,
    width: 144,
    color: { dark: '#1F2937', light: '#FFFFFF' },
  })

  // renderToBuffer expects a React element (JSX compiled version)
  const element = <CertificateDocument data={data} qrDataUrl={qrDataUrl} />
  return Buffer.from(await renderToBuffer(element))
}
