import { supabase, supabaseKey, supabaseUrl } from './supabase'

const recipeFunctionUrl = `${supabaseUrl}/functions/v1/recipe-suggestions`

export async function fetchRecipeSuggestions(session) {
  return supabase.rpc('list_family_recipe_suggestions', {
    p_session_token: session.token,
  })
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
  return supabase.rpc('choose_family_recipe', {
    p_session_token: session.token,
    p_recipe_id: recipeId,
  })
}
