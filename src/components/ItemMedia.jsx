// ItemMedia.jsx
// Handles image upload/display (up to 3 photos, auto-compressed to <300 KB) and
// location editing for an inventory item. Used as modals from the Inventory table.

import { useState, useRef, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Camera, MapPin, Upload, Trash2, Loader } from 'lucide-react'
import toast from 'react-hot-toast'
import Modal from './ui/Modal'
import Button from './ui/Button'
import { compressImage } from '../lib/imageCompress'
import { listItemImages, uploadItemImage, removeItemImage, MAX_IMAGES } from '../lib/itemImages'
import { logItemActivity, currentActor } from '../lib/activity'

// ── Image modal (up to 3 photos, auto-compressed to <300 KB) ────────────────
export function ImageModal({ item, onClose, onUpdate }) {
  const [images,    setImages]    = useState([])
  const [loading,   setLoading]   = useState(true)
  const [uploading, setUploading] = useState(false)
  const [busyId,    setBusyId]    = useState(null)
  const fileRef = useRef(null)

  const refresh = async () => {
    const imgs = await listItemImages(item.id)
    setImages(imgs)
    setLoading(false)
    onUpdate?.({ ...item, image_url: imgs[0]?.url || null })
  }
  useEffect(() => { refresh() }, [item.id])

  const handleUpload = async (fileList) => {
    const files = Array.from(fileList || [])
    if (!files.length) return
    const room = MAX_IMAGES - images.length
    if (room <= 0) { toast.error(`Maximum ${MAX_IMAGES} photos per item.`); return }
    const toAdd = files.slice(0, room)
    if (files.length > room) toast(`Only ${room} more photo${room > 1 ? 's' : ''} allowed — extra ignored.`)

    setUploading(true)
    try {
      const actor = await currentActor()
      for (const file of toAdd) {
        if (!file.type.startsWith('image/')) { toast.error(`${file.name}: not an image`); continue }
        const { file: compressed, bytes } = await compressImage(file)   // → JPEG < 300 KB
        await uploadItemImage(item.id, compressed, { createdBy: actor })
        await logItemActivity(item.id, 'photo_added', `Photo added (${Math.round(bytes / 1024)} KB)`)
      }
      toast.success('Photo optimised & uploaded')
      await refresh()
    } catch (err) {
      toast.error('Upload failed: ' + err.message)
    }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleDelete = async (img) => {
    if (!confirm('Remove this photo?')) return
    setBusyId(img.id)
    try {
      await removeItemImage(img)
      await logItemActivity(item.id, 'photo_removed', 'Photo removed')
      toast.success('Photo removed')
      await refresh()
    } catch (err) {
      toast.error(err.message)
    }
    setBusyId(null)
  }

  const full = images.length >= MAX_IMAGES

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Item Photos — ${item.name}`}
      size="sm"
      footer={
        <div className="flex gap-2 w-full">
          <span className="text-xs text-slate-500 self-center">{images.length}/{MAX_IMAGES} photos</span>
          <div className="flex-1" />
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button onClick={() => fileRef.current?.click()} loading={uploading} disabled={full}>
            <Upload className="w-4 h-4" /> Add Photo{full ? ' (max)' : ''}
          </Button>
        </div>
      }
    >
      <input
        ref={fileRef} type="file" accept="image/*" multiple className="hidden"
        onChange={e => handleUpload(e.target.files)}
      />

      {loading ? (
        <div className="flex justify-center py-16"><Loader className="w-8 h-8 text-teal-400 animate-spin" /></div>
      ) : (
        <div className="space-y-3">
          {images.length === 0 && !uploading && (
            <div
              onClick={() => fileRef.current?.click()}
              className="flex flex-col items-center justify-center py-14 cursor-pointer border-2 border-dashed border-slate-600 hover:border-teal-500 rounded-xl transition-colors hover:bg-teal-900/10"
            >
              <Camera className="w-12 h-12 text-slate-500 mb-3" />
              <p className="text-slate-300 font-medium">No photos yet</p>
              <p className="text-slate-500 text-sm mt-1">Add up to {MAX_IMAGES} photos of this item</p>
              <p className="text-slate-600 text-xs mt-2">Any size — auto-optimised to under 300 KB</p>
            </div>
          )}

          {images.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {images.map((img, i) => (
                <div key={img.id} className="relative group rounded-xl overflow-hidden bg-slate-700/40 aspect-square">
                  <img src={img.url} alt={item.name} className="w-full h-full object-cover"
                       onError={e => { e.target.style.opacity = 0.2 }} />
                  {i === 0 && <span className="absolute top-1 left-1 text-[10px] bg-teal-600 text-white px-1.5 py-0.5 rounded">Primary</span>}
                  <button
                    onClick={() => handleDelete(img)}
                    disabled={busyId === img.id}
                    className="absolute top-1 right-1 p-1 rounded-lg bg-black/60 text-white hover:bg-red-600 transition-colors"
                    title="Remove photo"
                  >
                    {busyId === img.id ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  </button>
                </div>
              ))}
            </div>
          )}

          {uploading && (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Loader className="w-4 h-4 text-teal-400 animate-spin" /> Optimising & uploading…
            </div>
          )}

          <div className="bg-slate-700/30 rounded-lg p-3 text-xs text-slate-400">
            <p><strong className="text-slate-300">Part #:</strong> {item.part_number}{item.stores?.name && <> · <strong className="text-slate-300">Store:</strong> {item.stores.name}</>}</p>
            <p className="mt-1 text-slate-500">Photos are compressed to under 300 KB automatically — upload originals of any size.</p>
          </div>
        </div>
      )}
    </Modal>
  )
}

// ── Location modal ──────────────────────────────────────────────────────────
export function LocationModal({ item, onClose, onUpdate }) {
  const [location, setLocation] = useState(item.location || '')
  const [saving,   setSaving]   = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      const { error } = await supabase.from('items').update({ location }).eq('id', item.id)
      if (error) throw error
      onUpdate({ ...item, location })
      toast.success('Location saved')
      onClose()
    } catch (err) {
      toast.error(err.message)
    }
    setSaving(false)
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Item Location — ${item.name}`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} loading={saving}>Save Location</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="bg-slate-700/30 rounded-xl p-3 text-sm text-slate-400">
          <p className="font-medium text-slate-300 mb-1">{item.name}</p>
          <p>{item.part_number} · {item.stores?.name}</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">Location in Store</label>
          <input
            className="input"
            value={location}
            onChange={e => setLocation(e.target.value)}
            placeholder="e.g. Shelf B3, Row 2 — Bottom freezer, right side"
            autoFocus
          />
          <p className="text-slate-500 text-xs mt-1.5">
            Describe exactly where this item is stored so staff can find it quickly.
          </p>
        </div>
        {location && (
          <div className="bg-teal-900/20 border border-teal-700/30 rounded-xl p-3 flex gap-2">
            <MapPin className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
            <p className="text-sm text-teal-300">{location}</p>
          </div>
        )}
        <div className="text-xs text-slate-500 space-y-0.5">
          <p>💡 Examples:</p>
          <p>• "Shelf A2, 3rd row from top"</p>
          <p>• "Freezer 1 – bottom shelf, left side"</p>
          <p>• "Dry store, bin labelled BEV"</p>
        </div>
      </div>
    </Modal>
  )
}
