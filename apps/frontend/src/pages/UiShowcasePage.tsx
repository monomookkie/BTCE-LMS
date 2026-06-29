import { useState } from 'react'
import { Users, BookOpen, Award, BarChart3 } from 'lucide-react'
import { Badge } from '../components/ui/Badge.js'
import { Button } from '../components/ui/Button.js'
import { Card } from '../components/ui/Card.js'
import { Input } from '../components/ui/Input.js'
import { Modal } from '../components/ui/Modal.js'
import { ConfirmDialog } from '../components/ui/ConfirmDialog.js'
import { Skeleton } from '../components/ui/Skeleton.js'
import { Avatar } from '../components/ui/Avatar.js'
import { ProgressBar } from '../components/ui/ProgressBar.js'
import { StatCard } from '../components/ui/StatCard.js'
import { StatusBadge } from '../components/ui/StatusBadge.js'
import { DataTable, type Column } from '../components/ui/DataTable.js'
import { useToast } from '../hooks/useToast.js'
import { LanguageSwitcher } from '../components/LanguageSwitcher.js'

// ──────────────────────────────────────────── sample data for DataTable ──

interface SampleRow {
  id: number
  name: string
  course: string
  status: string
  progress: number
}

const SAMPLE_ROWS: SampleRow[] = [
  { id: 1, name: 'Somchai T.', course: 'Blood Safety & PDPA', status: 'COMPLETED', progress: 100 },
  { id: 2, name: 'Malee W.',   course: 'Infection Control',   status: 'IN_PROGRESS', progress: 60 },
  { id: 3, name: 'Prasit K.',  course: 'Lab Procedures',      status: 'ASSIGNED',    progress: 0 },
  { id: 4, name: 'Siriporn A.', course: 'Blood Safety & PDPA', status: 'EXPIRED',   progress: 100 },
]

const TABLE_COLUMNS: Column<SampleRow>[] = [
  { key: 'name',     header: 'Name' },
  { key: 'course',   header: 'Course' },
  {
    key: 'status',
    header: 'Status',
    render: (row) => <StatusBadge type="enrollment" status={row.status} />,
  },
  {
    key: 'progress',
    header: 'Progress',
    width: '160px',
    render: (row) => <ProgressBar value={row.progress} showValue />,
  },
]

// ──────────────────────────────────────────────────────────── showcase ──

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-12">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-slate-400">
        {title}
      </h2>
      {children}
    </section>
  )
}

