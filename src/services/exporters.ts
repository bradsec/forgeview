import * as THREE from 'three'
import { STLExporter } from 'three/addons/exporters/STLExporter.js'
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js'
import { PLYExporter } from 'three/addons/exporters/PLYExporter.js'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { zipSync, strToU8 } from 'three/addons/libs/fflate.module.js'
import { makeSolidGeometries } from './makeSolid'
import type { ExportFormat, ThreeMFUnit } from './exportFormats'
export { EXPORT_FORMATS } from './exportFormats'
export type { ExportFormat, ThreeMFUnit } from './exportFormats'

/**
 * Encode text to bytes for fflate. TextEncoder can come from another realm
 * (jsdom) whose Uint8Array fails fflate's instanceof check, which silently
 * turns file payloads into bogus nested zip directories — re-wrap in this
 * realm's Uint8Array.
 */
function encodeText(text: string): Uint8Array {
  return new Uint8Array(strToU8(text))
}

/**
 * Clone every mesh in the scene with its world transform baked into the
 * geometry. Helpers (grid lines, points-mode companions) are not meshes and
 * drop out naturally; meshes hidden by points view mode are still exported.
 */
export function collectExportMeshes(root: THREE.Object3D, options?: { makeSolid?: boolean }): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = []
  root.updateMatrixWorld(true)

  const collect = (child: THREE.Mesh, matrixWorld: THREE.Matrix4, suffix = '') => {
    if (child instanceof THREE.SkinnedMesh) {
      throw new Error(`Cannot export skinned mesh "${child.name || 'unnamed'}": bake the current pose first`)
    }
    if (child.morphTargetInfluences?.some((influence) => influence !== 0)) {
      throw new Error(`Cannot export morph-deformed mesh "${child.name || 'unnamed'}": bake the current shape first`)
    }
    const geometry = (child.geometry as THREE.BufferGeometry).clone()
    geometry.applyMatrix4(matrixWorld)
    if (matrixWorld.determinant() < 0) reverseWinding(geometry)
    const mesh = new THREE.Mesh(geometry, child.material)
    mesh.name = `${child.name}${suffix}`
    meshes.push(mesh)
  }

  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || !child.geometry) return
    // Make solid collapses the scene into one mesh and leaves attribute-less
    // placeholder geometries behind; they hold nothing exportable.
    const position = (child.geometry as THREE.BufferGeometry).getAttribute('position')
    if (!position || position.count === 0) return
    if (child instanceof THREE.InstancedMesh) {
      const instanceMatrix = new THREE.Matrix4()
      for (let index = 0; index < child.count; index++) {
        child.getMatrixAt(index, instanceMatrix)
        collect(child, new THREE.Matrix4().multiplyMatrices(child.matrixWorld, instanceMatrix), `[${index}]`)
      }
      return
    }
    collect(child, child.matrixWorld)
  })

  if (options?.makeSolid && meshes.length > 0) {
    const solid = makeSolidGeometries(meshes.map((mesh) => mesh.geometry))
    const survivors: THREE.Mesh[] = []
    meshes.forEach((mesh, index) => {
      mesh.geometry.dispose()
      const geometry = solid.geometries[index]
      if (!geometry) return
      mesh.geometry = geometry
      survivors.push(mesh)
    })
    return survivors
  }
  return meshes
}

function reverseWinding(geometry: THREE.BufferGeometry): void {
  if (geometry.index) {
    const index = geometry.index
    for (let offset = 0; offset + 2 < index.count; offset += 3) {
      const second = index.getX(offset + 1)
      index.setX(offset + 1, index.getX(offset + 2))
      index.setX(offset + 2, second)
    }
    index.needsUpdate = true
    return
  }
  for (const attribute of Object.values(geometry.attributes)) {
    for (let offset = 0; offset + 2 < attribute.count; offset += 3) {
      for (let component = 0; component < attribute.itemSize; component++) {
        const second = attribute.getComponent(offset + 1, component)
        attribute.setComponent(offset + 1, component, attribute.getComponent(offset + 2, component))
        attribute.setComponent(offset + 2, component, second)
      }
    }
    attribute.needsUpdate = true
  }
  for (const attributes of Object.values(geometry.morphAttributes)) {
    for (const attribute of attributes) {
      for (let offset = 0; offset + 2 < attribute.count; offset += 3) {
        for (let component = 0; component < attribute.itemSize; component++) {
          const second = attribute.getComponent(offset + 1, component)
          attribute.setComponent(offset + 1, component, attribute.getComponent(offset + 2, component))
          attribute.setComponent(offset + 2, component, second)
        }
      }
      attribute.needsUpdate = true
    }
  }
}

