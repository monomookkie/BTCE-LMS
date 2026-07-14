import { forwardRef, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from './Button.js'

interface FileInputProps {
  accept?: string
  file: File | null
  onChange: (file: File | null) => void
  required?: boolean
  id?: string
}

// input[type=file] เนทีฟโชว์ "Choose File" / "No file chosen" เป็นข้อความของ browser เอง
// แปลผ่าน i18n ตรงๆ ไม่ได้ — ซ่อน input จริงไว้ (คลิกผ่าน ref แทน) แล้วโชว์ปุ่ม + ชื่อไฟล์ที่คุมข้อความเองแทน
// forwardRef ไว้เพราะบางหน้า (CourseDetailAdminPage, MyCertificatesPage) ต้อง reset .value หลัง submit สำเร็จ
export const FileInput = forwardRef<HTMLInputElement, FileInputProps>(function FileInput(
  { accept, file, onChange, required, id },
  forwardedRef,
) {
  const { t } = useTranslation()
  const innerRef = useRef<HTMLInputElement | null>(null)

  const setRefs = (node: HTMLInputElement | null) => {
    innerRef.current = node
    if (typeof forwardedRef === 'function') forwardedRef(node)
    else if (forwardedRef) (forwardedRef as React.MutableRefObject<HTMLInputElement | null>).current = node
  }

  return (
    <div className="mt-1 flex items-center gap-2">
      <Button type="button" variant="outline" size="sm" onClick={() => innerRef.current?.click()}>
        {t('common.chooseFile')}
      </Button>
      <span className="truncate text-sm text-slate-500">
        {file ? file.name : t('common.noFileChosen')}
      </span>
      <input
        ref={setRefs}
        id={id}
        type="file"
        accept={accept}
        required={required}
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        className="hidden"
      />
    </div>
  )
})
