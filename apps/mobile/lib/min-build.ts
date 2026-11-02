// Whether this iOS build (its CFBundleVersion) is older than the API's oldest supported one (`AppVersion`). No build
// number (Expo Go, Android) or an unreadable one never blocks.
export const updateRequired = (
  build: string | null | undefined,
  minIosBuild: number
) => Number(build || Number.NaN) < minIosBuild;
