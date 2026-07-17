import { useEffect, useRef, useState } from 'react';
import '../styles/build-tracker.css';

/**
 * BUILD TRACKER — flat amber tracking-scope for the live NEOFORM build lane.
 * A radar scope plots the pipeline stages as contacts on a ring; the current one
 * is locked with a cyan reticle, cleared checkpoints go green, a bright progress
 * arc trails behind. The ring ADAPTS to the active build's mode:
 *   • circuit   — full research path: SCOUT→…→DELIVER (10 stages)
 *   • schematic — research cut out:   CALIBRATE→BUILD→QA→DEPLOY→REPORT→DELIVER (6)
 * so the operator only ever sees the stages the running job actually performs.
 * Polls /api/pipeline/leads every 4s.
 */

const CIRCUIT_STAGES   = ['SCOUT','VERIFY','QUALIFY','CALIBRATE','ARCHITECT','BUILD','QA','DEPLOY','REPORT','DELIVER'];
const SCHEMATIC_STAGES = ['CALIBRATE','BUILD','QA','DEPLOY','REPORT','DELIVER'];
// coarse pipeline status → the stage NAME it corresponds to (resolved to an index in the active ring)
const COARSE: Record<string, string> = { scraped:'SCOUT',verifying:'VERIFY',qualified:'QUALIFY',approved:'CALIBRATE',building:'BUILD',deployed:'DEPLOY',reported:'REPORT',delivered:'DELIVER' };

const C = { amber:'#ffb000',amberBr:'#ffce4d',amberDim:'#a86e12',ghost:'#4a3208',
  red:'#d84a1e',redDim:'#7a2c12',teal:'#43e0d0',cyan:'#00c8ff',green:'#5ce03a' };

interface St { idx:number; fail:boolean; biz:string; url:string; leads:number; sig:number; running:boolean; stages:string[]; }
interface Ui { idx:number; fail:boolean; biz:string; url:string; leads:number; sig:number; running:boolean; pct:number; time:string; stages:string[]; mode:string; }

// resolve a lead's live ring position within its stage set
function resolvePos(lead: any, stages: string[]): number {
  let idx = stages.indexOf(COARSE[lead.status] ?? '');
  if (idx < 0) idx = (lead.status === 'delivered') ? stages.length - 1 : 0;
  if (lead.status !== 'delivered' && lead.status !== 'dropped' && lead.buildStage) {
    const fi = stages.indexOf(String(lead.buildStage).toUpperCase());
    if (fi >= 0) idx = fi;
  }
  return idx;
}

