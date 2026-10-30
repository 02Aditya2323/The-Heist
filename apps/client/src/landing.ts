import { installBenchmarkResults } from './benchmark-results.js';
import './landing.css';
import './landing-polish.css';
import { apiLogin, apiRegister } from './net/api.js';

const districts = [
  {id:'central',name:'Central Exchange',line:'Every route leads to a decision.',purpose:'BANKING / RACES / CHECKOUT',color:'#e7b76b'},
  {id:'tech',name:'Tech Quarter',line:'Bright minds. Better opportunities.',purpose:'CODE / LOGIC / CONTRACTS',color:'#7dd3e1'},
  {id:'black',name:'Black Grid',line:'Fortune favours those who read the risk.',purpose:'CHALLENGES / HIGH STAKES',color:'#e08c8b'},
  {id:'nexus',name:'NEXUS Plaza',line:'At the heart of every signal.',purpose:'CITY UPLINK / EXPLORATION',color:'#b69adb'},
  {id:'harbor',name:'Data Harbor',line:'Follow the current. Find your opening.',purpose:'TERMINALS / CONTRACTS',color:'#7fcab8'},
  {id:'under',name:'Undercity',line:'Even a quiet street keeps its secrets.',purpose:'SAFEHOUSES / RISK & REWARD',color:'#c7a489'},
];
const rail = document.getElementById('districts')!;
for (const [i,d] of districts.entries()) {
  const card = document.createElement('article'); card.className='district-card'; card.style.setProperty('--district-accent',d.color);
  card.innerHTML=`<img src="/art/scenes/v2-${d.id}.webp" alt="${d.name} original in-game artwork" loading="lazy" width="700" height="600"><div class="district-card-shade"></div><small class="district-number">DISTRICT / 0${i+1}</small><div class="district-card-copy"><small>${d.purpose}</small><h3>${d.name}</h3><p>${d.line}</p><a href="/game.html">Explore district <span>↗</span></a></div>`;
  rail.append(card);
}
for (const [id,direction] of [['district-prev',-1],['district-next',1]] as const)
  document.getElementById(id)!.addEventListener('click',()=>rail.scrollBy({left:direction*rail.clientWidth*.7,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'}));
const steps=[
 ['Explore','Read the city.','Six distinct districts. Follow the connected streets, learn the routes and find the places that matter.'],
 ['Interact','Find your opening.','Walk to an entrance or terminal. Nearby prompts reveal the interactions available at your location.'],
 ['Accept contracts','Take on the challenge.','Choose an available contract. Read the brief, work the problem and submit your answer.'],
 ['Cross districts','Make your move.','Travel gates and connected regions take you from one opportunity to the next.'],
 ['Earn wealth','Turn a solution into a fortune.','Completed paid contracts move wealth from the shared economy into your account.'],
 ['Secure or risk it','Protect what you have built.','Choose between keeping money at Home, securing it at the Bank and pursuing riskier opportunities.'],
 ['Aim higher','Build your next opportunity.','Progress opens eligible activities. Keep an eye on the city schedule and choose your next move.'],
];
const tabs=document.getElementById('loop-tabs')!,detail=document.getElementById('loop-detail')!;
function selectStep(index:number,focus=false){
  tabs.querySelectorAll<HTMLButtonElement>('button').forEach((b,i)=>{b.setAttribute('aria-selected',String(i===index));b.tabIndex=i===index?0:-1;if(focus&&i===index)b.focus();});
  detail.setAttribute('aria-labelledby',`loop-step-${index}`);
  detail.innerHTML=`<span class="step-number">0${index+1}</span><h3>${steps[index][1]}</h3><p>${steps[index][2]}</p><span class="step-progress" style="--progress:${(index+1)/steps.length*100}%"></span>`;
}
steps.forEach(([label],i)=>{const b=document.createElement('button');b.role='tab';b.id=`loop-step-${i}`;b.setAttribute('aria-controls','loop-detail');b.innerHTML=`<span>0${i+1}</span>${label}<span>↗</span>`;b.addEventListener('click',()=>selectStep(i));b.addEventListener('keydown',e=>{if(['ArrowDown','ArrowUp','ArrowRight','ArrowLeft','Home','End'].includes(e.key)){e.preventDefault();selectStep(e.key==='Home'?0:e.key==='End'?steps.length-1:(i+(['ArrowDown','ArrowRight'].includes(e.key)?1:steps.length-1))%steps.length,true);}});tabs.append(b);});selectStep(0);
const gallery:Record<string,{image:string;label:string;caption:string;alt:string}>={
 gameplay:{image:'gameplay.png',label:'FIELD HUD',caption:'Minimal by default. Contextual when it matters.',alt:'Actual Veyra City gameplay with the compact operator HUD'},
 map:{image:'operations-map.png',label:'OPERATIONS MAP',caption:'Read the districts. Find your route. Plan your next move.',alt:'The actual city operations map with region navigation and layer controls'},
 terminal:{image:'terminal.png',label:'CONTRACT TERMINAL',caption:'The brief, the workbench and the outcome. All in one place.',alt:'An actual Veyra City terminal interface'},
};
const galleryButtons=Array.from(document.querySelectorAll<HTMLButtonElement>('[data-gallery]'));
function showGallery(b:HTMLButtonElement){const selected=gallery[b.dataset.gallery!];galleryButtons.forEach(x=>{x.setAttribute('aria-selected',String(x===b));x.tabIndex=x===b?0:-1;});const image=document.getElementById('gallery-image') as HTMLImageElement;image.src=`/art/landing/${selected.image}`;image.alt=selected.alt;document.getElementById('gallery-label')!.textContent=`VEYRA CITY / ${selected.label}`;document.getElementById('gallery-caption')!.textContent=selected.caption;}
galleryButtons.forEach((b,i)=>{b.tabIndex=i? -1:0;b.addEventListener('click',()=>showGallery(b));b.addEventListener('keydown',e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();const next=galleryButtons[(i+(e.key==='ArrowRight'?1:2))%3];showGallery(next);next.focus();}});});
const menu=document.querySelector<HTMLButtonElement>('.menu-toggle')!;
menu.addEventListener('click',()=>{const expanded=menu.getAttribute('aria-expanded')!=='true';menu.setAttribute('aria-expanded',String(expanded));document.body.classList.toggle('menu-open',expanded);});
document.querySelectorAll('#site-nav a').forEach(a=>a.addEventListener('click',()=>{menu.setAttribute('aria-expanded','false');document.body.classList.remove('menu-open');}));
const dialog=document.getElementById('entry-dialog') as HTMLDialogElement;
let returnFocus:HTMLElement|null=null;
document.querySelectorAll<HTMLButtonElement>('[data-play]').forEach(b=>b.addEventListener('click',()=>{returnFocus=b;dialog.showModal();document.getElementById('entry-name')!.focus();}));
document.querySelector('.entry-close')!.addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>returnFocus?.focus());
let busy=false;
async function authenticate(register=false){
 if(busy)return;const form=document.getElementById('entry-form') as HTMLFormElement;if(!form.reportValidity())return;
 const username=(document.getElementById('entry-name') as HTMLInputElement).value.trim(),password=(document.getElementById('entry-password') as HTMLInputElement).value,status=document.getElementById('entry-status')!;
 busy=true;form.querySelectorAll<HTMLInputElement|HTMLButtonElement>('input,button').forEach(e=>e.disabled=true);status.textContent=register?'Creating your operator…':'Establishing uplink…';status.dataset.error='false';
 try{const session=register?await apiRegister(username,password):await apiLogin(username,password);sessionStorage.setItem('heist_session_token',session.token);sessionStorage.setItem('heist_session_username',session.username);location.assign('/game.html');}
 catch(error){status.textContent=error instanceof Error?error.message:'Uplink unavailable. Please try again.';status.dataset.error='true';busy=false;form.querySelectorAll<HTMLInputElement|HTMLButtonElement>('input,button').forEach(e=>e.disabled=false);}
}
document.getElementById('entry-form')!.addEventListener('submit',e=>{e.preventDefault();void authenticate();});document.getElementById('entry-register')!.addEventListener('click',()=>void authenticate(true));
const reduce=matchMedia('(prefers-reduced-motion: reduce)');
if('IntersectionObserver' in window&&!reduce.matches){const observer=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('revealed');observer.unobserve(e.target);}}),{threshold:.08});document.querySelectorAll('.reveal').forEach(e=>{e.classList.add('will-reveal');observer.observe(e);});}
const broadcasts=['Every fortune begins with a first contract.','Protect your wealth. Choose your risks.','Six districts. One shared economy.','Your next opportunity is somewhere in Veyra.'];let broadcast=0;
setInterval(()=>{if(document.hidden||reduce.matches||dialog.open)return;broadcast=(broadcast+1)%broadcasts.length;document.getElementById('city-broadcast')!.textContent=broadcasts[broadcast];},7500);

void installBenchmarkResults();
