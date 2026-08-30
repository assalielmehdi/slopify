'use client'

import type { AgentNode, AgentSessionReference, NodeExecutionStatus } from '@slopify/shared'
import { CheckIcon, CopyIcon } from 'lucide-react'
import { useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { formatDuration } from '@/lib/run-format'

export interface NodeExecutionSnapshot {
  readonly attemptId: string
  readonly completedAt: string | null
  readonly durationMs: number | null
  readonly errorCode: string | null
  readonly errorMessage: string | null
  readonly outcome: string | null
  readonly output: unknown
  readonly session: AgentSessionReference | null
  readonly startedAt: string | null
  readonly nodeExecutionId: string
}

export interface RunNodePanelProps {
  readonly execution: NodeExecutionSnapshot | undefined
  readonly node: AgentNode
  readonly status: NodeExecutionStatus
}

function DefinitionList({
  items,
}: Readonly<{ items: readonly (readonly [label: string, value: string])[] }>) {
  return (
    <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {items.map(([label, value]) => (
        <div className="min-w-0" key={label}>
          <dt className="text-xs/4 text-muted-foreground">{label}</dt>
          <dd className="mt-1 truncate font-mono text-xs/5 font-medium" title={value}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

const harnessLabel = (harnessId: string): string =>
  harnessId === 'pi' ? 'Pi' : harnessId === 'codex' ? 'Codex' : harnessId

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined

const resultMessage = (output: unknown): string | undefined => {
  const result = record(output)
  return text(result?.summary) ?? text(record(result?.data)?.response)
}

function MarkdownContent({ children }: Readonly<{ children: string }>) {
  return (
    <div className="grid min-w-0 gap-3 text-sm/6 [&_blockquote]:border-l [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-medium [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:list-disc [&_ul]:pl-5">
      <Markdown
        components={{
          a: ({ children: linkChildren, ...props }) => (
            <a
              {...props}
              className="font-medium underline underline-offset-4"
              rel="noreferrer"
              target="_blank"
            >
              {linkChildren}
            </a>
          ),
        }}
        remarkPlugins={[remarkGfm]}
        skipHtml
      >
        {children}
      </Markdown>
    </div>
  )
}

function SessionCommand({ session }: Readonly<{ session: AgentSessionReference }>) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(session.openCommand)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }

  const copied = copyState === 'copied'
  return (
    <section aria-label="Agent session" className="grid gap-3">
      <div>
        <h3 className="text-sm/5 font-medium">Open full session</h3>
        <p className="mt-1 text-xs/5 text-muted-foreground">
          Run this command in a terminal to inspect the complete harness session.
        </p>
      </div>
      <div className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-muted/50 p-2">
        <code className="min-w-0 flex-1 overflow-x-auto px-1 font-mono text-xs/5 whitespace-nowrap">
          {session.openCommand}
        </code>
        <Button
          aria-label={copied ? 'Session command copied' : 'Copy session command'}
          onClick={() => void copy()}
          size="sm"
          type="button"
          variant="outline"
        >
          {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      {copyState === 'failed' ? (
        <p aria-live="polite" className="text-xs/5 text-destructive">
          The session command could not be copied. Select it manually instead.
        </p>
      ) : null}
    </section>
  )
}

export function RunNodePanel({ execution, node, status }: RunNodePanelProps) {
  const configurationItems: (readonly [string, string])[] = [
    ['Harness', harnessLabel(node.harness.harnessId)],
    ['Model', node.harness.modelId ?? 'Harness default'],
    ['Thinking', node.harness.thinkingLevel ?? 'Harness default'],
    ['Timeout', formatDuration(node.timeoutSeconds * 1_000)],
  ]
  const result = resultMessage(execution?.output)
  const running = status === 'PENDING' || status === 'RUNNING'

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="grid min-w-0 content-start gap-8 p-6">
        {execution?.errorMessage === null || execution?.errorMessage === undefined ? null : (
          <Alert variant="destructive">
            <AlertTitle>{execution.errorCode ?? 'Execution failed'}</AlertTitle>
            <AlertDescription>{execution.errorMessage}</AlertDescription>
          </Alert>
        )}

        <section aria-label="Configuration">
          <DefinitionList items={configurationItems} />
        </section>

        <Separator />

        <section aria-label="Agent result" className="grid gap-3">
          <h3 className="text-sm/5 font-medium">Result</h3>
          {result === undefined ? (
            <p className="text-sm/6 text-muted-foreground">
              {running
                ? 'The final result will appear when this agent finishes.'
                : 'No final result was recorded.'}
            </p>
          ) : (
            <MarkdownContent>{result}</MarkdownContent>
          )}
        </section>

        {execution?.session === null || execution?.session === undefined ? null : (
          <>
            <Separator />
            <SessionCommand session={execution.session} />
          </>
        )}
      </div>
    </div>
  )
}
