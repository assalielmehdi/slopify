'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { ChevronRightIcon, PlusIcon, WorkflowIcon } from 'lucide-react'

import { WorkflowSlugSchema } from '@slopify/workflow-model'

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  ApiClientError,
  createApiClient,
  type ApiClient,
  type WorkflowCatalogEntry,
} from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { WORKFLOW_CATALOG_CHANGED_EVENT } from '@/lib/workflow-catalog-events'

export type WorkflowSidebarClient = Pick<ApiClient, 'createWorkflow' | 'listWorkflows'>

const defaultClient = createApiClient()

interface WorkflowSidebarMenuProps {
  readonly client?: WorkflowSidebarClient | undefined
  readonly collapsed: boolean
  readonly editorActive: boolean
  readonly onSelectedWorkflowChange?:
    ((workflow: WorkflowCatalogEntry | undefined) => void) | undefined
}

interface WorkflowSidebarMenuFallbackProps {
  readonly collapsed: boolean
  readonly editorActive: boolean
}

function WorkflowDestination({ collapsed, editorActive }: WorkflowSidebarMenuFallbackProps) {
  return (
    <Link
      href="/"
      aria-current={editorActive ? 'page' : undefined}
      aria-label="Workflows"
      title={collapsed ? 'Workflows' : undefined}
      className={cn(
        'flex h-9 items-center rounded-md text-[14px]/5 outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-sidebar-ring/30',
        collapsed ? 'justify-center px-0' : 'gap-2.5 px-2',
        editorActive
          ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
          : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
      )}
    >
      <WorkflowIcon aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.8} />
      <span className={cn('truncate', collapsed && 'sr-only')}>Workflows</span>
    </Link>
  )
}

export function WorkflowSidebarMenuFallback(props: WorkflowSidebarMenuFallbackProps) {
  return <WorkflowDestination {...props} />
}

