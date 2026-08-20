'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { BookOpenIcon, HistoryIcon, PlayIcon, SettingsIcon, WorkflowIcon } from 'lucide-react'

import { Separator } from '@/components/ui/separator'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'

const navigationItems = [
  { href: '/', label: 'Workflow', icon: WorkflowIcon },
  { href: '/runs/new', label: 'New run', icon: PlayIcon },
  { href: '/runs', label: 'Run history', icon: HistoryIcon },
  { href: '/skills', label: 'Skills', icon: BookOpenIcon },
  { href: '/settings', label: 'Settings', icon: SettingsIcon },
] as const

function isNavigationItemActive(pathname: string, href: (typeof navigationItems)[number]['href']) {
  if (href === '/') return pathname === '/'
  if (href === '/runs/new') return pathname === href
  if (href === '/runs') {
    return pathname === href || (pathname.startsWith('/runs/') && pathname !== '/runs/new')
  }
  return pathname === href
}

function getRouteTitle(pathname: string) {
  if (pathname === '/runs/new') return 'New run'
  if (pathname === '/runs') return 'Run history'
  if (pathname.startsWith('/runs/')) return 'Run detail'
  if (pathname === '/settings') return 'Settings'
  if (pathname === '/skills') return 'Skills'
  return 'Workflow'
}

export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname()

  return (
    <TooltipProvider>
      <SidebarProvider>
        <Sidebar collapsible="icon">
          <SidebarHeader>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  size="lg"
                  tooltip="Slopify"
                  render={<Link href="/" aria-label="Slopify" />}
                >
                  <span className="flex size-8 shrink-0 items-center justify-center bg-primary text-primary-foreground">
                    <WorkflowIcon aria-hidden="true" className="size-4" />
                  </span>
                  <span className="grid min-w-0 flex-1 text-left leading-tight">
                    <span className="truncate text-sm/5 font-semibold">Slopify</span>
                    <span className="truncate text-xs/4 text-sidebar-foreground/70">
                      Local operator
                    </span>
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Workbench</SidebarGroupLabel>
              <nav aria-label="Primary">
                <SidebarMenu>
                  {navigationItems.map(({ href, icon: Icon, label }) => {
                    const isActive = isNavigationItemActive(pathname, href)

                    return (
                      <SidebarMenuItem key={href}>
                        <SidebarMenuButton
                          isActive={isActive}
                          tooltip={label}
                          render={<Link href={href} aria-current={isActive ? 'page' : undefined} />}
                        >
                          <Icon aria-hidden="true" />
                          <span>{label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    )
                  })}
                </SidebarMenu>
              </nav>
            </SidebarGroup>
          </SidebarContent>
          <SidebarRail />
        </Sidebar>
        <SidebarInset>
          <header className="flex h-12 shrink-0 items-center border-b">
            <div className="flex items-center gap-2 px-4">
              <SidebarTrigger className="-ml-1" />
              <Separator orientation="vertical" className="h-4 data-vertical:self-auto" />
              <p className="text-sm/5 font-medium">{getRouteTitle(pathname)}</p>
            </div>
          </header>
          <div className="flex flex-1 flex-col gap-6 p-6">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
