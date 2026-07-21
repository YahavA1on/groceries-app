import { useCallback, useEffect, useMemo, useState } from 'react'
import { applyRelatedRatings, fetchFamilyRatingOverview } from '../lib/foodData'
import { replaceStateWhenChanged } from '../lib/stateUpdates'

export function useFamilyRatings(session, foods) {
  const storageKey = `groceries_rating_view_${session.family_id || 'none'}`
  const [overview, setOverview] = useState({ members: [], rows: [] })
  const [selectedMemberId, setSelectedMemberIdState] = useState(() => localStorage.getItem(storageKey) || '')

  const refreshRatings = useCallback(async () => {
    if (!session.family_id) return
    const result = await fetchFamilyRatingOverview(session)
    if (!result.error) replaceStateWhenChanged(setOverview, result.data)
  }, [session])

  useEffect(() => {
    const timeoutId = setTimeout(refreshRatings, 0)
    const intervalId = setInterval(refreshRatings, 15_000)
    return () => {
      clearTimeout(timeoutId)
      clearInterval(intervalId)
    }
  }, [refreshRatings])

  const effectiveSelectedMemberId = useMemo(() => {
    if (overview.members.length === 0) return ''
    const memberExists = overview.members.some((member) => member.user_id === selectedMemberId)
    if (session.role === 'shopper' && (selectedMemberId === 'all' || memberExists)) return selectedMemberId
    const ownMember = overview.members.find((member) => member.user_id === session.user_id)
    return session.role === 'shopper' ? overview.members[0].user_id : ownMember?.user_id || overview.members[0].user_id
  }, [overview.members, selectedMemberId, session.role, session.user_id])

  const setSelectedMemberId = useCallback((value) => {
    localStorage.setItem(storageKey, value)
    setSelectedMemberIdState(value)
  }, [storageKey])

  const view = useMemo(
    () => buildFamilyRatingView(foods, overview, effectiveSelectedMemberId),
    [effectiveSelectedMemberId, foods, overview]
  )
  const ownRatings = useMemo(() => {
    const ownRows = overview.rows.filter((row) => row.user_id === session.user_id)
    const exactRatings = Object.fromEntries(ownRows.map((row) => [row.food_id, Number(row.rating)]))
    return applyRelatedRatings(foods, exactRatings, ownRows)
  }, [foods, overview.rows, session.user_id])

  return {
    ...view,
    members: overview.members,
    ownRatings,
    refreshRatings,
    selectedMemberId: effectiveSelectedMemberId,
    setSelectedMemberId,
  }
}

function buildFamilyRatingView(foods, overview, selectedMemberId) {
  const ratingsByMember = new Map()
  for (const member of overview.members) {
    const memberRows = overview.rows.filter((row) => row.user_id === member.user_id)
    const exactRatings = Object.fromEntries(memberRows.map((row) => [row.food_id, Number(row.rating)]))
    ratingsByMember.set(member.user_id, applyRelatedRatings(foods, exactRatings, memberRows))
  }

  const detailsByFood = {}
  const commonGroundFoodIds = new Set()
  const combinedRatings = {}

  for (const food of foods) {
    const details = overview.members.flatMap((member) => {
      const rating = Number(ratingsByMember.get(member.user_id)?.[food.id])
      return Number.isFinite(rating) ? [{ userId: member.user_id, username: member.username, rating }] : []
    })
    detailsByFood[food.id] = details
    if (overview.members.length >= 2
      && details.length === overview.members.length
      && new Set(details.map((item) => item.rating)).size === 1) {
      commonGroundFoodIds.add(food.id)
    }
    if (details.length > 0) {
      combinedRatings[food.id] = Math.round(details.reduce((sum, item) => sum + item.rating, 0) / details.length)
    }
  }

  const allSelected = selectedMemberId === 'all'
  return {
    allSelected,
    commonGroundFoodIds,
    detailsByFood,
    ratings: allSelected ? combinedRatings : ratingsByMember.get(selectedMemberId) || {},
  }
}
