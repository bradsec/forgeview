export type ExportFormat = '.stl' | '.3mf' | '.obj' | '.ply' | '.glb'

export type ThreeMFUnit = 'micron' | 'millimeter' | 'centimeter' | 'inch' | 'foot' | 'meter'

export const EXPORT_FORMATS: { format: ExportFormat; label: string }[] = [
  { format: '.stl', label: 'STL (binary)' },
  { format: '.3mf', label: '3MF' },
  { format: '.obj', label: 'OBJ' },
  { format: '.ply', label: 'PLY (binary)' },
  { format: '.glb', label: 'GLB (glTF binary)' },
]

export const THREE_MF_UNITS: { unit: ThreeMFUnit; label: string }[] = [
  { unit: 'millimeter', label: 'Millimetres' },
  { unit: 'centimeter', label: 'Centimetres' },
  { unit: 'meter', label: 'Metres' },
  { unit: 'micron', label: 'Microns' },
  { unit: 'inch', label: 'Inches' },
  { unit: 'foot', label: 'Feet' },
]