export function disposeExportMeshes(meshes: THREE.Mesh[]): void {
  for (const mesh of meshes) mesh.geometry.dispose()
}

function groupOf(meshes: THREE.Mesh[]): THREE.Group {
  const group = new THREE.Group()
  for (const mesh of meshes) group.add(mesh)
  return group
}

export function exportSTL(meshes: THREE.Mesh[]): Uint8Array {
  const result = new STLExporter().parse(groupOf(meshes), { binary: true }) as unknown as DataView
  return new Uint8Array(result.buffer, result.byteOffset, result.byteLength)
}

export function exportOBJ(meshes: THREE.Mesh[]): Uint8Array {
  return encodeText(new OBJExporter().parse(groupOf(meshes)))
}

export function exportPLY(meshes: THREE.Mesh[]): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    try {
      new PLYExporter().parse(
        groupOf(meshes),
        (result) => {
          resolve(
            typeof result === 'string'
              ? encodeText(result)
              : new Uint8Array(result as ArrayBuffer)
          )
        },
        { binary: true }
      )
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })
}

export async function exportGLB(meshes: THREE.Mesh[]): Promise<Uint8Array> {
  const result = await new GLTFExporter().parseAsync(groupOf(meshes), { binary: true })
  return new Uint8Array(result as ArrayBuffer)
}

/**
 * Hand-rolled 3MF writer (spec: 3MF Core 1.x). A 3MF file is a ZIP with an
 * OPC content-types part, a root relationship pointing at the model part,
 * and one XML model part holding indexed vertices and triangles.
 */
export function export3MF(meshes: THREE.Mesh[], unit: ThreeMFUnit = 'millimeter'): Uint8Array {
  const objectsXml: string[] = []
  const itemsXml: string[] = []

  meshes.forEach((mesh, index) => {
    const id = index + 2 // ids must be >= 1; keep 1 free for future materials
    const source = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry
    const pos = source.getAttribute('position')
    const keyToIndex = new Map<string, number>()
    const vertices: string[] = []
    const triangles: string[] = []
    const triIndex = [0, 0, 0]

    for (let corner = 0; corner < pos.count; corner++) {
      const x = pos.getX(corner)
      const y = pos.getY(corner)
      const z = pos.getZ(corner)
      const key = `${x},${y},${z}`
      let vi = keyToIndex.get(key)
      if (vi === undefined) {
        vi = keyToIndex.size
        keyToIndex.set(key, vi)
        vertices.push(`<vertex x="${x}" y="${y}" z="${z}"/>`)
      }
      triIndex[corner % 3] = vi
      if (corner % 3 === 2) {
        triangles.push(`<triangle v1="${triIndex[0]}" v2="${triIndex[1]}" v3="${triIndex[2]}"/>`)
      }
    }

    objectsXml.push(
      `<object id="${id}" type="model"><mesh><vertices>${vertices.join('')}</vertices><triangles>${triangles.join('')}</triangles></mesh></object>`
    )
    itemsXml.push(`<item objectid="${id}"/>`)
  })

  const modelXml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<model unit="${unit}" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">` +
    `<resources>${objectsXml.join('')}</resources>` +
    `<build>${itemsXml.join('')}</build>` +
    '</model>'

  const contentTypesXml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>' +
    '</Types>'

  const relsXml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>' +
    '</Relationships>'

  return zipSync({
    '[Content_Types].xml': encodeText(contentTypesXml),
    _rels: { '.rels': encodeText(relsXml) },
    '3D': { '3dmodel.model': encodeText(modelXml) },
  })
}

/** Export the given meshes in the requested format. */
export async function exportMeshes(
  meshes: THREE.Mesh[],
  format: ExportFormat,
  options?: { threeMFUnit?: ThreeMFUnit }
): Promise<Uint8Array> {
  if (meshes.length === 0) throw new Error('Nothing to export: the scene has no meshes')
  switch (format) {
    case '.stl':
      return exportSTL(meshes)
    case '.3mf':
      return export3MF(meshes, options?.threeMFUnit)
    case '.obj':
      return exportOBJ(meshes)
    case '.ply':
      return exportPLY(meshes)
    case '.glb':
      return exportGLB(meshes)
  }
}
