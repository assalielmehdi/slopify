const processGroupExists = (processId: number): boolean => {
  try {
    process.kill(-processId, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

export const confirmProcessGroupExit = async (
  processId: number,
  timeoutMs: number,
): Promise<boolean> => {
  if (process.platform === 'win32') return true

  const deadline = Date.now() + timeoutMs
  while (processGroupExists(processId)) {
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  return true
}
