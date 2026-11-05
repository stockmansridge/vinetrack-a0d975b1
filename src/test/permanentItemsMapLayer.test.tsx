import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import PermanentItemsMapLayer from '@/components/permanent-items/PermanentItemsMapLayer';
const m = vi.hoisted(() => ({ allowed:true, items:[] as any[], annotations:[] as any[], types:[] as any[] }));
vi.mock('@/components/permanent-items/usePermanentItems',()=>({usePermanentItems:()=>({allowed:m.allowed,items:m.items,query:{isError:false}}),usePermanentItemTypes:()=>({types:m.types??[]})}));
beforeEach(()=>{m.allowed=true;m.annotations=[];m.items=[{id:'i',name:'Pump',latitude:-34,longitude:138,archived_at:null}];vi.stubGlobal('mapkit',{
  Coordinate:class {constructor(public latitude:number,public longitude:number){}},
  Annotation:class { element:HTMLElement; constructor(_:unknown,factory:()=>HTMLElement){this.element=factory();m.annotations.push(this);}addEventListener=vi.fn();},
});});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('adds/removes only its own independent annotations when toggled',()=>{
  const map={addAnnotations:vi.fn(),removeAnnotations:vi.fn(),setRegion:vi.fn()};const view=render(<PermanentItemsMapLayer map={map} visible onSelect={()=>{}}/>);
  expect(map.addAnnotations).toHaveBeenCalledWith(m.annotations);view.rerender(<PermanentItemsMapLayer map={map} visible={false}/>);
  expect(map.removeAnnotations).toHaveBeenCalledWith(m.annotations);expect(map.setRegion).not.toHaveBeenCalled();
});
it('never adds markers for disabled access, archived items or invalid coordinates',()=>{
  const map={addAnnotations:vi.fn(),removeAnnotations:vi.fn()};m.allowed=false;const view=render(<PermanentItemsMapLayer map={map} visible/>);expect(map.addAnnotations).not.toHaveBeenCalled();
  m.allowed=true;m.items=[{...m.items[0],archived_at:'now'},{...m.items[0],latitude:100}];view.rerender(<PermanentItemsMapLayer map={map} visible/>);expect(map.addAnnotations).not.toHaveBeenCalled();
});
it('keyboard-usable marker selects permanent item without pin selection',()=>{
  const map={addAnnotations:vi.fn(),removeAnnotations:vi.fn()};const select=vi.fn();render(<PermanentItemsMapLayer map={map} visible onSelect={select}/>);
  const element=m.annotations[0].element;expect(element.tagName).toBe('BUTTON');expect(element.getAttribute('aria-label')).toBe('Permanent Item: Pump');element.click();expect(select).toHaveBeenCalledWith(m.items[0]);
});