import proj4 from 'proj4';
export function nativeCell(grid:{epsg:number;origin:number[];resolution:number[];width:number;height:number},lat:number,lng:number) {
  const zone=grid.epsg%100;
  if(!/^32[67]\d\d$/.test(String(grid.epsg))||zone<1||zone>60||grid.resolution[0]!==10||grid.resolution[1]!==-10) throw new Error('Unsupported native measurement grid');
  const p=proj4('EPSG:4326',`+proj=utm +zone=${zone} ${grid.epsg>=32700?'+south ':''}+datum=WGS84 +units=m +no_defs`);
  const xy=p.forward([lng,lat]);const x=Math.floor((xy[0]-grid.origin[0])/10),y=Math.floor((grid.origin[1]-xy[1])/10);
  if(x<0||y<0||x>=grid.width||y>=grid.height)return null;
  const west=grid.origin[0]+x*10,north=grid.origin[1]-y*10;
  const corners=[[west,north],[west+10,north],[west,north-10],[west+10,north-10]].map(v=>p.inverse(v));
  return {index:y*grid.width+x,cellRect:{west:Math.min(...corners.map(v=>v[0])),east:Math.max(...corners.map(v=>v[0])),south:Math.min(...corners.map(v=>v[1])),north:Math.max(...corners.map(v=>v[1]))}};
}