export function BuildTracker() {
  const scopeRef = useRef<HTMLCanvasElement | null>(null);
  const erspRef  = useRef<HTMLCanvasElement | null>(null);
  const stRef = useRef<St>({ idx:-1, fail:false, biz:'', url:'', leads:0, sig:0, running:false, stages:CIRCUIT_STAGES });
  const [ui, setUi] = useState<Ui>({ idx:-1, fail:false, biz:'', url:'', leads:0, sig:0, running:false, pct:0, time:'00 00 0000', stages:CIRCUIT_STAGES, mode:'circuit' });

  useEffect(() => {
    const cv = scopeRef.current, ecv = erspRef.current;
    if (!cv || !ecv) return;
    const ctx = cv.getContext('2d')!, ectx = ecv.getContext('2d')!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let raf = 0, alive = true;
    let W=0,H=0,cx=0,cy=0,R=0;
    const NF = () => stRef.current.stages.length;

    const size = () => { const w=cv.clientWidth,h=cv.clientHeight;
      cv.width=w*dpr; cv.height=h*dpr; ctx.setTransform(dpr,0,0,dpr,0,0);
      W=w;H=h;cx=w/2;cy=h/2;R=Math.min(w,h)*0.42; };
    const line=(x1:number,y1:number,x2:number,y2:number,col:string,a:number,w=1,dash?:number[])=>{ctx.save();ctx.globalAlpha=a;ctx.strokeStyle=col;ctx.lineWidth=w;if(dash)ctx.setLineDash(dash);ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();ctx.restore();};
    const ring=(r:number,col:string,a:number,w=1,dash?:number[])=>{ctx.save();ctx.globalAlpha=a;ctx.strokeStyle=col;ctx.lineWidth=w;if(dash)ctx.setLineDash(dash);ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.stroke();ctx.restore();};
    const ang=(i:number)=>-Math.PI/2+(i/NF())*Math.PI*2;
    const pt=(i:number,r:number):[number,number]=>{const a=ang(i);return[cx+Math.cos(a)*r,cy+Math.sin(a)*r];};

    const drawScope=(ts:number)=>{
      const st=stRef.current, N=NF(), STAGES=st.stages; ctx.clearRect(0,0,W,H);
      line(cx,cy-R*1.15,cx,cy+R*1.15,'rgba(216,74,30,.28)',1,1,[2,5]);
      line(cx-R*1.4,cy,cx+R*1.4,cy,'rgba(216,74,30,.28)',1,1,[2,5]);
      line(cx-R*1.3,cy-R*0.7,cx+R*1.3,cy+R*0.7,C.redDim,0.5,1,[3,7]);
      line(cx-R*1.3,cy+R*0.7,cx+R*1.3,cy-R*0.7,C.redDim,0.35,1,[3,7]);
      ring(R,C.amberDim,0.7,1); ring(R*0.66,C.red,0.4,1,[4,5]); ring(R*0.33,C.amberDim,0.5,1);
      ctx.save();ctx.fillStyle=C.amberDim;ctx.font='9px monospace';ctx.textAlign='center';ctx.textBaseline='middle';
      for(let k=0;k<72;k++){ const a=k*Math.PI/36, maj=k%6===0, r1=R-(maj?11:6);
        line(cx+Math.cos(a)*R,cy+Math.sin(a)*R,cx+Math.cos(a)*r1,cy+Math.sin(a)*r1,C.amberDim,maj?0.9:0.5,1);
        if(maj){ ctx.globalAlpha=0.6;ctx.fillText(String(k*5).padStart(3,'0'),cx+Math.cos(a)*(R-22),cy+Math.sin(a)*(R-22)); } }
      ctx.restore();
      const sw=(ts*0.00042)%(Math.PI*2), span=Math.PI*0.28;
      ctx.save();
      for(let s=0;s<26;s++){ const a=sw-span*(s/26);ctx.globalAlpha=0.16*(1-s/26);ctx.strokeStyle=C.amber;ctx.lineWidth=2;
        ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx+Math.cos(a)*R,cy+Math.sin(a)*R);ctx.stroke(); }
      ctx.globalAlpha=0.9;ctx.strokeStyle=C.amberBr;ctx.lineWidth=1.5;
      ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx+Math.cos(sw)*R,cy+Math.sin(sw)*R);ctx.stroke();ctx.restore();
      ring(R*0.8,C.ghost,0.7,1,[3,4]);
      if(st.idx>0){ ctx.save();ctx.globalAlpha=0.95;ctx.strokeStyle=st.fail?C.red:C.green;ctx.lineWidth=2.4;ctx.shadowColor=C.green;ctx.shadowBlur=6;
        ctx.beginPath();ctx.arc(cx,cy,R*0.8,ang(0),ang(st.idx));ctx.stroke();ctx.restore(); }
      ctx.save();ctx.font='10px monospace';ctx.textBaseline='middle';
      for(let i=0;i<N;i++){ const [x,y]=pt(i,R*0.8), done=st.idx>=0&&i<st.idx, cur=i===st.idx;
        const col=st.fail&&cur?C.red:done?C.green:cur?C.cyan:C.amberDim;
        ctx.globalAlpha=cur?1:done?0.95:0.5;ctx.fillStyle=col;
        if(done){ ctx.beginPath();ctx.arc(x,y,3.2,0,Math.PI*2);ctx.fill(); }
        else if(cur){ ctx.beginPath();ctx.arc(x,y,5.5,0,Math.PI*2);ctx.fill();
          ctx.strokeStyle=C.cyan;ctx.lineWidth=1.4;ctx.globalAlpha=0.5+0.5*Math.abs(Math.sin(ts*0.004));
          const b=11;([[-1,-1],[1,-1],[1,1],[-1,1]] as const).forEach(([sx,sy])=>{
            ctx.beginPath();ctx.moveTo(x+sx*b,y+sy*b-sy*5);ctx.lineTo(x+sx*b,y+sy*b);ctx.lineTo(x+sx*b-sx*5,y+sy*b);ctx.stroke(); });
          ctx.globalAlpha=0.8;ctx.beginPath();ctx.moveTo(x+16,y-16);ctx.lineTo(x+7,y-7);ctx.stroke();
          ctx.beginPath();ctx.moveTo(x+7,y-7);ctx.lineTo(x+13,y-7);ctx.moveTo(x+7,y-7);ctx.lineTo(x+7,y-13);ctx.stroke();
        } else { ctx.lineWidth=1;ctx.strokeStyle=col;ctx.beginPath();ctx.arc(x,y,2.6,0,Math.PI*2);ctx.stroke(); }
        const rgt=Math.cos(ang(i))>=0, off=(cur?18:10), lx=x+(rgt?off:-off), ly=cur?y+15:y;
        ctx.textAlign=rgt?'left':'right';ctx.globalAlpha=cur?1:done?0.95:0.6;
        ctx.lineWidth=3.2;ctx.strokeStyle='rgba(6,4,0,.92)';ctx.strokeText(STAGES[i],lx,ly);
        ctx.fillStyle=col;ctx.font=cur?'bold 10px monospace':'10px monospace';ctx.fillText(STAGES[i],lx,ly);ctx.font='10px monospace'; }
      ctx.restore();
      ring(9,C.amber,0.9,1.4); ring(4,C.amberDim,0.7,1);
      line(cx-14,cy,cx-9,cy,C.amber,0.9);line(cx+9,cy,cx+14,cy,C.amber,0.9);
      line(cx,cy-14,cx,cy-9,C.amber,0.9);line(cx,cy+9,cx,cy+14,C.amber,0.9);
      ctx.save();ctx.fillStyle=C.red;ctx.beginPath();ctx.arc(cx,cy,2,0,Math.PI*2);ctx.fill();ctx.restore();
    };

    const drawErsp=(ts:number)=>{ const w=ecv.clientWidth,h=ecv.clientHeight;
      if(ecv.width!==w*dpr){ecv.width=w*dpr;ecv.height=h*dpr;} ectx.setTransform(dpr,0,0,dpr,0,0);
      const st=stRef.current, N=NF(); ectx.clearRect(0,0,w,h); const mx=w/2,my=h/2+6, rr=Math.min(w,h)*0.32, rot=ts*0.00018;
      for(let i=0;i<2;i++){ ectx.save();ectx.translate(mx,my);ectx.rotate(rot*(i?1:-1)+i*0.8);
        ectx.globalAlpha=0.28;ectx.strokeStyle=C.redDim;ectx.lineWidth=1;ectx.beginPath();
        ectx.ellipse(0,0,rr*1.5+i*8,rr*0.8+i*6,i*0.5,0,Math.PI*2);ectx.stroke();ectx.restore(); }
      ectx.save();ectx.globalAlpha=0.24;ectx.strokeStyle=C.amberDim;ectx.setLineDash([2,4]);
      ectx.beginPath();ectx.moveTo(mx-rr*1.4,my);ectx.lineTo(mx+rr*1.4,my);ectx.moveTo(mx,my-rr*1.3);ectx.lineTo(mx,my+rr*1.3);ectx.stroke();ectx.restore();
      ectx.save();ectx.globalAlpha=0.5;ectx.strokeStyle=C.ghost;ectx.setLineDash([2,3]);
      ectx.beginPath();ectx.arc(mx,my,rr,0,Math.PI*2);ectx.stroke();ectx.restore();
      if(st.idx>0){ ectx.save();ectx.globalAlpha=0.9;ectx.strokeStyle=st.fail?C.red:C.green;ectx.lineWidth=2;ectx.shadowColor=C.green;ectx.shadowBlur=5;
        ectx.beginPath();ectx.arc(mx,my,rr,-Math.PI/2,-Math.PI/2+(st.idx/N)*Math.PI*2);ectx.stroke();ectx.restore(); }
      for(let i=0;i<N;i++){ const a=-Math.PI/2+(i/N)*Math.PI*2, x=mx+Math.cos(a)*rr,y=my+Math.sin(a)*rr;
        const done=st.idx>=0&&i<st.idx,cur=i===st.idx, col=st.fail&&cur?C.red:done?C.green:cur?C.cyan:C.amberDim;
        ectx.save();ectx.globalAlpha=cur?1:done?0.9:0.5;ectx.fillStyle=col;
        if(cur){ ectx.strokeStyle=C.cyan;ectx.lineWidth=1.2;ectx.globalAlpha=0.5+0.5*Math.abs(Math.sin(ts*0.004));
          ectx.beginPath();ectx.arc(x,y,4.5,0,Math.PI*2);ectx.stroke();ectx.globalAlpha=1;
          ectx.beginPath();ectx.arc(x,y,2.2,0,Math.PI*2);ectx.fill(); }
        else { ectx.beginPath();ectx.arc(x,y,1.8,0,Math.PI*2);ectx.fill(); } ectx.restore(); }
      ectx.save();ectx.globalAlpha=0.8;ectx.strokeStyle=C.amber;ectx.lineWidth=1;ectx.beginPath();ectx.arc(mx,my,3,0,Math.PI*2);ectx.stroke();
      ectx.fillStyle=C.red;ectx.beginPath();ectx.arc(mx,my,1.2,0,Math.PI*2);ectx.fill();ectx.restore(); };

    const loop=(ts:number)=>{ if(!alive)return; if(cv.clientWidth&&(cv.width!==cv.clientWidth*dpr))size();
      drawScope(ts); drawErsp(ts); raf=requestAnimationFrame(loop); };

    const poll=async()=>{ try{
      // the REAL lane state comes from the queue — a job is genuinely running or not.
      // (Don't infer "active" from lead status; a stale lead would read as a ghost build.)
      const [arr, q]=await Promise.all([
        (await fetch('/api/pipeline/leads')).json(),
        fetch('/api/pipeline/queue').then(r=>r.json()).catch(()=>({active:false})),
      ]);
      const leads=Array.isArray(arr)?arr:(arr.leads||[]);
      // A build is live if the lane has a running job OR a lead is in an in-progress
      // status and freshly updated (catches an orphaned circuit whose job tracking died).
      const INPROG=['scraped','verifying','qualified','calibrate','architect','building','deployed','reported'];
      const liveLead=leads.filter((l:any)=>INPROG.includes(l.status)&&(Date.now()-(l.updatedAt||0)<45*60000))
        .sort((a:any,b:any)=>(b.updatedAt||0)-(a.updatedAt||0))[0];
      const running=!!q.active||!!liveLead;
      // when a build is live, track ITS lead; otherwise show the most-recent lead as a static "last" readout
      const runLeadId=q.running?.leadId||liveLead?.id;
      const active=(running&&runLeadId&&leads.find((l:any)=>l.id===runLeadId))
        ||leads.filter((l:any)=>l.status!=='delivered'&&l.status!=='dropped').sort((a:any,b:any)=>(b.updatedAt||0)-(a.updatedAt||0))[0]
        ||leads.sort((a:any,b:any)=>(b.updatedAt||0)-(a.updatedAt||0))[0];
      const st=stRef.current; st.running=running; st.leads=leads.length;
      const mode=active?.buildMode==='schematic'?'schematic':'circuit';
      const stages=mode==='schematic'?SCHEMATIC_STAGES:CIRCUIT_STAGES;
      st.stages=stages;
      if(!active){ st.idx=-1;st.fail=false;st.biz='';st.url='';st.sig=0; }
      else { st.fail=active.status==='dropped';
        st.idx=resolvePos(active,stages);
        st.biz=(active.businessName||'').slice(0,20); st.url=active.currentSiteUrl||active.liveUrl||active.siteUrl||''; st.sig=active.qualificationScore||0; }
      setUi(u=>({ ...u, idx:st.idx,fail:st.fail,biz:st.biz,url:st.url,leads:st.leads,sig:st.sig,running:st.running,stages,mode,
        pct:st.idx<0?0:Math.round(st.idx/(stages.length-1)*100) }));
    }catch{ /* backend offline */ } };

    const clock=()=>{ const d=new Date();
      setUi(u=>({ ...u, time:[d.getHours(),d.getMinutes(),d.getSeconds()].map(n=>String(n).padStart(2,'0')).join(' ') })); };

    size(); raf=requestAnimationFrame(loop);
    void poll(); const pi=setInterval(()=>void poll(),4000);
    clock(); const ci=setInterval(clock,1000);
    const onResize=()=>size(); window.addEventListener('resize',onResize);
    return ()=>{ alive=false; cancelAnimationFrame(raf); clearInterval(pi); clearInterval(ci); window.removeEventListener('resize',onResize); };
  }, []);

  const sq=(filled:number)=>[0,1,2].map(i=>(<i key={i} className={i<filled?(i===filled-1?'t':'a'):''} />));
  const N=ui.stages.length;
  const stageSquares=ui.idx<0?0:Math.max(1,Math.round((ui.idx/(N-1))*3));
  const ruler = (
    <div className="btrk-ruler">
      {Array.from({length:41},(_,i)=>(<div key={i} className={`tk${i%5===0?' maj':''}`} />))}
      {[0,25,50,75,100].map(p=>(<div key={p} className="num" style={{left:(4+p*0.92)+'%'}}>{p}</div>))}
      <div className="mark" style={{left:(4+ui.pct*0.92)+'%'}} />
    </div>
  );

  return (
    <div className="btrk" data-tour="pipeline-tracker">
      <div className="btrk-cnr tl" /><div className="btrk-cnr tr" /><div className="btrk-cnr bl" /><div className="btrk-cnr br" />
      <div className="btrk-hdr">
        <span>BUILD TRACKER</span>
        <span className="mid">NEOFORM · {ui.mode==='schematic'?'SCHEMATIC BUILD':'CIRCUIT 01'}</span>
        <span className="rt"><span className="seg">▤ Ⅱ ▦</span><span>{ui.idx<0?'--':'S'+String(ui.idx+1).padStart(2,'0')}</span>
          <span className={`btrk-stat${ui.running?' on':''}`}>{ui.running?'ACTIVE':'STBY'}</span></span>
      </div>

      <div className="btrk-body">
        <div className="btrk-scope">
          <canvas ref={scopeRef} />
          <div className="btrk-lbl tl">RANGE <b>01</b> · LEADS {ui.leads}<br />{ui.mode==='schematic'?'SCHEMATIC · NO RESEARCH':'PIPELINE SCAN'}</div>
          <div className="btrk-lbl tr">R VECTORS<br />SWEEP <b>ON</b></div>
          <div className="btrk-lbl br">SIGNAL <b>{ui.sig?ui.sig+'%':'—'}</b></div>
          <div className="btrk-badge">A</div>
          <div className="btrk-status">
            {ui.idx<0 ? 'no contacts — lane idle'
              : ui.fail ? <>contact lost — <b style={{color:C.red}}>DROPPED</b></>
              : ui.running ? <>building <b>{ui.stages[ui.idx]}</b> · {ui.leads} lead(s)</>
              : <>lane idle · last: <b>{ui.stages[ui.idx]}</b></>}
          </div>
        </div>

        <div className="btrk-side">
          <div className="btrk-cap"><span>TRACKING DATA</span><b>{ui.leads} LEADS</b></div>
          <div className="btrk-bar"><span className="bk">BUSINESS</span><span className="bv">{ui.biz||'—'}</span><span className="btrk-sq">{sq(ui.biz?3:0)}</span></div>
          <div className="btrk-bar"><span className="bk">STAGE</span><span className="bv">{ui.fail?'DROPPED':(ui.idx>=0?ui.stages[ui.idx]:'—')}</span><span className="btrk-sq">{sq(stageSquares)}</span></div>
          <div className="btrk-bar"><span className="bk">DEPLOY</span><span className="bv">{ui.url?<a href={ui.url} target="_blank" rel="noreferrer">{ui.url.replace(/^https?:\/\//,'')}</a>:'—'}</span><span className="btrk-sq">{sq(ui.url?3:0)}</span></div>
          <div className="btrk-ersp">
            <span className="el">ERSP MAP</span>
            <span className="er" style={{color:ui.fail?C.red:(ui.running?C.teal:C.amberDim)}}>{ui.fail?'LOST':(ui.running?'LOCK':'IDLE')}</span>
            <canvas ref={erspRef} />
          </div>
          <div className="btrk-clock">PROGRESS <b>{ui.idx<0?'—':ui.pct+'%'}</b> · {ui.time}</div>
        </div>
      </div>

      {ruler}
    </div>
  );
}
