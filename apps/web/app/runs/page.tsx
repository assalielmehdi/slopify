import { RunHistory } from '@/components/runs/run-history'

export default async function RunsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ page?: string | string[] }> }>) {
  const rawPage = (await searchParams).page
  const parsedPage = typeof rawPage === 'string' ? Number(rawPage) : Number.NaN
  const page = Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1

  return <RunHistory page={page} />
}
