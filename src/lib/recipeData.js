import { supabase, supabaseKey, supabaseUrl } from './supabase'

const recipeFunctionUrl = `${supabaseUrl}/functions/v1/recipe-suggestions`

export async function fetchRecipeSuggestions(session) {
  const parameters = {
    p_session_token: session.token,
  }
  const result = await supabase.rpc('list_enabled_family_recipe_suggestions', parameters)
  return result.error?.code === 'PGRST202'
    ? supabase.rpc('list_family_recipe_suggestions', parameters)
    : result
}

export async function refreshRecipeSuggestions(session) {
  const response = await fetch(recipeFunctionUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      apikey: supabaseKey,
    },
    body: JSON.stringify({ session_token: session.token }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload?.error || `Recipe service returned ${response.status}`)
  return payload
}

export async function chooseRecipe(session, recipeId) {
  const parameters = {
    p_session_token: session.token,
    p_recipe_id: recipeId,
  }
  const result = await supabase.rpc('choose_enabled_family_recipe', parameters)
  return result.error?.code === 'PGRST202'
    ? supabase.rpc('choose_family_recipe', parameters)
    : result
}
