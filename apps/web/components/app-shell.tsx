'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Suspense, useEffect, useState, type ReactNode } from 'react'
import {
  ChevronRightIcon,
  CpuIcon,
  HistoryIcon,
  FolderGit2Icon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  Settings2Icon,
  WorkflowIcon,
  type LucideIcon,
} from 'lucide-react'

import {
  ThemePreferenceProvider,
  useThemePreference,
  type ThemeSettingsClient,
} from '@/components/theme-preference'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Toaster } from '@/components/ui/toast'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  WorkflowSidebarMenu,
  WorkflowSidebarMenuFallback,
  type WorkflowSidebarClient,
} from '@/components/workflow-sidebar-menu'
import { displayRunId } from '@/lib/run-id'
import type { SettingsSnapshot, WorkflowCatalogEntry } from '@/lib/api-client'
import { cn } from '@/lib/utils'

interface NavigationItem {
  readonly href: string
  readonly icon: LucideIcon
  readonly label: string
}

const navigationItems: readonly NavigationItem[] = [
  { href: '/runs', label: 'Runs', icon: HistoryIcon },
  { href: '/harnesses', label: 'Harnesses', icon: CpuIcon },
  { href: '/repositories', label: 'Repositories', icon: FolderGit2Icon },
]

function isNavigationItemActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/'
  if (href === '/runs') return pathname === href || pathname.startsWith('/runs/')
  return pathname === href
}

function getBreadcrumbs(
  pathname: string,
  selectedWorkflow?: WorkflowCatalogEntry,
): readonly { href: string; label: string }[] {
  if (pathname === '/') {
    return [
      { href: '/', label: 'Workflows' },
      {
        href:
          selectedWorkflow === undefined
            ? '/'
            : `/?workflowId=${encodeURIComponent(selectedWorkflow.workflowId)}`,
        label: selectedWorkflow?.workflowId ?? 'Workflow',
      },
    ]
  }
  if (pathname === '/runs/new') {
    return [
      { href: '/runs', label: 'Runs' },
      { href: '/runs/new', label: 'New run' },
    ]
  }
  if (pathname.startsWith('/runs/')) {
    return [
      { href: '/runs', label: 'Runs' },
      { href: pathname, label: displayRunId(pathname.slice('/runs/'.length)) },
    ]
  }

  const destination = navigationItems.find(({ href }) => href === pathname)
  if (destination !== undefined) return [{ href: destination.href, label: destination.label }]
  if (pathname === '/settings') return [{ href: '/settings', label: 'Settings' }]
  return [{ href: pathname, label: 'Slopify' }]
}

function isEditableShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false
  return Boolean(
    target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'),
  )
}

function NavigationToggle({
  collapsed,
  onToggle,
}: Readonly<{ collapsed: boolean; onToggle: () => void }>) {
  const label = collapsed ? 'Expand navigation' : 'Collapse navigation'
  const Icon = collapsed ? PanelLeftOpenIcon : PanelLeftCloseIcon

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            aria-keyshortcuts="B"
            onClick={onToggle}
            className="border border-transparent text-sidebar-foreground hover:border-sidebar-border hover:bg-accent hover:text-foreground focus-visible:border-input"
          />
        }
      >
        <Icon aria-hidden="true" className="size-4" strokeWidth={1.8} />
      </TooltipTrigger>
      <TooltipContent side="bottom" align={collapsed ? 'start' : 'end'} sideOffset={6}>
        {label} <Kbd>B</Kbd>
      </TooltipContent>
    </Tooltip>
  )
}

