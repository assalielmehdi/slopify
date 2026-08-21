'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import {
  BotIcon,
  BookOpenIcon,
  BoxesIcon,
  CpuIcon,
  HistoryIcon,
  PlugIcon,
  WorkflowIcon,
} from 'lucide-react'

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
import { ThemeToggle } from '@/components/theme-toggle'

const navigationSections = [
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
      { href: '/agent-profiles', label: 'Agent profiles', icon: BotIcon },
      { href: '/project-profiles', label: 'Project profiles', icon: BoxesIcon },
    ],
  },
] as const

type NavigationItem = (typeof navigationSections)[number]['items'][number]

function isNavigationItemActive(pathname: string, href: NavigationItem['href']) {
  if (href === '/') return pathname === '/' || pathname === '/runs/new'
  if (href === '/runs') {
    return pathname === href || (pathname.startsWith('/runs/') && pathname !== '/runs/new')
  }
  return pathname === href
}

function getRouteTitle(pathname: string) {
  if (pathname === '/runs/new') return 'New run'
  if (pathname === '/runs') return 'Runs'
  if (pathname.startsWith('/runs/')) return 'Run detail'
  if (pathname === '/providers') return 'Providers'
  if (pathname === '/connectors') return 'Connectors'
  if (pathname === '/skills') return 'Skills'
  if (pathname === '/agent-profiles') return 'Agent profiles'
  if (pathname === '/project-profiles' || pathname === '/settings') return 'Project profiles'
  return 'Editor'
}

export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname()

  return (
    <TooltipProvider>
      <SidebarProvider>
        <Sidebar collapsible="icon">
          <SidebarHeader className="px-3 py-3">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  size="lg"
                  tooltip="Slopify"
                  render={<Link href="/" aria-label="Slopify" />}
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm shadow-primary/20">
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
            {navigationSections.map((section) => (
              <SidebarGroup key={section.label}>
                <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
                <nav aria-label={section.label}>
                  <SidebarMenu>
                    {section.items.map(({ href, icon: Icon, label }) => {
                      const isActive = isNavigationItemActive(pathname, href)

                      return (
                        <SidebarMenuItem key={href}>
                          <SidebarMenuButton
                            isActive={isActive}
                            tooltip={label}
                            render={
                              <Link href={href} aria-current={isActive ? 'page' : undefined} />
                            }
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
            ))}
          </SidebarContent>
          <SidebarRail />
        </Sidebar>
        <SidebarInset>
          <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center border-b bg-background/85 backdrop-blur-xl supports-backdrop-filter:bg-background/75">
            <div className="flex w-full items-center justify-between gap-4 px-4 sm:px-6">
              <div className="flex items-center gap-2">
                <SidebarTrigger className="-ml-1" />
                <Separator orientation="vertical" className="h-4 data-vertical:self-auto" />
                <h1 className="text-sm/5 font-semibold tracking-[-0.01em]">
                  {getRouteTitle(pathname)}
                </h1>
              </div>
              <ThemeToggle />
            </div>
          </header>
          <main className="flex flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
