import {it,expect} from 'vitest';
import proj4 from 'proj4';
import {nativeCell} from './satelliteNativeCell';
it('samples actual 10m UTM cell rather than projected display bounds',()=>{
  const p=proj4('EPSG:4326','+proj=utm +zone=55 +south +datum=WGS84 +units=m +no_defs');const ll=p.inverse([500015,6299985]);
  expect(nativeCell({epsg:32755,origin:[500000,6300000],resolution:[10,-10],width:4,height:4},ll[1],ll[0])?.index).toBe(5);
  expect(()=>nativeCell({epsg:32755,origin:[0,0],resolution:[20,-20],width:4,height:4},0,0)).toThrow();
});