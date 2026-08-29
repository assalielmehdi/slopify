'use client'

import type { AgentToolKind } from '@slopify/shared'
import { DollarSignIcon, WrenchIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { formatDuration } from '@/lib/run-format'
import { cn } from '@/lib/utils'

export interface AgentTraceTool {
  readonly id: string
  readonly toolCallId: string
  toolKind: AgentToolKind
  toolName: string
  input?: unknown
  status: 'running' | 'succeeded' | 'failed'
  updates: string[]
  result?: string
  readonly startedAt?: string
  completedAt?: string
}

const HEAD_PREVIEW_LINES = 10
const TAIL_PREVIEW_LINES = 5

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined

const logicalLines = (value: string): readonly string[] => {
  const lines = value.replace(/\r\n?/gu, '\n').split('\n')
  while (lines.at(-1) === '') lines.pop()
  return lines
}

function Line({
  children,
  tone,
}: Readonly<{ children: string; tone?: 'added' | 'removed' | undefined }>) {
  return (
    <span
      className={cn(
        'block min-h-5 whitespace-pre-wrap wrap-break-word',
        tone === 'added' && 'text-status-success',
        tone === 'removed' && 'text-destructive',
      )}
    >
      {children === '' ? '\u00a0' : children}
    </span>
  )
}

function ExpandableLines({
  lines,
  direction,
  limit,
}: Readonly<{
  lines: readonly string[]
  direction: 'head' | 'tail'
  limit: number
}>) {
  const [expanded, setExpanded] = useState(false)
  const omittedCount = Math.max(0, lines.length - limit)
  const visibleLines =
    expanded || omittedCount === 0
      ? lines
      : direction === 'head'
        ? lines.slice(0, limit)
        : lines.slice(-limit)
  const omissionText =
    direction === 'head'
      ? `... (${omittedCount} more lines, ${lines.length} total)`
      : `... (${omittedCount} earlier lines)`
  const omissionLabel =
    direction === 'head'
      ? `Show ${omittedCount} more lines, ${lines.length} total`
      : `Show ${omittedCount} earlier lines`

  return (
    <div className="overflow-x-auto rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs/5 text-muted-foreground">
      {!expanded && omittedCount > 0 && direction === 'tail' ? (
        <button
          type="button"
          aria-expanded="false"
          aria-label={omissionLabel}
          className="block min-h-5 w-full text-left text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:text-foreground focus-visible:underline"
          onClick={() => setExpanded(true)}
        >
          {omissionText}
        </button>
      ) : null}
      {visibleLines.map((line, index) => (
        <Line key={`${index}-${line}`}>{line}</Line>
      ))}
      {!expanded && omittedCount > 0 && direction === 'head' ? (
        <button
          type="button"
          aria-expanded="false"
          aria-label={omissionLabel}
          className="block min-h-5 w-full text-left text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:text-foreground focus-visible:underline"
          onClick={() => setExpanded(true)}
        >
          {omissionText}
        </button>
      ) : null}
    </div>
  )
}

const readRange = (input: Record<string, unknown>): string => {
  const offset = typeof input.offset === 'number' ? input.offset : undefined
  const limit = typeof input.limit === 'number' ? input.limit : undefined
  if (offset === undefined && limit === undefined) return ''
  const start = offset ?? 1
  return limit === undefined ? `:${start}` : `:${start}-${start + limit - 1}`
}

const skillName = (path: string): string | undefined => {
  const parts = path.replaceAll('\\', '/').split('/').filter(Boolean)
  if (parts.at(-1)?.toLowerCase() !== 'skill.md') return undefined
  return parts.at(-2)
}

const editLines = (input: Record<string, unknown>): readonly string[] => {
  const edits = Array.isArray(input.edits) ? input.edits : []
  const lines: string[] = []
  for (const value of edits) {
    const edit = record(value)
    if (edit === undefined) continue
    const oldText = text(edit.oldText)
    const newText = text(edit.newText)
    if (oldText !== undefined) lines.push(...logicalLines(oldText).map((line) => `- ${line}`))
    if (newText !== undefined) lines.push(...logicalLines(newText).map((line) => `+ ${line}`))
  }
  return lines
}

const changedPaths = (input: Record<string, unknown>): readonly string[] => {
  if (!Array.isArray(input.changes)) return []
  return input.changes.flatMap((value) => {
    const path = text(record(value)?.path)
    return path === undefined ? [] : [path]
  })
}

function DiffPreview({ lines }: Readonly<{ lines: readonly string[] }>) {
  const [expanded, setExpanded] = useState(false)
  const omittedCount = Math.max(0, lines.length - HEAD_PREVIEW_LINES)
  const visibleLines = expanded ? lines : lines.slice(0, HEAD_PREVIEW_LINES)

  return (
    <div className="overflow-x-auto rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs/5">
      {visibleLines.map((line, index) => (
        <Line
          key={`${index}-${line}`}
          tone={line.startsWith('+ ') ? 'added' : line.startsWith('- ') ? 'removed' : undefined}
        >
          {line}
        </Line>
      ))}
      {!expanded && omittedCount > 0 ? (
        <button
          type="button"
          aria-expanded="false"
          aria-label={`Show ${omittedCount} more lines, ${lines.length} total`}
          className="block min-h-5 w-full text-left text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:text-foreground focus-visible:underline"
          onClick={() => setExpanded(true)}
        >
          ... ({omittedCount} more lines, {lines.length} total)
        </button>
      ) : null}
    </div>
  )
}

const jsonLines = (value: unknown): readonly string[] => {
  if (value === undefined) return []
  try {
    return logicalLines(JSON.stringify(value, null, 2))
  } catch {
    return [String(value)]
  }
}

function ToolStatus({ status }: Readonly<{ status: AgentTraceTool['status'] }>) {
  if (status === 'succeeded') return null
  return (
    <span
      className={cn(
        'ml-auto shrink-0 text-xs/5',
        status === 'failed' ? 'text-destructive' : 'text-muted-foreground',
      )}
    >
      {status === 'failed' ? 'Failed' : 'Running'}
    </span>
  )
}

function Header({ icon, children }: Readonly<{ icon?: ReactNode; children: ReactNode }>) {
  return (
    <div className="flex min-w-0 items-start gap-2 text-sm/5">
      {icon}
      <div className="min-w-0 flex-1 font-mono wrap-break-word">{children}</div>
    </div>
  )
}

function Failure({ tool }: Readonly<{ tool: AgentTraceTool }>) {
  if (tool.status !== 'failed' || tool.result === undefined) return null
  return (
    <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 font-mono text-xs/5 whitespace-pre-wrap text-destructive">
      {tool.result}
    </div>
  )
}

export function AgentTraceToolBlock({ tool }: Readonly<{ tool: AgentTraceTool }>) {
  const input = record(tool.input) ?? {}
  const path = text(input.path)
  const currentOutput = tool.result ?? tool.updates.at(-1)
  const durationMs =
    tool.startedAt === undefined || tool.completedAt === undefined
      ? undefined
      : Math.max(0, Date.parse(tool.completedAt) - Date.parse(tool.startedAt))
  let content: ReactNode

  if (tool.toolKind === 'READ') {
    const readSkill = path === undefined ? undefined : skillName(path)
    content = (
      <>
        <Header>
          {readSkill === undefined
            ? `read${path === undefined ? '' : ` ${path}${readRange(input)}`}`
            : `[skill] ${readSkill}`}
        </Header>
        <Failure tool={tool} />
      </>
    )
  } else if (tool.toolKind === 'WRITE') {
    const lines = logicalLines(text(input.content) ?? '')
    content = (
      <>
        <Header>{`write${path === undefined ? '' : ` ${path}`}`}</Header>
        {lines.length > 0 ? (
          <ExpandableLines lines={lines} direction="head" limit={HEAD_PREVIEW_LINES} />
        ) : null}
        <Failure tool={tool} />
      </>
    )
  } else if (tool.toolKind === 'EDIT') {
    const lines = editLines(input)
    const paths = path === undefined ? changedPaths(input) : [path]
    content = (
      <>
        <Header>
          {paths.length === 0
            ? 'edit'
            : paths.length === 1
              ? `edit ${paths[0]}`
              : `edit ${paths.length} files`}
        </Header>
        {lines.length > 0 ? <DiffPreview lines={lines} /> : null}
        <Failure tool={tool} />
      </>
    )
  } else if (tool.toolKind === 'COMMAND') {
    const command = text(input.command) ?? 'Command'
    const timeout = typeof input.timeout === 'number' ? input.timeout : undefined
    const lines = currentOutput === undefined ? [] : logicalLines(currentOutput)
    content = (
      <>
        <Header icon={<DollarSignIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}>
          <span>{command}</span>
          {timeout === undefined ? null : (
            <span className="ml-2 font-sans text-xs text-muted-foreground">
              (timeout {timeout}s)
            </span>
          )}
        </Header>
        {lines.length > 0 ? (
          <ExpandableLines lines={lines} direction="tail" limit={TAIL_PREVIEW_LINES} />
        ) : null}
        {durationMs === undefined || !Number.isFinite(durationMs) ? null : (
          <p className="text-xs/5 text-muted-foreground">Took {formatDuration(durationMs)}</p>
        )}
      </>
    )
  } else if (tool.toolKind === 'OTHER' && tool.toolName === 'slopify_complete_node') {
    const outcome = text(input.outcome)
    content = (
      <Header>
        completed node
        {outcome === undefined ? null : (
          <span className="ml-2 font-sans text-xs text-muted-foreground">({outcome})</span>
        )}
      </Header>
    )
  } else {
    const inputLines = jsonLines(tool.input)
    const outputLines = currentOutput === undefined ? [] : logicalLines(currentOutput)
    content = (
      <>
        <Header icon={<WrenchIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}>
          {tool.toolName}
        </Header>
        {inputLines.length > 0 ? (
          <ExpandableLines lines={inputLines} direction="head" limit={HEAD_PREVIEW_LINES} />
        ) : null}
        {outputLines.length > 0 ? (
          <ExpandableLines lines={outputLines} direction="tail" limit={TAIL_PREVIEW_LINES} />
        ) : null}
      </>
    )
  }

  return (
    <div
      className="grid min-w-0 gap-2 border-b py-3 first:pt-0 last:border-b-0 last:pb-0"
      data-message-kind="tool"
      data-status={tool.status}
      data-tool-kind={tool.toolKind}
      data-tool-name={tool.toolName}
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className="grid min-w-0 flex-1 gap-2">{content}</div>
        <ToolStatus status={tool.status} />
      </div>
    </div>
  )
}
