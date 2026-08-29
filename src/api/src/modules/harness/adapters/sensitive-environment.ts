const MAX_SENSITIVE_ENVIRONMENT_VALUES = 256
const MAX_SENSITIVE_ENVIRONMENT_VALUE_LENGTH = 16_384
const SECRET_LIKE_ENVIRONMENT_KEY = /(?:token|key|secret|password|credential|auth)/iu

export const sensitiveEnvironmentValues = (
  environment: Readonly<NodeJS.ProcessEnv>,
): readonly string[] =>
  [
    ...new Set(
      Object.entries(environment)
        .filter(
          ([key, value]) =>
            SECRET_LIKE_ENVIRONMENT_KEY.test(key) &&
            typeof value === 'string' &&
            value.length > 0 &&
            value.length <= MAX_SENSITIVE_ENVIRONMENT_VALUE_LENGTH,
        )
        .map(([, value]) => value as string),
    ),
  ].slice(0, MAX_SENSITIVE_ENVIRONMENT_VALUES)
