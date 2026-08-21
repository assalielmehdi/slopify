'use client'

import { FileTextIcon, PlusIcon, RefreshCwIcon, Trash2Icon } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { createApiClient, type ApiClient, type SkillRecord } from '@/lib/api-client'

const defaultClient = createApiClient()
type SkillsClient = Required<
  Pick<ApiClient, 'listSkills' | 'createSkill' | 'updateSkill' | 'deleteSkill'>
>

export function SkillsManager({
  client = defaultClient as SkillsClient,
}: Readonly<{ client?: SkillsClient }>) {
  const [skills, setSkills] = useState<readonly SkillRecord[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [selectedFile, setSelectedFile] = useState('SKILL.md')
  const [draft, setDraft] = useState('')
  const [creating, setCreating] = useState(false)
  const [pending, setPending] = useState(true)
  const [error, setError] = useState<string>()
  const selected = useMemo(
    () => skills.find(({ skillId }) => skillId === selectedId),
    [selectedId, skills],
  )

  const refresh = async () => {
    setPending(true)
    setError(undefined)
    try {
      const next = await client.listSkills()
      setSkills(next)
      setSelectedId((current) =>
        next.some(({ skillId }) => skillId === current) ? current : next[0]?.skillId,
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Skills could not be loaded.')
    } finally {
      setPending(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [client])

  useEffect(() => {
    const file = selected?.files.find(({ path }) => path === selectedFile) ?? selected?.files[0]
    if (file !== undefined) {
      setSelectedFile(file.path)
      setDraft(file.content)
    }
  }, [selected, selectedFile])

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    try {
      const created = await client.createSkill({
        skillId: String(data.get('skillId')),
        name: String(data.get('skillId')),
        description: String(data.get('description')),
        instructions: String(data.get('instructions')),
      })
      setSkills((current) => [...current, created].sort((a, b) => a.name.localeCompare(b.name)))
      setSelectedId(created.skillId)
      setCreating(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Skill could not be created.')
    }
  }

  const save = async () => {
    if (selected === undefined) return
    try {
      const updated = await client.updateSkill(selected.skillId, {
        expectedDigest: selected.digest,
        files: Object.fromEntries(
          selected.files.map((file) => [
            file.path,
            file.path === selectedFile ? draft : file.content,
          ]),
        ),
      })
      setSkills((current) =>
        current.map((skill) => (skill.skillId === updated.skillId ? updated : skill)),
      )
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `${cause.message} Refresh before retrying; the filesystem may have changed.`
          : 'Skill could not be saved.',
      )
    }
  }

  const remove = async () => {
    if (selected === undefined) return
    try {
      await client.deleteSkill(selected.skillId, selected.digest)
      const remaining = skills.filter(({ skillId }) => skillId !== selected.skillId)
      setSkills(remaining)
      setSelectedId(remaining[0]?.skillId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Skill could not be deleted.')
    }
  }

  return (
    <main className="flex w-full flex-col gap-6">
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => void refresh()} disabled={pending}>
          <RefreshCwIcon aria-hidden="true" /> Refresh filesystem
        </Button>
        <Button onClick={() => setCreating(true)}>
          <PlusIcon aria-hidden="true" /> New skill
        </Button>
      </div>
      {error === undefined ? null : (
        <Alert variant="destructive">
          <AlertTitle>Skills unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {creating ? (
        <Card>
          <CardHeader>
            <CardTitle>Create skill</CardTitle>
            <CardDescription>Creates a new directory with a SKILL.md file.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={(event) => void create(event)}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="skill-id">Skill ID</FieldLabel>
                  <Input id="skill-id" name="skillId" pattern="[a-z0-9._-]+" required />
                </Field>
                <Field>
                  <FieldLabel htmlFor="skill-description">Description</FieldLabel>
                  <Input id="skill-description" name="description" required />
                </Field>
                <Field>
                  <FieldLabel htmlFor="skill-instructions">Instructions</FieldLabel>
                  <Textarea id="skill-instructions" name="instructions" required />
                </Field>
                <div className="flex gap-2">
                  <Button type="submit">Create</Button>
                  <Button type="button" variant="outline" onClick={() => setCreating(false)}>
                    Cancel
                  </Button>
                </div>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      ) : null}
      <div className="grid min-h-[34rem] overflow-hidden rounded-xl border bg-card shadow-xs lg:grid-cols-[17rem_minmax(0,1fr)]">
        <Card className="rounded-none border-0 border-r py-4">
          <CardHeader>
            <CardTitle>Available skills</CardTitle>
            <CardDescription>
              {skills.length} local skill{skills.length === 1 ? '' : 's'}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-1">
            {skills.map((skill) => (
              <Button
                key={skill.skillId}
                variant={skill.skillId === selectedId ? 'secondary' : 'ghost'}
                className="h-auto justify-start py-2 text-left"
                onClick={() => setSelectedId(skill.skillId)}
              >
                <span className="min-w-0">
                  <span className="block truncate">{skill.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {skill.valid ? skill.description : 'Invalid skill'}
                  </span>
                </span>
              </Button>
            ))}
          </CardContent>
        </Card>
        {selected === undefined ? (
          <Card className="rounded-none border-0">
            <CardContent className="pt-6 text-sm text-muted-foreground">
              No skill selected.
            </CardContent>
          </Card>
        ) : (
          <Card className="rounded-none border-0">
            <CardHeader className="flex-row items-start justify-between gap-4">
              <div>
                <CardTitle>{selected.name}</CardTitle>
                <CardDescription>{selected.description}</CardDescription>
              </div>
              <Button variant="destructive" size="sm" onClick={() => void remove()}>
                <Trash2Icon aria-hidden="true" /> Delete
              </Button>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-[14rem_minmax(0,1fr)]">
              <nav
                aria-label="Skill files"
                className="grid content-start gap-1 rounded-md border bg-muted/25 p-2"
              >
                {selected.files.map((file) => (
                  <Button
                    key={file.path}
                    variant={file.path === selectedFile ? 'secondary' : 'ghost'}
                    className="justify-start"
                    onClick={() => {
                      setSelectedFile(file.path)
                      setDraft(file.content)
                    }}
                  >
                    <FileTextIcon aria-hidden="true" /> {file.path}
                  </Button>
                ))}
              </nav>
              <div className="grid gap-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{selectedFile}</p>
                  <code className="text-xs text-muted-foreground">
                    {selected.digest.slice(0, 12)}
                  </code>
                </div>
                <Textarea
                  aria-label="Raw skill file"
                  className="min-h-96 bg-muted/20 font-mono text-sm/6"
                  value={draft}
                  onChange={(event) => setDraft(event.currentTarget.value)}
                />
                <Button className="justify-self-start" onClick={() => void save()}>
                  Save file
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  )
}
