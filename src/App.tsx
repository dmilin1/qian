import { createHashRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { AppProvider } from './components/AppProvider'
import { PwaUpdater } from './components/PwaUpdater'
import { routes } from './components/routes'

// Hash routing (/qian/#/words) works on GitHub Pages without a 404 fallback.
const router = createHashRouter(routes)

export default function App() {
  return (
    <AppProvider>
      <RouterProvider router={router} />
      <PwaUpdater />
    </AppProvider>
  )
}