export default function UiShowcasePage() {
  const toast = useToast()
  const [modalOpen, setModalOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [tablePage, setTablePage] = useState(1)

  return (
    <div className="min-h-screen bg-slate-100 px-6 py-10">
      <div className="mx-auto max-w-4xl">
        {/* Header */}
        <div className="mb-10 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">UI Component Showcase</h1>
            <p className="mt-1 text-sm text-slate-500">FE-1 — BTEC LMS v2 design system</p>
          </div>
          <LanguageSwitcher />
        </div>

        {/* ── Badge ── */}
        <Section title="Badge">
          <div className="flex flex-wrap gap-2">
            <Badge variant="blue">Blue</Badge>
            <Badge variant="green">Green</Badge>
            <Badge variant="red">Red</Badge>
            <Badge variant="amber">Amber</Badge>
            <Badge variant="purple">Purple</Badge>
            <Badge variant="gray">Gray</Badge>
          </div>
        </Section>

        {/* ── Button ── */}
        <Section title="Button">
          <div className="flex flex-wrap gap-3">
            <Button variant="brand">Brand</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="brand" size="sm">Small</Button>
            <Button variant="brand" isLoading>Loading</Button>
            <Button variant="brand" disabled>Disabled</Button>
            <Button variant="brand" leftIcon={<Users size={15} />}>With Icon</Button>
          </div>
        </Section>

        {/* ── Card ── */}
        <Section title="Card">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card header={<span className="font-semibold text-slate-700">Card with header</span>}>
              <p className="text-sm text-slate-600">Card body content goes here.</p>
            </Card>
            <Card
              header={<span className="font-semibold text-slate-700">Card with footer</span>}
              footer={<Button size="sm">Action</Button>}
            >
              <p className="text-sm text-slate-600">Card with a footer action button.</p>
            </Card>
          </div>
        </Section>

        {/* ── Input ── */}
        <Section title="Input">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Input label="Email" type="email" placeholder="admin@btec.rcthai.or.th" />
            <Input label="Password" type="password" placeholder="••••••••" />
            <Input label="With error" error="This field is required" placeholder="Required" />
            <Input label="With helper" helperText="We never share your email." type="email" placeholder="you@example.com" />
          </div>
        </Section>

        {/* ── Avatar + Skeleton ── */}
        <Section title="Avatar + Skeleton">
          <div className="flex flex-wrap items-center gap-4">
            <Avatar name="Somchai Thongdee" size="sm" />
            <Avatar name="Malee Wongkam" size="md" />
            <Avatar name="Admin User" size="lg" />
            <div className="ml-4 w-40">
              <Skeleton lines={3} />
            </div>
            <Skeleton className="h-10 w-10 rounded-full" />
          </div>
        </Section>

        {/* ── ProgressBar ── */}
        <Section title="ProgressBar">
          <div className="space-y-3">
            <ProgressBar value={100} label="Blood Safety & PDPA" showValue />
            <ProgressBar value={60} label="Infection Control" showValue />
            <ProgressBar value={0} label="Lab Procedures" showValue />
          </div>
        </Section>

        {/* ── StatCard ── */}
        <Section title="StatCard">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard label="Total Users" value="248" icon={<Users size={20} />} trend={{ value: 12, label: 'this month' }} />
            <StatCard label="Courses" value="18" icon={<BookOpen size={20} />} />
            <StatCard label="Certificates" value="1,204" icon={<Award size={20} />} trend={{ value: -3, label: 'expiring' }} />
            <StatCard label="Compliance" value="94%" icon={<BarChart3 size={20} />} trend={{ value: 2 }} />
          </div>
        </Section>

        {/* ── StatusBadge ── */}
        <Section title="StatusBadge">
          <div className="space-y-3">
            <div>
              <p className="mb-2 text-xs font-medium text-slate-500">Cert</p>
              <div className="flex flex-wrap gap-2">
                <StatusBadge type="cert" status="valid" />
                <StatusBadge type="cert" status="expiring-soon" />
                <StatusBadge type="cert" status="expired" />
                <StatusBadge type="cert" status="revoked" />
                <StatusBadge type="cert" status="UNKNOWN_STATUS" />
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-medium text-slate-500">Enrollment</p>
              <div className="flex flex-wrap gap-2">
                <StatusBadge type="enrollment" status="ASSIGNED" />
                <StatusBadge type="enrollment" status="IN_PROGRESS" />
                <StatusBadge type="enrollment" status="COMPLETED" />
                <StatusBadge type="enrollment" status="EXPIRED" />
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-medium text-slate-500">Announcement / Course</p>
              <div className="flex flex-wrap gap-2">
                <StatusBadge type="announcement" status="DRAFT" />
                <StatusBadge type="announcement" status="PUBLISHED" />
                <StatusBadge type="course" status="DRAFT" />
                <StatusBadge type="course" status="PUBLISHED" />
                <StatusBadge type="course" status="ARCHIVED" />
              </div>
            </div>
          </div>
        </Section>

        {/* ── Toast ── */}
        <Section title="Toast">
          <div className="flex flex-wrap gap-2">
            <Button variant="brand" size="sm" onClick={() => toast.success('User imported successfully.')}>
              Success Toast
            </Button>
            <Button variant="danger" size="sm" onClick={() => toast.error('Failed to delete record.')}>
              Error Toast
            </Button>
            <Button variant="outline" size="sm" onClick={() => toast.info('New announcement published.')}>
              Info Toast
            </Button>
            <Button variant="ghost" size="sm" onClick={() => toast.warning('Certificate expires in 30 days.')}>
              Warning Toast
            </Button>
          </div>
        </Section>

        {/* ── Modal + ConfirmDialog ── */}
        <Section title="Modal + ConfirmDialog">
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" onClick={() => setModalOpen(true)}>Open Modal</Button>
            <Button variant="danger" size="sm" onClick={() => setConfirmOpen(true)}>Open Confirm</Button>
          </div>

          <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title="Example Modal">
            <p className="text-sm text-slate-600">
              This is a modal dialog. Press <kbd className="rounded bg-slate-100 px-1 text-xs">Esc</kbd> or click outside to close.
            </p>
            <div className="mt-4 flex justify-end">
              <Button size="sm" onClick={() => setModalOpen(false)}>Close</Button>
            </div>
          </Modal>

          <ConfirmDialog
            isOpen={confirmOpen}
            onClose={() => setConfirmOpen(false)}
            onConfirm={() => { toast.success('Confirmed!'); setConfirmOpen(false) }}
            title="Delete user?"
            message="This will permanently remove the user and cannot be undone."
            confirmLabel="Delete"
            variant="danger"
          />
        </Section>

        {/* ── DataTable ── */}
        <Section title="DataTable">
          <DataTable
            columns={TABLE_COLUMNS}
            data={SAMPLE_ROWS}
            keyField="id"
            pagination={{
              page: tablePage,
              pageSize: 3,
              total: SAMPLE_ROWS.length,
              onPageChange: setTablePage,
            }}
          />
          <div className="mt-6">
            <p className="mb-2 text-xs text-slate-500">Loading state:</p>
            <DataTable columns={TABLE_COLUMNS} data={[]} keyField="id" isLoading />
          </div>
          <div className="mt-6">
            <p className="mb-2 text-xs text-slate-500">Empty state:</p>
            <DataTable columns={TABLE_COLUMNS} data={[]} keyField="id" />
          </div>
        </Section>
      </div>
    </div>
  )
}
