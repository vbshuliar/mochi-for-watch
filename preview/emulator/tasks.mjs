// Session-scoped activity, deliberately separate from future Calendar events.
export function taskGroups(calls, foreground, now=Date.now()) {
 const groups={'In progress':[],'Needs you':[],'Recently completed':[]};
 const tasks=new Map(calls.map(task=>[task.id,task]));
 if(foreground&&(!foreground.booking||!tasks.has(foreground.id)))tasks.set(foreground.id,foreground);
 for(const task of tasks.values()){
  if(['starting','queued','in_progress','executing'].includes(task.status))groups['In progress'].push(task);
  else if(['pending','uncertain'].includes(task.status))groups['Needs you'].push(task);
  else {
   const time=task.finishedAt??task.observedAt;
   if(Number.isFinite(time)&&time<=now&&now-time<=86400000)groups['Recently completed'].push(task);
  }
 }
 for(const tasks of Object.values(groups))tasks.sort((a,b)=>(b.finishedAt??b.observedAt??b.startedAt??0)-(a.finishedAt??a.observedAt??a.startedAt??0));
 return groups;
}
export function taskLabel(task){
 if(task.status==='pending')return 'Approval needed';
 if(task.status==='uncertain')return 'Needs verification';
 if(task.status==='completed')return task.outcome==='booked'?'Booking confirmed':'Call finished';
 return task.progress?.text||({in_progress:'Calling',starting:'Starting call',queued:'Calling',executing:'Saving',failed:'Couldn’t complete',cancelled:'Cancelled',stopped:'Stopped',expired:'Expired'}[task.status]||task.status);
}
// Capture the generated click as well, so a swipe never becomes tap-to-speak.
export function installTaskSwipe(surface,onSwipe){
 let start=null,suppressUntil=0;
 surface.addEventListener('pointerdown',event=>{start={x:event.clientX,y:event.clientY};},{passive:true});
 surface.addEventListener('pointerup',event=>{
  if(!start)return;
  const dx=event.clientX-start.x,dy=event.clientY-start.y;start=null;
  if(Math.abs(dx)<38||Math.abs(dx)<Math.abs(dy)*1.3)return;
  suppressUntil=Date.now()+500;onSwipe(dx<0?'tasks':'jolly');
 },{capture:true});
 surface.addEventListener('pointercancel',()=>{start=null;});
 surface.addEventListener('click',event=>{if(Date.now()<suppressUntil){event.preventDefault();event.stopImmediatePropagation();}},true);
}
