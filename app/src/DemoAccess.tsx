import {useEffect,useRef,useState} from 'react';
import type {DemoRole} from './roles.ts';
import {policeCopy as c} from './police-copy.ts';
let introPlayed=false;
export function DemoAccess({choice,units,onChoose,onSkip}:{choice:DemoRole;units:{id:string;unit:string;post:string}[];onChoose:(v:DemoRole)=>void;onSkip:()=>void}) {
  const [intro,setIntro]=useState(!introPlayed),[role,setRole]=useState(choice.role),[unit,setUnit]=useState(choice.unitId??units[0]?.id??'');
  const dialog=useRef<HTMLDivElement>(null);
  useEffect(()=>{introPlayed=true;const timer=setTimeout(()=>setIntro(false),window.matchMedia('(prefers-reduced-motion: reduce)').matches?80:1100);return()=>clearTimeout(timer);},[]);
  useEffect(()=>{if(units.length&&!units.some(o=>o.id===unit))setUnit(units[0]!.id);},[units,unit]);
  useEffect(()=>{dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();},[intro]);
  return <div className="demo-access" role="dialog" aria-modal="true" aria-label={c.demo} ref={dialog} onKeyDown={e=>{
    if(e.key==='Escape'){e.preventDefault();onSkip();}
    if(e.key==='Tab'){
      const controls=[...dialog.current!.querySelectorAll<HTMLElement>('button:not(:disabled),select')],first=controls[0],last=controls[controls.length-1];
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
    }
  }}>
    <div className="demo-card">
      <header className="demo-head">
        <svg className={`demo-seal${intro?' syncing':''}`} viewBox="0 0 120 120" aria-hidden="true"><path d="M60 16 92 31 87 73 60 101 33 73 28 31Z"/><path d="m60 35 6 14 16 2-12 10 4 16-14-8-14 8 4-16-12-10 16-2Z"/></svg>
        <div><h1>{c.seal}</h1><p>{c.demo}</p></div>
      </header>
      {intro?<p className="demo-sync" role="status">{c.sync}</p>:<>
        <h2>{c.chooseRole}</h2>
        <div className="demo-roles" role="radiogroup" aria-label={c.chooseRole}>
          <button role="radio" aria-checked={role==='supervisor'} className={role==='supervisor'?'on':''} onClick={()=>setRole('supervisor')}>
            <strong>{c.supervisor}</strong><span>Plans, live orders and the whole map</span>
          </button>
          <button role="radio" aria-checked={role==='officer'} className={role==='officer'?'on':''} onClick={()=>setRole('officer')}>
            <strong>{c.officer}</strong><span>One unit: its assignment, reports and backup</span>
          </button>
        </div>
        {role==='officer'&&(units.length?<label>{c.chooseUnit}<select value={unit} onChange={e=>setUnit(e.target.value)}>{units.map(o=><option key={o.id} value={o.id}>{o.unit} — {o.post}</option>)}</select></label>:<p>{c.chooseStadium}</p>)}
        <div className="demo-go">
          <button className="primary" onClick={()=>onChoose({role,unitId:role==='officer'?unit||null:choice.unitId})}>{c.enter}</button>
          <button className="ghost" onClick={onSkip}>{c.skip}</button>
        </div>
        <p className="muted">{c.sharedRole}</p>
      </>}
      {intro&&<button className="ghost" onClick={onSkip}>{c.skip}</button>}
    </div>
  </div>;
}
