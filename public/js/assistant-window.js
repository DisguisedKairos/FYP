import {state,icon} from './core.js';

let resizing=null;
const directions={ArrowLeft:[1,0],ArrowRight:[-1,0],ArrowUp:[0,1],ArrowDown:[0,-1]};
function availableSize(popup) {
  const style=getComputedStyle(popup);
  return {
    width:Math.max(1,document.documentElement.clientWidth-parseFloat(style.right)-12),
    height:Math.max(1,document.documentElement.clientHeight-parseFloat(style.bottom)-12),
  };
}
function clampSize(popup,size) {
  const max=availableSize(popup);
  return {width:Math.round(Math.min(max.width,Math.max(Math.min(340,max.width),size.width))),height:Math.round(Math.min(max.height,Math.max(Math.min(420,max.height),size.height)))};
}
function canResize(popup) {
  return state.user && !state.signingOut && state.assistant?.open && !state.assistant.expanded && popup.isConnected && !popup.closest('[inert]');
}
export function stopAssistantResize() {
  if(!resizing)return;
  const {handle,popup,pointerId}=resizing;resizing=null;
  popup.classList.remove('assistant-resizing');
  if(handle.hasPointerCapture(pointerId))handle.releasePointerCapture(pointerId);
}
export function renderAssistantWindow(popup) {
  const t=state.assistant;
  if(!t || !t.open)return;
  popup.classList.toggle('assistant-expanded',Boolean(t.expanded));
  popup.closest('#assistant-root').classList.toggle('assistant-window-expanded',Boolean(t.expanded));
  popup.classList.toggle('assistant-sized',Boolean(t.windowSize || t.expanded));
  if(t.windowSize || t.expanded){
    const size=t.expanded?availableSize(popup):clampSize(popup,t.windowSize);
    popup.style.setProperty('--assistant-width',size.width+'px');
    popup.style.setProperty('--assistant-height',size.height+'px');
  }
  const button=popup.querySelector('[data-action="assistant-expand"]');
  const label=t.expanded?'Restore assistant size':'Expand GLDB Assistant';
  button.setAttribute('aria-label',label);button.title=label;
  if(button.getAttribute('aria-pressed')!==String(Boolean(t.expanded)))button.innerHTML=icon(t.expanded?'restore':'expand');
  button.setAttribute('aria-pressed',String(Boolean(t.expanded)));
  popup.querySelector('.assistant-resize-handle').hidden=Boolean(t.expanded);
}
function changeSize(popup,size) {
  state.assistant.windowSize=clampSize(popup,size);
  renderAssistantWindow(popup);
}
export function toggleAssistantSize() {
  const popup=document.querySelector('#assistant-popup');
  if(!popup || !state.assistant?.open || !state.user || state.signingOut)return;
  stopAssistantResize();state.assistant.expanded=!state.assistant.expanded;
  renderAssistantWindow(popup);
}
export function bindAssistantWindow(popup) {
  popup.addEventListener('pointerdown',event=>{
    const handle=event.target.closest('.assistant-resize-handle');
    if(!handle || event.button!==0 || !event.isPrimary || !canResize(popup))return;
    event.preventDefault();stopAssistantResize();handle.focus({preventScroll:true});
    const rect=popup.getBoundingClientRect();
    resizing={popup,handle,pointerId:event.pointerId,thread:state.assistant,x:event.clientX,y:event.clientY,width:rect.width,height:rect.height};
    handle.setPointerCapture(event.pointerId);popup.classList.add('assistant-resizing');
  });
  popup.addEventListener('pointermove',event=>{
    const drag=resizing;
    if(!drag || drag.popup!==popup || drag.pointerId!==event.pointerId)return;
    if(!canResize(popup) || state.assistant!==drag.thread)return stopAssistantResize();
    changeSize(popup,{width:drag.width+drag.x-event.clientX,height:drag.height+drag.y-event.clientY});
  });
  for(const type of ['pointerup','pointercancel','lostpointercapture'])popup.addEventListener(type,event=>{
    if(resizing?.popup===popup && resizing.pointerId===event.pointerId)stopAssistantResize();
  });
  popup.addEventListener('keydown',event=>{
    if(!event.target.closest('.assistant-resize-handle') || !directions[event.key] || !canResize(popup))return;
    event.preventDefault();
    const [x,y]=directions[event.key],step=event.shiftKey?50:20,rect=popup.getBoundingClientRect();
    changeSize(popup,{width:rect.width+x*step,height:rect.height+y*step});
  });
}
function viewportChanged() {
  stopAssistantResize();
  const popup=document.querySelector('#assistant-popup:not([hidden])');
  if(popup)renderAssistantWindow(popup);
}
window.addEventListener('resize',viewportChanged);
window.addEventListener('blur',stopAssistantResize);
