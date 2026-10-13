/** Shared engine types. Plain typed arrays only: the engine never touches three.js or the DOM. */

export interface MeshData {
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
}

/** A welded triangle mesh for export and for volume checks. No normals: exporters derive them. */
export interface SolidMesh {
  positions: Float64Array
  indices: Uint32Array
}

export interface Range {
  min: number
  max: number
}
