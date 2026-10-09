// Thin client for the review API. Agent routes (/api/agent/*) are not used by the UI.

async function request(path, init) {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : {}
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`)
    err.status = res.status
    err.code = data.code
    throw err
  }
  return data
}

export const fetchConfig = () => request('/api/review/config')

export const fetchDrafts = (status = 'pending_human_review') =>
  request(`/api/review/drafts?status=${encodeURIComponent(status)}`).then((r) => r.drafts)

export const approveDraft = (id, payload) =>
  request(`/api/review/drafts/${id}/approve`, { method: 'POST', body: JSON.stringify(payload) })

export const rejectDraft = (id, reason, reviewer) =>
  request(`/api/review/drafts/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason, reviewer }) })
