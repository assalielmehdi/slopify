'use client'

import type {
  ConnectorStatus,
  ProjectProfileCatalogResponse,
  ProjectProfileConfiguration,
  ProjectProfileReadiness,
} from '@loop/contracts'
import { PlusIcon, RefreshCwIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import {
  ProfileForm,
  createEmptyProjectProfile,
  type ProjectProfileDraft,
} from '@/components/settings/profile-form'
import { ReadinessPanel } from '@/components/settings/readiness-panel'
import { createApiClient, type ApiClient } from '@/lib/api-client'

const defaultClient = createApiClient()

const disconnected: ConnectorStatus = {
  clickup: false,
  gitlab: false,
  modelProvider: false,
}

export interface ProjectProfileSettingsProps {
  readonly client?: ApiClient
}

export function ProjectProfileSettings({ client = defaultClient }: ProjectProfileSettingsProps) {
  const readinessRequest = useRef(0)
  const [catalog, setCatalog] = useState<ProjectProfileCatalogResponse>()
  const [connectors, setConnectors] = useState<ConnectorStatus>(disconnected)
  const [selectedProfileId, setSelectedProfileId] = useState<string>()
  const [editingProfile, setEditingProfile] = useState<ProjectProfileDraft>()
  const [mode, setMode] = useState<'create' | 'edit'>('edit')
  const [readiness, setReadiness] = useState<ProjectProfileReadiness>()
  const [readinessPending, setReadinessPending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [status, setStatus] = useState<string>()

  useEffect(() => {
    let active = true

    const load = async () => {
      setLoading(true)
      setError(undefined)
      try {
        const [nextCatalog, nextConnectors] = await Promise.all([
          client.listProjectProfiles(),
          client.getConnectorStatus(),
        ])
        if (!active) return
        setCatalog(nextCatalog)
        setConnectors(nextConnectors)

        const firstProfile = nextCatalog.profiles[0]
        if (firstProfile === undefined) {
          setMode('create')
          setEditingProfile(createEmptyProjectProfile())
          return
        }

        setSelectedProfileId(firstProfile.profileId)
        setEditingProfile(firstProfile)
        setReadinessPending(true)
        const request = ++readinessRequest.current
        const nextReadiness = await client.getProjectProfileReadiness(firstProfile.profileId)
        if (active && request === readinessRequest.current) setReadiness(nextReadiness)
      } catch (cause) {
        if (active)
          setError(cause instanceof Error ? cause.message : 'Settings could not be loaded.')
      } finally {
        if (active) {
          setLoading(false)
          setReadinessPending(false)
        }
      }
    }

    void load()
    return () => {
      active = false
      readinessRequest.current += 1
    }
  }, [client])

  const loadReadiness = async (profileId: string) => {
    const request = ++readinessRequest.current
    setReadiness(undefined)
    setReadinessPending(true)
    try {
      const nextReadiness = await client.getProjectProfileReadiness(profileId)
      if (request === readinessRequest.current) setReadiness(nextReadiness)
    } catch (cause) {
      if (request === readinessRequest.current) {
        setError(cause instanceof Error ? cause.message : 'Readiness could not be checked.')
      }
    } finally {
      if (request === readinessRequest.current) setReadinessPending(false)
    }
  }

  const selectProfile = (profileId: string) => {
    const profile = catalog?.profiles.find((candidate) => candidate.profileId === profileId)
    if (profile === undefined) return
    setMode('edit')
    setSelectedProfileId(profile.profileId)
    setEditingProfile(profile)
    setStatus(undefined)
    setError(undefined)
    void loadReadiness(profile.profileId)
  }

  const startCreating = () => {
    readinessRequest.current += 1
    setMode('create')
    setSelectedProfileId(undefined)
    setEditingProfile(createEmptyProjectProfile())
    setReadiness(undefined)
    setReadinessPending(false)
    setStatus(undefined)
    setError(undefined)
  }

  const save = async (profile: ProjectProfileConfiguration) => {
    setStatus(undefined)
    setError(undefined)
    const saved =
      mode === 'create'
        ? await client.createProjectProfile(profile)
        : await client.updateProjectProfile(profile)

    setCatalog((current) => {
      if (current === undefined) return current
      const existingIndex = current.profiles.findIndex(
        (candidate) => candidate.profileId === saved.profileId,
      )
      const profiles = [...current.profiles]
      if (existingIndex === -1) profiles.push(saved)
      else profiles[existingIndex] = saved
      return { ...current, profiles }
    })
    setMode('edit')
    setSelectedProfileId(saved.profileId)
    setEditingProfile(saved)
    setStatus('Profile saved. Readiness refreshed from the active runtime.')
    await loadReadiness(saved.profileId)
  }

  const repositoryNames = Object.fromEntries(
    (editingProfile?.repositories ?? []).map(({ repositoryId, displayName }) => [
      repositoryId,
      displayName,
    ]),
  )

  return (
    <section className="flex w-full flex-col gap-6">
      {catalog === undefined ? null : (
        <div className="flex flex-wrap items-end justify-end gap-2 rounded-lg border bg-card p-4">
          <Field className="min-w-52">
            <FieldLabel htmlFor="profile-selector">Profile</FieldLabel>
            <NativeSelect
              id="profile-selector"
              onChange={(event) => selectProfile(event.currentTarget.value)}
              value={selectedProfileId ?? ''}
            >
              {mode === 'create' ? (
                <NativeSelectOption value="">New profile</NativeSelectOption>
              ) : null}
              {catalog.profiles.map((profile) => (
                <NativeSelectOption key={profile.profileId} value={profile.profileId}>
                  {profile.displayName}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Button onClick={startCreating} type="button" variant="outline">
            <PlusIcon aria-hidden="true" /> New profile
          </Button>
          {selectedProfileId === undefined ? null : (
            <Button
              disabled={readinessPending}
              onClick={() => void loadReadiness(selectedProfileId)}
              type="button"
              variant="outline"
            >
              <RefreshCwIcon aria-hidden="true" /> Check readiness
            </Button>
          )}
        </div>
      )}

      {error === undefined ? null : (
        <Alert variant="destructive">
          <AlertTitle>Settings unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <p className="sr-only" role="status">
        {status}
      </p>

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading project profiles…</p>
      ) : catalog === undefined ? null : editingProfile === undefined ? (
        <p className="text-xs text-muted-foreground">No profile is selected.</p>
      ) : (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
          <ProfileForm
            key={`${mode}-${editingProfile.profileId}`}
            mode={mode}
            onSave={save}
            profile={editingProfile}
            runtime={catalog.runtime}
          />
          <div className="xl:sticky xl:top-20">
            <ReadinessPanel
              connectors={connectors}
              pending={readinessPending}
              readiness={readiness}
              repositoryNames={repositoryNames}
            />
          </div>
        </div>
      )}
    </section>
  )
}
