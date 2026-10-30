import {isStaff, type CompletedChallengeView} from '@heist/shared';
import type {GameStore} from '../game/store.js';
import {completedContracts} from './contracts-model.js';
import './completed.css';
const node = (tag:string,text='',className='') => {const e=document.createElement(tag);e.textContent=text;e.className=className;return e;};
export function completionList(entries:CompletedChallengeView[],emptyMessage='No completed challenges yet. Your server-verified clears will appear here.') {
  const list=node('ul','','completion-list');
  for(const c of entries){const item=node('li','','completion-row');
    item.append(node('span','✓','completion-check'),node('strong',c.title),node('span',c.location,'completion-location'),node('small',c.mode==='training'?'Practice · unpaid':c.mode==='job'?'Paid job':c.mode.toUpperCase()));
    list.append(item);
  }
  if(!entries.length)list.append(node('li',emptyMessage,'completion-empty'));
  return list;
}
/** Read-only, server-confirmed checklist; no economy, sockets or puzzle answers. */
export class CompletedUI {
  private button=document.createElement('button');
  private dialog=document.createElement('dialog');
  private list=node('div');
  private search=document.createElement('input');
  private entries:CompletedChallengeView[]=[];
  private signature='';
  constructor(private store:GameStore,private pause:(v:boolean)=>void){
    this.button.id='completed-checklist';this.button.className='completion-dock';this.button.type='button';this.button.hidden=true;
    this.button.addEventListener('click',()=>this.open());
    this.dialog.id='completed-dialog';this.dialog.className='completion-dialog';this.dialog.setAttribute('aria-label','Completed challenges checklist');
    const head=node('header','','completion-header'),close=document.createElement('button');close.type='button';close.textContent='Close · Esc';close.addEventListener('click',()=>this.dialog.close());
    head.append(node('h2','Completed operations'),close);
    this.search.type='search';this.search.placeholder='Find a challenge or location';this.search.setAttribute('aria-label','Search completed challenges');this.search.addEventListener('input',()=>this.render());
    this.dialog.append(head,node('p','Server-verified clears for this round. Every challenge and its location, without the workbench clutter.','completion-caption'),this.search,this.list);
    this.dialog.addEventListener('close',()=>this.pause(!!document.querySelector('dialog[open]')));document.body.append(this.button,this.dialog);
  }
  update(){const event=this.store.event;this.button.hidden=!event || !this.store.token || !this.store.selfEntity || isStaff(event.role);
    if(!event)return;const entries=completedContracts(event,this.store.map),signature=JSON.stringify([event.player.name,entries]);
    if(signature===this.signature)return;this.signature=signature;this.entries=entries;this.button.textContent=`✓ Checklist · ${entries.length}`;this.button.setAttribute('aria-label',`Completed challenges checklist · ${entries.length} completed`);if(this.dialog.open)this.render();
  }
  private render(){const q=this.search.value.toLowerCase().trim();this.list.replaceChildren(completionList(this.entries.filter(c=>`${c.title} ${c.location} ${c.mode}`.toLowerCase().includes(q)),q?'No matching completed challenges. Try another challenge or location.':undefined));}
  open(){this.update();if(!this.store.event)return;this.search.value='';this.render();if(!this.dialog.open)this.dialog.showModal();this.pause(true);}
}
