const shellArgument = (value: string): string =>
  /^[A-Za-z0-9_./:-]+$/u.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`

export const formatSessionCommand = (executable: string, args: readonly string[]): string =>
  [executable, ...args].map(shellArgument).join(' ')
