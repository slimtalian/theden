import test from 'node:test';
import assert from 'node:assert/strict';
import {bindShelfBrowse} from '../public/shelf-preview.js';

class Events {
  handlers = new Map();
  addEventListener(type, fn) { if (!this.handlers.has(type)) this.handlers.set(type,[]); this.handlers.get(type).push(fn); }
  emit(type, values = {}) {
    const event = {pointerId:1,pointerType:'touch',button:0,buttons:1,clientX:30,clientY:50,timeStamp:0,detail:1,
      preventDefault() {this.prevented=true;},stopPropagation() {this.stopped=true;},...values};
    for (const fn of this.handlers.get(type)||[]) fn(event);
    return event;
  }
}
function fixture() {
  const surface=new Events(), root=new Events(), jobs=new Map(), changes=[];
  const a={id:'a'}, b={id:'b'}; let count=0;
  const cancel=bindShelfBrowse(surface, {
    eventRoot:root, hitTest:(x,y) => y<0||y>100 ? null : x>=0&&x<50 ? a : x>=50&&x<100 ? b : null,
    onLift:(node,value)=>changes.push(['lift',node.id,value]),
    onPreview:node=>changes.push(['preview',node.id]),onReturn:node=>changes.push(['return',node.id]),
    schedule:fn=>{jobs.set(++count,fn);return count;},unschedule:id=>jobs.delete(id),
  });
  const dwell=()=>{const pending=[...jobs.values()];jobs.clear();pending.forEach(fn=>fn());};
  const down=(values={})=>{surface.emit('pointerdown',values);root.emit('pointerdown',values);};
  return {surface,root,changes,jobs,dwell,down,cancel};
}
test('a quick tap opens normally and never previews',()=>{
  const f=fixture(); f.down(); f.root.emit('pointerup',{timeStamp:100});
  assert.equal(f.surface.emit('click',{timeStamp:101}).prevented,undefined);
  f.dwell(); assert.ok(!f.changes.some(([type])=>type==='preview'));
});
test('touch scrubbing lifts successive books, pauses to preview, then returns without opening',()=>{
  const f=fixture(); f.down();
  f.surface.emit('pointermove',{clientX:65,timeStamp:200}); f.dwell();
  assert.deepEqual(f.changes.slice(0,5),[['lift','a',true],['return','a'],['lift','a',false],['lift','b',true],['preview','b']]);
  f.root.emit('pointerup',{clientX:65,timeStamp:1000});
  assert.deepEqual(f.changes.slice(-2),[['return','b'],['lift','b',false]]);
  assert.equal(f.surface.emit('click',{timeStamp:1001}).stopped,true);
  f.down({timeStamp:1100}); f.root.emit('pointerup',{timeStamp:1200});
  assert.equal(f.surface.emit('click',{timeStamp:1201}).stopped,undefined,'a new tap is never swallowed');
});
test('a stationary long touch cannot also open on release',()=>{
  const f=fixture(); f.down(); f.dwell(); f.root.emit('pointerup',{timeStamp:900});
  assert.equal(f.surface.emit('click',{timeStamp:901}).prevented,true);
});
test('mouse dwell previews, leaving returns, quick click after hover opens, long press does not',()=>{
  const f=fixture(); f.surface.emit('pointermove',{pointerType:'mouse',buttons:0,timeStamp:100}); f.dwell();
  assert.ok(f.changes.some(([type])=>type==='preview'));
  f.surface.emit('pointerleave',{pointerType:'mouse',timeStamp:800});
  assert.deepEqual(f.changes.at(-1),['lift','a',false]);
  f.surface.emit('pointermove',{pointerType:'mouse',buttons:0,timeStamp:900}); f.dwell();
  f.down({pointerType:'mouse',timeStamp:1600}); f.root.emit('pointerup',{pointerType:'mouse',timeStamp:1700});
  assert.equal(f.surface.emit('click',{timeStamp:1701}).stopped,undefined);
  f.down({pointerType:'mouse',timeStamp:1900}); f.dwell(); f.root.emit('pointerup',{pointerType:'mouse',timeStamp:2700});
  assert.equal(f.surface.emit('click',{timeStamp:2701}).stopped,true);
});
test('scroll intent, pinch, capture loss, blur and cancellation leave no late preview',()=>{
  for (const reason of ['vertical','pinch','capture','blur','cancel','reset']) {
    const f=fixture();f.down();
    if(reason==='vertical') f.surface.emit('pointermove',{clientY:85,timeStamp:100});
    if(reason==='pinch') f.root.emit('pointerdown',{pointerId:2,timeStamp:100});
    if(reason==='capture') f.surface.emit('lostpointercapture',{timeStamp:100});
    if(reason==='blur') f.root.emit('blur');
    if(reason==='cancel') f.root.emit('pointercancel',{timeStamp:100});
    if(reason==='reset') f.cancel();
    f.dwell();assert.ok(!f.changes.some(([type])=>type==='preview'),reason);
  }
});
test('moving within a spine restarts the pause and keyboard clicks remain available',()=>{
  const f=fixture();f.down();const job=[...f.jobs.keys()][0];
  f.surface.emit('pointermove',{clientX:43,timeStamp:200});assert.equal(f.jobs.has(job),false);
  f.dwell();f.root.emit('pointerup',{timeStamp:1000});
  assert.equal(f.surface.emit('click',{detail:0,timeStamp:1001}).prevented,undefined);
});