export function WorkflowSidebarMenu({
  client = defaultClient,
  collapsed,
  editorActive,
  onSelectedWorkflowChange,
}: WorkflowSidebarMenuProps) {
  const router = useRouter()
  const currentWorkflowId = useSearchParams().get('workflowId') ?? undefined
  const [open, setOpen] = useState(true)
  const [showDisclosureIcon, setShowDisclosureIcon] = useState(false)
  const [workflows, setWorkflows] = useState<readonly WorkflowCatalogEntry[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [creating, setCreating] = useState(false)
  const [creatingName, setCreatingName] = useState('')
  const [creatingError, setCreatingError] = useState<string | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let active = true
    const load = () => {
      void client
        .listWorkflows()
        .then((catalog) => {
          if (!active) return
          setWorkflows(catalog)
          setStatus('ready')
        })
        .catch(() => {
          if (active) setStatus('error')
        })
    }
    load()
    window.addEventListener(WORKFLOW_CATALOG_CHANGED_EVENT, load)
    return () => {
      active = false
      window.removeEventListener(WORKFLOW_CATALOG_CHANGED_EVENT, load)
    }
  }, [client])

  const selectedWorkflow =
    workflows.find(({ workflowId }) => workflowId === currentWorkflowId) ?? workflows[0]

  useEffect(() => {
    if (editorActive) onSelectedWorkflowChange?.(selectedWorkflow)
  }, [editorActive, onSelectedWorkflowChange, selectedWorkflow])

  const validateName = (name: string): string | undefined => {
    const parsed = WorkflowSlugSchema.safeParse(name)
    if (!parsed.success) return parsed.error.issues[0]?.message
    if (workflows.some((workflow) => workflow.workflowId === name)) {
      return 'A workflow with this slug already exists.'
    }
    return undefined
  }

  const startCreating = () => {
    setOpen(true)
    setCreating(true)
    setCreatingName('')
    setCreatingError(undefined)
  }

  const cancelCreating = () => {
    setCreating(false)
    setCreatingName('')
    setCreatingError(undefined)
  }

  const submitCreating = async () => {
    const error = validateName(creatingName)
    setCreatingError(error)
    if (error !== undefined || saving) return

    setSaving(true)
    try {
      const created = await client.createWorkflow({
        workflowId: creatingName,
        name: creatingName,
        description: `${creatingName} workflow.`,
      })
      setWorkflows((current) => [created, ...current])
      cancelCreating()
      router.push(`/?workflowId=${encodeURIComponent(created.workflowId)}`)
    } catch (cause) {
      setCreatingError(
        cause instanceof ApiClientError && cause.code === 'WORKFLOW_ID_CONFLICT'
          ? 'A workflow with this slug already exists.'
          : cause instanceof Error
            ? cause.message
            : 'Workflow could not be created.',
      )
    } finally {
      setSaving(false)
    }
  }

  if (collapsed) {
    return <WorkflowDestination collapsed editorActive={editorActive} />
  }

  return (
    <Collapsible className="t-acc" data-open={open} open={open} onOpenChange={setOpen}>
      <div className="flex items-center gap-1">
        <CollapsibleTrigger
          onBlur={() => setShowDisclosureIcon(false)}
          onFocus={() => setShowDisclosureIcon(true)}
          onMouseEnter={() => setShowDisclosureIcon(true)}
          onMouseLeave={(event) =>
            setShowDisclosureIcon(event.currentTarget === document.activeElement)
          }
          className={cn(
            'flex h-9 min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 text-left text-[14px]/5 outline-none transition-colors duration-150 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring/30',
            editorActive ? 'font-medium text-sidebar-accent-foreground' : 'text-sidebar-foreground',
          )}
        >
          <span
            aria-hidden="true"
            className="t-icon-swap size-4 shrink-0"
            data-state={showDisclosureIcon ? 'b' : 'a'}
          >
            <WorkflowIcon className="t-icon size-4" data-icon="a" strokeWidth={1.8} />
            <span className="t-icon" data-icon="b">
              <ChevronRightIcon className="t-acc-chevron size-4" strokeWidth={1.8} />
            </span>
          </span>
          <span className="min-w-0 flex-1 truncate">Workflows</span>
        </CollapsibleTrigger>
        <Popover
          onOpenChange={(nextOpen) => {
            if (nextOpen) startCreating()
            else cancelCreating()
          }}
          open={creating}
        >
          <Tooltip>
            <TooltipTrigger
              render={
                <PopoverTrigger
                  render={
                    <Button
                      aria-label="Add workflow"
                      className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                      disabled={status !== 'ready' || saving}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    />
                  }
                />
              }
            >
              <PlusIcon aria-hidden="true" className="size-4" strokeWidth={1.8} />
            </TooltipTrigger>
            <TooltipContent side="right">Add workflow</TooltipContent>
          </Tooltip>
          <PopoverContent align="start" className="w-60 p-3" initialFocus={inputRef} side="right">
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault()
                void submitCreating()
              }}
            >
              <Label htmlFor="new-workflow-name">Workflow name</Label>
              <Input
                ref={inputRef}
                aria-describedby={creatingError === undefined ? undefined : 'workflow-name-error'}
                aria-invalid={creatingError !== undefined}
                aria-label="New workflow name"
                className="h-8 px-2 font-mono text-[13px]/4"
                disabled={saving}
                id="new-workflow-name"
                maxLength={64}
                onChange={(event) => {
                  const value = event.currentTarget.value
                  setCreatingName(value)
                  setCreatingError(validateName(value))
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    cancelCreating()
                  } else if (event.key === 'Enter') {
                    event.preventDefault()
                    void submitCreating()
                  }
                }}
                placeholder="workflow-name"
                value={creatingName}
              />
              <FieldError id="workflow-name-error">{creatingError}</FieldError>
            </form>
          </PopoverContent>
        </Popover>
      </div>
      <CollapsibleContent className="t-acc-panel" keepMounted>
        <div className="t-acc-panel-inner">
          <div className="ml-4 border-l border-sidebar-border py-1 pl-3">
            {status === 'loading' ? (
              <div aria-label="Loading workflows" className="space-y-1 py-1" role="status">
                <Skeleton className="h-7 w-full" />
                <Skeleton className="h-7 w-4/5" />
              </div>
            ) : status === 'error' ? (
              <p className="px-2 py-1.5 text-xs/4 text-muted-foreground">Workflows unavailable</p>
            ) : workflows.length === 0 ? (
              <p className="px-2 py-1.5 text-xs/4 text-muted-foreground">No workflows</p>
            ) : (
              <ul className="space-y-0.5">
                {workflows.map((workflow, index) => {
                  const selected =
                    editorActive &&
                    (currentWorkflowId === workflow.workflowId ||
                      (currentWorkflowId === undefined && index === 0))
                  return (
                    <li key={workflow.workflowId}>
                      <Link
                        href={`/?workflowId=${encodeURIComponent(workflow.workflowId)}`}
                        aria-current={selected ? 'page' : undefined}
                        aria-label={workflow.name}
                        className={cn(
                          'flex h-8 min-w-0 items-center rounded-md px-2 text-[13px]/4 outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-sidebar-ring/30',
                          selected
                            ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                            : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                        )}
                      >
                        <span className="truncate">{workflow.name}</span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
