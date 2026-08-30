import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'me.salvadev.des3d',
  appName: 'Dés 3D',
  webDir: 'dist',
  backgroundColor: '#10131a',
  android: { allowMixedContent: false },
  ios: { contentInset: 'never' },
}

export default config
