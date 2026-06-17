// ItemMedia.jsx
// Handles image upload/display and location display for an inventory item.
// Used as a modal triggered from the Inventory table row.

import { useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { Camera, MapPin, Upload, X, Trash2, Loader, Image as ImageIcon } from 'lucide-react'
import toast from 'react-hot-toast'
import Modal from './ui/Modal'
import Button from './ui/Button'

// ── Image modal ───────────────────────────────────────────
export function ImageModal({ item, onClose, onUpdate }) {
  const [uploading, setUploading] = useState(false)
  const [deleting,  setDeleting]  = useState(false)
  const fileRef = useRef(null)

  const handleUpload = async (file) => {
    if (!file) return
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) {
      toast.error('Only JPG, PNG, WEBP images allowed')
      return
    }
    if (file.size > 5 * 1024 * 1024) { toast.error('Image must be under 5MB'); return }
    setUploading(true)
    try {
      const ext  = file.name.split('.').pop() || 'jpg'
      const path = `${item.id}.${ext}`

      const { error: uploadErr } = await supabase.storage
        .from('item-images')
        .upload(path, file, { upsert: true, contentType: file.type })
      if (uploadErr) throw uploadErr

      const { data: { publicUrl } } = supabase.storage
        .from('item-images')
        .getPublicUrl(path)

      // Append cache-buster so browser doesn't show old image
      const url = `${publicUrl}?t=${Date.now()}`

      const { error: dbErr } = await supabase.from('items').update({ image_url: url }).eq('id', item.id)
      if (dbErr) throw dbErr

      onUpdate({ ...item, image_url: url })
      toast.success('Image uploaded')
    } catch (err) {
      toast.error('Upload failed: ' + err.message)
    }
    setUploading(false)
  }

  const handleDelete = async () => {
    if (!confirm('Remove this image?')) return
    setDeleting(true)
    try {
      await supabase.from('items').update({ image_url: null }).eq('id', item.id)
      onUpdate({ ...item, image_url: null })
      toast.success('Image removed')
    } catch (err) {
      toast.error(err.message)
    }
    setDeleting(false)
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Item Photo — ${item.name}`}
      size="sm"
      footer={
        <div className="flex gap-2 w-full">
          {item.image_url && (
            <Button variant="danger" onClick={handleDelete} loading={deleting}>
              <Trash2 className="w-4 h-4" /> Remove Photo
            </Button>
          )}
          <div className="flex-1" />
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button onClick={() => fileRef.current?.click()} loading={uploading}>
            <Upload className="w-4 h-4" />
            {item.image_url ? 'Replace Photo' : 'Upload Photo'}
          </Button>
        </div>
      }
    >
      <input
        ref={fileRef} type="file" accept="image/*" className="hidden"
        onChange={e => handleUpload(e.target.files?.[0])}
      />

      {uploading ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Loader className="w-10 h-10 text-teal-400 animate-spin" />
          <p className="text-slate-400 text-sm">Uploading image…</p>
        </div>
      ) : item.image_url ? (
        <div className="space-y-3">
          <img
            src={item.image_url}
            alt={item.name}
            className="w-full max-h-80 object-contain rounded-xl bg-slate-700/40"
            onError={e => { e.target.style.display='none' }}
          />
          <div className="bg-slate-700/30 rounded-lg p-3 text-sm text-slate-400">
            <p><strong className="text-slate-300">Item:</strong> {item.name}</p>
            <p><strong className="text-slate-300">Part #:</strong> {item.part_number}</p>
            {item.stores?.name && <p><strong className="text-slate-300">Store:</strong> {item.stores.name}</p>}
          </div>
        </div>
      ) : (
        <div
          onClick={() => fileRef.current?.click()}
          className="flex flex-col items-center justify-center py-16 cursor-pointer border-2 border-dashed border-slate-600 hover:border-teal-500 rounded-xl transition-colors hover:bg-teal-900/10"
        >
          <Camera className="w-12 h-12 text-slate-500 mb-3" />
          <p className="text-slate-300 font-medium">No photo uploaded yet</p>
          <p className="text-slate-500 text-sm mt-1">Click to upload a photo of this item</p>
          <p className="text-slate-600 text-xs mt-2">JPG, PNG, WEBP · Max 5MB</p>
        </div>
      )}
    </Modal>
  )
}

// ── Location modal ────────────────────────────────────────
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
