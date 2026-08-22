'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import {
  BookOpenIcon,
  ChevronRightIcon,
  CpuIcon,
  HistoryIcon,
  FolderGit2Icon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PlugIcon,
  Settings2Icon,
  WorkflowIcon,
  type LucideIcon,
} from 'lucide-react'

import { ThemePreferenceProvider, useThemePreference } from '@/components/theme-preference'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Toaster } from '@/components/ui/toast'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { displayRunId } from '@/lib/run-id'
import { cn } from '@/lib/utils'

interface NavigationItem {
  readonly href: string
  readonly icon: LucideIcon
  readonly label: string
}

const navigationSections: readonly { label: string; items: readonly NavigationItem[] }[] = [
  {
    label: 'Workflow',
    items: [
      { href: '/', label: 'Editor', icon: WorkflowIcon },
      { href: '/runs', label: 'Runs', icon: HistoryIcon },
    ],
  },
  {
    label: 'Configuration',
    items: [
      { href: '/providers', label: 'Providers', icon: CpuIcon },
      { href: '/connectors', label: 'Connectors', icon: PlugIcon },
      { href: '/skills', label: 'Skills', icon: BookOpenIcon },
      { href: '/projects', label: 'Projects', icon: FolderGit2Icon },
    ],
  },
]

function isNavigationItemActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/'
  if (href === '/runs') return pathname === href || pathname.startsWith('/runs/')
  return pathname === href
}

function getBreadcrumbs(pathname: string): readonly { href: string; label: string }[] {
  if (pathname === '/') {
    return [
      { href: '/', label: 'Workflow' },
      { href: '/', label: 'Editor' },
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

  const destination = navigationSections
    .flatMap(({ items }) => items)
    .find(({ href }) => href === pathname)
  if (destination !== undefined) return [{ href: destination.href, label: destination.label }]
  if (pathname === '/preferences') return [{ href: '/preferences', label: 'Preferences' }]
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

function AppShellContent({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname()
  const [isCollapsed, setIsCollapsed] = useState(false)
  const { toggleTheme } = useThemePreference()
  const breadcrumbs = getBreadcrumbs(pathname)
  const isPreferences = pathname === '/preferences'
  const isEditor = pathname === '/'
  const isRunDetail = pathname.startsWith('/runs/') && pathname !== '/runs/new'
  const usesOwnPageSpacing =
    ['/providers', '/connectors', '/skills', '/projects', '/runs'].includes(pathname) ||
    isEditor ||
    isPreferences ||
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
      else toggleTheme()
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
          {navigationSections.map((section, sectionIndex) => (
            <div
              key={section.label}
              className={cn(sectionIndex > 0 && (isCollapsed ? 'mt-3 border-t pt-3' : 'mt-5'))}
            >
              <p
                className={cn(
                  'mb-2 px-2 text-[11px]/4 font-medium tracking-[0.08em] text-muted-foreground uppercase',
                  isCollapsed && 'sr-only',
                )}
              >
                {section.label}
              </p>
              <ul className="space-y-0.5">
                {section.items.map(({ href, icon: Icon, label }) => {
                  const isActive = isNavigationItemActive(pathname, href)
                  return (
                    <li key={href}>
                      <Link
                        href={href}
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
            </div>
          ))}
        </nav>

        <div
          className={cn(
            'shrink-0 border-t border-sidebar-border py-3',
            isCollapsed ? 'px-2.5' : 'px-3',
          )}
        >
          <Link
            href="/preferences"
            aria-label="Preferences"
            aria-current={isPreferences ? 'page' : undefined}
            title={isCollapsed ? 'Preferences' : undefined}
            className={cn(
              'flex h-9 items-center rounded-md text-[14px]/5 outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-sidebar-ring/30',
              isCollapsed ? 'justify-center px-0' : 'gap-2.5 px-2',
              isPreferences
                ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
            )}
          >
            <Settings2Icon aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.8} />
            <span className={cn('truncate', isCollapsed && 'sr-only')}>Preferences</span>
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

export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <TooltipProvider>
      <ThemePreferenceProvider>
        <AppShellContent>{children}</AppShellContent>
        <Toaster />
      </ThemePreferenceProvider>
    </TooltipProvider>
  )
}
