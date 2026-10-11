import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'

// React Testing Library only auto-cleans with vitest globals; unmount rendered trees between tests.
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
afterEach(() => cleanup())
