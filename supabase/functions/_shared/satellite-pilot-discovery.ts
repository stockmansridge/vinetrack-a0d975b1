import { exactEarthSearchItem } from './satellite-exact-adapter.ts';
import { validateNativeGrid, type NativeGrid, type ExactManifest } from './satellite-ingestion-core.ts';
export const EARTH_SEARCH_URL='https://earth-search.aws.element84.com/v1/search';
export function productionItem(item: any): ExactManifest {
  const m=exactEarthSearchItem(item), props=item.properties;
  if(item.type!=='Feature'||item.collection!=='sentinel-2-l2a'||typeof props['s2:product_uri']!=='string'||!/^S2[ABC]_MSIL2A_/.test(props['s2:product_uri'])||typeof props['eo:cloud_cover']!=='number'||props['eo:cloud_cover']<0||props['eo:cloud_cover']>100||!/^\d{4}-\d\d-\d\dT.*Z$/.test(m.acquired_at)) throw new Error('Invalid L2A product/cloud/UTC proof');
  if(item.geometry?.type!=='Polygon'||item.geometry.coordinates?.length!==1) throw new Error('Multi-tile/missing footprint refused');
  const grid=(asset:any):NativeGrid=>{
    const shape=asset['proj:shape'],t=asset['proj:transform'],epsg=asset['proj:epsg']??props['proj:epsg'];
    if(!Array.isArray(shape)||shape.length!==2||!Array.isArray(t)||t.length!==6||!Number.isInteger(epsg)) throw new Error('Missing explicit asset native grid');
    return {crs:`EPSG:${epsg}`,affine:t,width:shape[1],height:shape[0]};
  };
  const native=grid(item.assets.red),scl=grid(item.assets.scl);
  // Tile sizes are larger than bounded processing windows; validate an unchanged 1-cell grid first.
  validateNativeGrid({...native,width:1,height:1});
  if(!Number.isInteger(native.width)||!Number.isInteger(native.height)||native.width<1||native.height<1||native.width>20000||native.height>20000||!Number.isInteger(scl.width)||!Number.isInteger(scl.height)||scl.width*2!==native.width||scl.height*2!==native.height) throw new Error('Invalid tile size');
  for(const key of ['green','blue','nir']) if(JSON.stringify(grid(item.assets[key]))!==JSON.stringify(native)) throw new Error('Different band acquisition grids');
  if(scl.crs!==native.crs||scl.affine[0]!==20||scl.affine[4]!==-20||scl.affine[1]!==0||scl.affine[3]!==0||(native.affine[2]-scl.affine[2])%20!==0||(native.affine[5]-scl.affine[5])%20!==0) throw new Error('Unaligned 20m categorical SCL');
  const parents=['red','green','blue','nir','scl'].map(k=>new URL(item.assets[k].href).pathname.split('/').slice(0,-1).join('/'));
  if(new Set(parents).size!==1) throw new Error('Band product paths differ');
  const ring=item.geometry.coordinates[0];
  if(!Array.isArray(ring)||ring.length<4||ring.length>10000||ring.some((v:any)=>!Array.isArray(v)||v.length<2||!Number.isFinite(v[0])||!Number.isFinite(v[1])||Math.abs(v[0])>180||Math.abs(v[1])>90)||JSON.stringify(ring[0])!==JSON.stringify(ring.at(-1))) throw new Error('Invalid product footprint');
  return {...m,product_id:props['s2:product_uri'],cloud_cover:props['eo:cloud_cover'],native_grid:native,scl_grid:scl,footprint:ring};
}