import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

const columnWidths = ['w-64', 'w-40', 'w-24', 'w-20'] as const

export function RunTableSkeleton() {
  return (
    <div role="status" aria-label="Loading run history" className="w-full">
      <div className="flex min-h-12 items-center justify-end border-b px-6 py-2">
        <Skeleton className="h-8 w-8" aria-hidden="true" />
      </div>
      <Table aria-label="Loading workflow runs" className="min-w-[44rem]">
        <TableHeader>
          <TableRow>
            {['Run ID', 'Started', 'Duration', 'Status'].map((label) => (
              <TableHead key={label}>{label}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 8 }, (_, rowIndex) => (
            <TableRow key={rowIndex} data-testid="run-row-skeleton" aria-hidden="true">
              {columnWidths.map((width, columnIndex) => (
                <TableCell key={columnIndex}>
                  <Skeleton className={`h-4 max-w-full ${width}`} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
