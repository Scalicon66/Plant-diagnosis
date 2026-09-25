// ─── POST /api/diagnose ───────────────────────────────────────────────────────
// Receives { image_url, diagnosis_id } as JSON.
// Fetches the image, converts to base64, calls the Claude vision analysis,
// and updates the diagnosis row to status='complete' (or 'error' on failure).
//
// Has a 25-second hard timeout to avoid serverless function timeouts.

import { NextRequest } from 'next/server'
import { analyzePlantImage } from '@/lib/gemini'
import { updateDiagnosis } from '@/lib/insforge'

// Map of file extensions → MIME types for the Anthropic API
const MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
}

function getMimeFromUrl(url: string): string {
  const ext = url.split('.').pop()?.toLowerCase() ?? 'jpg'
  return MIME_MAP[ext] ?? 'image/jpeg'
}

export async function POST(request: NextRequest) {
  let diagnosis_id: string | undefined

  try {
    // TODO 14 ── Parse the JSON body
    const body = await request.json()
    const { image_url, diagnosis_id: id } = body as { image_url?: string; diagnosis_id?: string }
    if(!image_url || !id) {
      return Response.json(
        { error: 'Missing image_url or diagnosis_id' }, 
        { status: 400 }
      )
    }
    diagnosis_id = id

    // TODO 15 ── Set up a 25-second timeout race
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Analysis timed out. Please try again.')), 25000)
    )

    // TODO 16 ── Build the analysis promise
    const analysisPromise = async () => {
      // 1. Fetch the image from `image_url` and convert to base64
      const imageResponse = await fetch(image_url)
      if (!imageResponse.ok) {
        throw new Error(`Failed to fetch image: ${imageResponse.statusText}`)
      }
      const arrayBuffer = await imageResponse.arrayBuffer()
      const base64 = Buffer.from(arrayBuffer).toString('base64')
      const mimeType = getMimeFromUrl(image_url) 

      // 2. Call analyzePlantImage(base64, mimeType)
      return analyzePlantImage(base64, mimeType)
    }

    // TODO 17 ── Race the analysis against the timeout
    const analysisResult = await Promise.race([analysisPromise(), timeoutPromise])

    // TODO 18 ── Update the diagnosis row to 'complete'
    const updated = await updateDiagnosis(id, { ...analysisResult, status: 'complete' })
    return Response.json(updated)
    
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[diagnose route]', message)

    // Mark the diagnosis row as 'error' so the UI can show the failure state
    if (diagnosis_id) {
      try {
        await updateDiagnosis(diagnosis_id, { status: 'error' })
      } catch (updateErr) {
        console.error('[diagnose route] failed to mark error status', updateErr)
      }
    }

    if (message === 'Analysis timed out. Please try again.') {
      return Response.json({ error: 'Analysis timed out. Please try again.' }, { status: 504 })
    }

    return Response.json({ error: message }, { status: 500 })
  }
}
