// Route table. Hash routing (/qian/#/words) is created in src/App.tsx; tests use
// createMemoryRouter(routes).
import { lazy } from 'react'
import { Navigate, type RouteObject } from 'react-router'
import SettingsPage from '../features/settings/SettingsPage'
import StudyPage from '../features/study/StudyPage'
import WordDetailPage from '../features/words/WordDetailPage'
import WordsPage from '../features/words/WordsPage'
import { AppShell } from './AppShell'
import { RouteError } from './RouteError'

// Stats pulls in recharts; load it on demand to keep the study screen's bundle small.
// oxlint-disable-next-line react/only-export-components -- route table module, not an HMR boundary
const StatsPage = lazy(() => import('../features/stats/StatsPage'))

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <StudyPage /> },
      { path: 'words', element: <WordsPage /> },
      { path: 'words/:id', element: <WordDetailPage /> },
      { path: 'stats', element: <StatsPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]
