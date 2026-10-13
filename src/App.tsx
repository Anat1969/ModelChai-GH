import { useRoute } from './ui/router'
import { NewConcept } from './ui/screens/NewConcept'
import { Studio } from './ui/screens/Studio'

export function App() {
  return useRoute() === 'studio' ? <Studio /> : <NewConcept />
}
