/**
 * The clip's views on the server (DECISIONS.md 128): `mathcreator_projects.shots` holds the plan, in its own
 * column so the path's saves never overwrite it. The device keeps a copy, so the list works without a connection.
 */
import { parsePlan, serializePlan, type ShotPlan } from '../capture/shots'
import { supabase } from './supabase'

export async function loadShots(projectId: string): Promise<ShotPlan | null> {
  const res = await supabase.from('mathcreator_projects').select('shots').eq('id', projectId).maybeSingle()
  if (res.error || !res.data?.shots) return null
  return parsePlan(JSON.stringify(res.data.shots))
}

export async function saveShots(projectId: string, plan: ShotPlan | null): Promise<void> {
  const shots = plan && plan.shots.length ? JSON.parse(serializePlan(plan)) : null
  const res = await supabase.from('mathcreator_projects').update({ shots }).eq('id', projectId)
  if (res.error) throw new Error(res.error.message)
}