function AppShellContent({
  children,
  client,
}: Readonly<{ children: ReactNode; client?: WorkflowSidebarClient | undefined }>) {
  const pathname = usePathname()
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowCatalogEntry | undefined>()
  const { toggleTheme } = useThemePreference()
  const breadcrumbs = getBreadcrumbs(pathname, selectedWorkflow)
  const isSettings = pathname === '/settings'
  const isEditor = pathname === '/'
  const isRunDetail = pathname.startsWith('/runs/') && pathname !== '/runs/new'
  const usesOwnPageSpacing =
    ['/harnesses', '/repositories', '/runs'].includes(pathname) ||
    isEditor ||
    isSettings ||
    isRunDetail

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const shortcut = event.key.toLowerCase()
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        (shortcut !== 'b' && shortcut !== 'd') ||
        isEditableShortcutTarget(event.target)
      ) {
        return
      }

      event.preventDefault()
      if (shortcut === 'b') setIsCollapsed((collapsed) => !collapsed)
      else void toggleTheme()
    }

    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [toggleTheme])

  return (
    <div className="flex h-svh overflow-hidden bg-background font-sans text-foreground transition-colors duration-150">
      <aside
        data-surface="base"
        className={cn(
          'flex h-svh shrink-0 flex-col border-r border-sidebar-border bg-background transition-[width,background-color,border-color] duration-150 ease-out',
          isCollapsed ? 'w-14' : 'w-64',
        )}
      >
        <div
          className={cn(
            'flex h-14 shrink-0 items-center justify-between border-b border-sidebar-border',
            isCollapsed ? 'px-3.5' : 'px-4',
          )}
        >
          <Link
            href="/"
            prefetch={false}
            aria-label="Slopify"
            className={cn(
              'flex min-w-0 items-center gap-2.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/30',
              isCollapsed && 'mx-auto',
            )}
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-card text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
              <WorkflowIcon aria-hidden="true" className="size-3.5" strokeWidth={1.8} />
            </span>
            <span
              className={cn(
                'min-w-0 truncate text-[14px]/5 font-semibold tracking-[-0.01em]',
                isCollapsed && 'sr-only',
              )}
            >
              Slopify
            </span>
          </Link>
          {!isCollapsed && (
            <NavigationToggle collapsed={false} onToggle={() => setIsCollapsed(true)} />
          )}
        </div>

        <nav
          aria-label="Primary navigation"
          data-state={isCollapsed ? 'collapsed' : 'expanded'}
          className={cn('min-h-0 flex-1 overflow-y-auto py-4', isCollapsed ? 'px-2.5' : 'px-3')}
        >
          <ul className="space-y-0.5">
            <li>
              <Suspense
                fallback={
                  <WorkflowSidebarMenuFallback collapsed={isCollapsed} editorActive={isEditor} />
                }
              >
                <WorkflowSidebarMenu
                  client={client}
                  collapsed={isCollapsed}
                  editorActive={isEditor}
                  onSelectedWorkflowChange={setSelectedWorkflow}
                />
              </Suspense>
            </li>
            {navigationItems.map(({ href, icon: Icon, label }) => {
              const isActive = isNavigationItemActive(pathname, href)
              return (
                <li key={href}>
                  <Link
                    href={href}
                    prefetch={false}
                    aria-current={isActive ? 'page' : undefined}
                    aria-label={label}
                    title={isCollapsed ? label : undefined}
                    className={cn(
                      'flex h-9 items-center rounded-md text-[14px]/5 outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-sidebar-ring/30',
                      isCollapsed ? 'justify-center px-0' : 'gap-2.5 px-2',
                      isActive
                        ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                        : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                    )}
                  >
                    <Icon aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.8} />
                    <span className={cn('truncate', isCollapsed && 'sr-only')}>{label}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>

        <div
          className={cn(
            'shrink-0 border-t border-sidebar-border py-3',
            isCollapsed ? 'px-2.5' : 'px-3',
          )}
        >
          <Link
            href="/settings"
            prefetch={false}
            aria-label="Settings"
            aria-current={isSettings ? 'page' : undefined}
            title={isCollapsed ? 'Settings' : undefined}
            className={cn(
              'flex h-9 items-center rounded-md text-[14px]/5 outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-sidebar-ring/30',
              isCollapsed ? 'justify-center px-0' : 'gap-2.5 px-2',
              isSettings
                ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
            )}
          >
            <Settings2Icon aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.8} />
            <span className={cn('truncate', isCollapsed && 'sr-only')}>Settings</span>
          </Link>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          data-surface="base"
          className="flex h-14 shrink-0 items-center border-b border-border bg-background px-5 transition-colors duration-150"
        >
          <div className="flex min-w-0 items-center gap-3">
            {isCollapsed && (
              <>
                <NavigationToggle collapsed onToggle={() => setIsCollapsed(false)} />
                <span aria-hidden="true" className="h-4 w-px bg-border" />
              </>
            )}
            <nav aria-label="Breadcrumb" className="min-w-0">
              <ol className="flex min-w-0 items-center gap-1.5 text-[14px]/5">
                {breadcrumbs.map((breadcrumb, index) => {
                  const isCurrent = index === breadcrumbs.length - 1
                  return (
                    <li key={`${breadcrumb.href}-${breadcrumb.label}`} className="contents">
                      {index > 0 && (
                        <ChevronRightIcon
                          aria-hidden="true"
                          className="hidden size-3.5 shrink-0 text-muted-foreground/80 sm:block"
                          strokeWidth={1.8}
                        />
                      )}
                      <Link
                        href={breadcrumb.href}
                        aria-current={isCurrent ? 'page' : undefined}
                        className={cn(
                          '-mx-1.5 min-w-0 truncate rounded-md px-1.5 py-1 outline-none transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30',
                          !isCurrent && 'hidden text-muted-foreground sm:block',
                          isCurrent && 'font-medium tracking-[-0.01em] text-foreground',
                        )}
                      >
                        {breadcrumb.label}
                      </Link>
                    </li>
                  )
                })}
              </ol>
            </nav>
          </div>
        </header>

        <main
          data-surface="base"
          className={cn(
            'relative min-h-0 flex-1 bg-background transition-colors duration-150',
            isRunDetail || isEditor ? 'overflow-hidden' : 'overflow-auto',
            !usesOwnPageSpacing && 'p-6 sm:p-8',
          )}
        >
          {children}
        </main>
      </div>
    </div>
  )
}

export function AppShell({
  children,
  client,
  initialSettings,
  themeClient,
}: Readonly<{
  children: ReactNode
  client?: WorkflowSidebarClient | undefined
  initialSettings?: SettingsSnapshot | undefined
  themeClient?: ThemeSettingsClient | undefined
}>) {
  return (
    <TooltipProvider>
      <ThemePreferenceProvider client={themeClient} initialSettings={initialSettings}>
        <AppShellContent client={client}>{children}</AppShellContent>
        <Toaster />
      </ThemePreferenceProvider>
    </TooltipProvider>
  )
}
